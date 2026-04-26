use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

/// Cap single-document size. Markdown is plain text and even mammoth documents
/// rarely exceed a few megabytes; 20 MiB is a safety net against runaway
/// allocation and against accidentally opening a binary file.
const MAX_DOC_BYTES: u64 = 20 * 1024 * 1024;

const WELCOME: &str = "# ProseDown\n\nOpen a markdown file from **File \u{2192} Open** (\u{2318}O), or drop one (or many) `.md` files onto the window.\n\nProseDown renders markdown documents beautifully and near-instantly on macOS 26.\n";

#[derive(Serialize, Deserialize, Clone)]
pub struct DocumentSummary {
    pub path: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DocumentPayload {
    pub path: Option<String>,
    pub source: String,
    pub documents: Vec<DocumentSummary>,
    pub selected_index: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TocEntry {
    pub level: u8,
    pub id: String,
    pub text: String,
}

/// Project an `AppState` snapshot into the wire shape the renderer consumes.
pub fn document_summaries(state: &AppState) -> (Vec<DocumentSummary>, Option<usize>) {
    let (docs, sel) = state.snapshot();
    let summaries = docs
        .iter()
        .map(|p| DocumentSummary {
            path: p.to_string_lossy().into_owned(),
            name: p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Untitled")
                .to_string(),
        })
        .collect();
    (summaries, sel)
}

/// Validate that a path points to an existing, regular, read-size-bounded file.
/// Returns the canonical path (symlinks resolved) on success.
async fn validate_document_path(p: &Path) -> Result<PathBuf, String> {
    let metadata = tokio::fs::metadata(p).await.map_err(|e| {
        tracing::warn!(path = %p.display(), error = %e, "stat failed");
        format!("Cannot access {}: {}", p.display(), e)
    })?;

    if !metadata.is_file() {
        tracing::warn!(path = %p.display(), "refused: not a regular file");
        return Err(format!("{} is not a regular file", p.display()));
    }

    let size = metadata.len();
    if size > MAX_DOC_BYTES {
        tracing::warn!(
            path = %p.display(),
            size = size,
            limit = MAX_DOC_BYTES,
            "refused: document too large"
        );
        return Err(format!(
            "{} is too large ({} bytes; limit {} bytes)",
            p.display(),
            size,
            MAX_DOC_BYTES
        ));
    }

    match tokio::fs::canonicalize(p).await {
        Ok(c) => Ok(c),
        Err(e) => {
            tracing::debug!(path = %p.display(), error = %e, "canonicalize failed; using as-is");
            Ok(p.to_path_buf())
        }
    }
}

async fn read_validated(p: &Path) -> Result<String, String> {
    tokio::fs::read_to_string(p).await.map_err(|e| {
        tracing::error!(path = %p.display(), error = %e, "read failed");
        format!("read {}: {}", p.display(), e)
    })
}

#[tauri::command]
pub async fn load_initial_document(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<DocumentPayload, String> {
    match state.current() {
        Some(path) => {
            let canonical = validate_document_path(&path).await?;
            let source = read_validated(&canonical).await?;
            tracing::info!(
                path = %canonical.display(),
                bytes = source.len(),
                "initial document loaded"
            );
            // Start the watcher for the active document — main.rs no longer
            // does this for us since we may have many documents queued up.
            if let Err(err) =
                crate::watcher::start(app.clone(), state.inner().clone(), canonical.clone())
            {
                tracing::warn!(error = %err, "watcher setup failed for initial document");
            }
            let (documents, selected_index) = document_summaries(&state);
            Ok(DocumentPayload {
                path: Some(canonical.to_string_lossy().into_owned()),
                source,
                documents,
                selected_index,
            })
        }
        None => {
            tracing::info!("no initial document; serving welcome screen");
            let (documents, selected_index) = document_summaries(&state);
            Ok(DocumentPayload {
                path: None,
                source: WELCOME.to_string(),
                documents,
                selected_index,
            })
        }
    }
}

#[tauri::command]
pub async fn open_document(
    path: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<DocumentPayload, String> {
    let p = PathBuf::from(&path);
    let canonical = validate_document_path(&p).await?;
    let source = read_validated(&canonical).await?;

    tracing::info!(
        path = %canonical.display(),
        bytes = source.len(),
        "document opened"
    );

    state.add_or_select(canonical.clone());
    if let Err(err) = crate::watcher::start(app.clone(), state.inner().clone(), canonical.clone()) {
        tracing::warn!(
            path = %canonical.display(),
            error = %err,
            "watcher setup failed; live-reload disabled for this document"
        );
    }

    let (documents, selected_index) = document_summaries(&state);
    Ok(DocumentPayload {
        path: Some(canonical.to_string_lossy().into_owned()),
        source,
        documents,
        selected_index,
    })
}

#[tauri::command]
pub async fn set_active_document(
    index: usize,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<DocumentPayload, String> {
    let path = state
        .select(index)
        .ok_or_else(|| format!("invalid document index {}", index))?;
    let canonical = validate_document_path(&path).await?;
    let source = read_validated(&canonical).await?;

    tracing::info!(
        index,
        path = %canonical.display(),
        "active document switched"
    );

    if let Err(err) = crate::watcher::start(app.clone(), state.inner().clone(), canonical.clone()) {
        tracing::warn!(error = %err, "watcher setup failed on switch");
    }

    let (documents, selected_index) = document_summaries(&state);
    Ok(DocumentPayload {
        path: Some(canonical.to_string_lossy().into_owned()),
        source,
        documents,
        selected_index,
    })
}

#[tauri::command]
pub async fn close_document(
    index: usize,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<DocumentPayload, String> {
    // Mutate document list + selection under a coherent lock window.
    let new_active_path = {
        let mut docs = state.documents.lock();
        if index >= docs.len() {
            return Err(format!("invalid document index {}", index));
        }
        docs.remove(index);

        let mut sel = state.selected.lock();
        *sel = match *sel {
            Some(s) if s == index => {
                if docs.is_empty() {
                    None
                } else if s >= docs.len() {
                    Some(docs.len() - 1)
                } else {
                    Some(s)
                }
            }
            Some(s) if s > index => Some(s - 1),
            other => other,
        };
        sel.and_then(|i| docs.get(i).cloned())
    };

    match new_active_path {
        Some(path) => {
            let canonical = validate_document_path(&path).await?;
            let source = read_validated(&canonical).await?;
            if let Err(err) =
                crate::watcher::start(app.clone(), state.inner().clone(), canonical.clone())
            {
                tracing::warn!(error = %err, "watcher setup failed after close");
            }
            let (documents, selected_index) = document_summaries(&state);
            Ok(DocumentPayload {
                path: Some(canonical.to_string_lossy().into_owned()),
                source,
                documents,
                selected_index,
            })
        }
        None => {
            *state.watcher.lock() = None;
            let (documents, selected_index) = document_summaries(&state);
            Ok(DocumentPayload {
                path: None,
                source: WELCOME.to_string(),
                documents,
                selected_index,
            })
        }
    }
}

#[tauri::command]
pub async fn push_toc(toc: Vec<TocEntry>, app: AppHandle) -> Result<(), String> {
    tracing::debug!(entries = toc.len(), "ToC pushed");
    app.emit("markview://toc", toc).map_err(|e| {
        tracing::warn!(error = %e, "failed to emit ToC");
        e.to_string()
    })
}

#[tauri::command]
pub async fn mark_ready(height: f64, width: f64) -> Result<(), String> {
    tracing::debug!(height, width, "frontend ready");
    Ok(())
}

#[tauri::command]
pub async fn scroll_to(anchor: String, app: AppHandle) -> Result<(), String> {
    app.emit("markview://scroll-to", anchor).map_err(|e| {
        tracing::warn!(error = %e, "failed to emit scroll-to");
        e.to_string()
    })
}

#[tauri::command]
pub async fn set_zoom(zoom: f64, app: AppHandle) -> Result<(), String> {
    app.emit("markview://zoom", zoom).map_err(|e| {
        tracing::warn!(error = %e, "failed to emit zoom");
        e.to_string()
    })
}
