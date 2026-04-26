use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::state::AppState;

pub struct FileWatcher {
    _debouncer: Debouncer<RecommendedWatcher>,
    pub path: PathBuf,
}

#[derive(Serialize, Clone)]
pub struct ReloadPayload {
    pub path: String,
    pub source: String,
    pub documents: Vec<crate::commands::DocumentSummary>,
    pub selected_index: Option<usize>,
}

/// Cap auto-reload size identically to the explicit-open size cap so a user
/// can't blow up memory by saving a huge file over the watched path.
const RELOAD_MAX_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum WatcherError {
    #[error("failed to construct debouncer: {0}")]
    Construct(#[from] notify::Error),
    #[error("failed to watch {path}: {source}")]
    Watch {
        path: PathBuf,
        #[source]
        source: notify::Error,
    },
}

pub fn start(
    app: AppHandle,
    state: Arc<AppState>,
    path: PathBuf,
) -> Result<(), WatcherError> {
    // Drop any previous watcher — only one active at a time in this window.
    *state.watcher.lock() = None;

    let watch_path = path.clone();
    let app_clone = app.clone();
    let state_for_emit = state.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(150),
        move |res: DebounceEventResult| {
            let events = match res {
                Ok(ev) => ev,
                Err(err) => {
                    tracing::warn!(?err, "watcher received error events");
                    return;
                }
            };
            let touched = events.iter().any(|e| e.path == watch_path);
            if !touched {
                return;
            }

            let file_path = watch_path.clone();
            let app_for_task = app_clone.clone();
            let state_for_task = state_for_emit.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(meta) = tokio::fs::metadata(&file_path).await {
                    if meta.len() > RELOAD_MAX_BYTES {
                        tracing::warn!(
                            path = %file_path.display(),
                            size = meta.len(),
                            limit = RELOAD_MAX_BYTES,
                            "reload skipped: file exceeds size cap"
                        );
                        return;
                    }
                }
                match tokio::fs::read_to_string(&file_path).await {
                    Ok(source) => {
                        tracing::debug!(
                            path = %file_path.display(),
                            bytes = source.len(),
                            "emitting reload"
                        );
                        let (documents, selected_index) =
                            crate::commands::document_summaries(&state_for_task);
                        let payload = ReloadPayload {
                            path: file_path.to_string_lossy().into_owned(),
                            source,
                            documents,
                            selected_index,
                        };
                        if let Err(err) = app_for_task.emit("markview://reload", payload) {
                            tracing::warn!(error = %err, "reload emit failed");
                        }
                    }
                    Err(err) => {
                        tracing::warn!(
                            path = %file_path.display(),
                            error = %err,
                            "reload read failed"
                        );
                    }
                }
            });
        },
    )
    .map_err(|err| {
        tracing::error!(error = %err, "failed to construct file watcher");
        WatcherError::from(err)
    })?;

    let parent = path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));

    debouncer
        .watcher()
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|source| {
            tracing::error!(
                parent = %parent.display(),
                error = %source,
                "failed to watch parent directory"
            );
            WatcherError::Watch {
                path: parent.clone(),
                source,
            }
        })?;

    tracing::info!(
        path = %path.display(),
        parent = %parent.display(),
        "watcher started"
    );

    *state.watcher.lock() = Some(FileWatcher {
        _debouncer: debouncer,
        path,
    });
    Ok(())
}