use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

/// Cap single-document size. Markdown is plain text and even mammoth documents
/// rarely exceed a few megabytes; 20 MiB is a safety net against runaway
/// allocation and against accidentally opening a binary file.
const MAX_DOC_BYTES: u64 = 20 * 1024 * 1024;

const WELCOME: &str = "# ProseDown\n\nOpen a markdown file from **File \u{2192} Open** (\u{2318}O), or drop a `.md` file onto the window.\n\nProseDown renders markdown documents beautifully and near-instantly on macOS 26.\n";

#[derive(Serialize, Deserialize, Clone)]
pub struct DocumentPayload {
    pub path: Option<String>,
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TocEntry {
    pub level: u8,
    pub id: String,
    pub text: String,
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

    // Canonicalise to collapse `..` and resolve symlinks — callers use this
    // for watcher and current_path bookkeeping.
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
    state: State<'_, Arc<AppState>>,
) -> Result<DocumentPayload, String> {
    // Consume (take) the pending initial path — it's a one-shot handoff from
    // main()/RunEvent::Opened. Subsequent explicit navigations use
    // `open_document`.
    let path = { state.pending_initial.lock().take() };
    match path {
        Some(p) => {
            let canonical = validate_document_path(&p).await?;
            let source = read_validated(&canonical).await?;
            tracing::info!(
                path = %canonical.display(),
                bytes = source.len(),
                "initial document loaded"
            );
            *state.current_path.lock() = Some(canonical.clone());
            Ok(DocumentPayload {
                path: Some(canonical.to_string_lossy().into_owned()),
                source,
            })
        }
        None => {
            tracing::info!("no initial document; serving welcome screen");
            Ok(DocumentPayload {
                path: None,
                source: WELCOME.to_string(),
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

    *state.current_path.lock() = Some(canonical.clone());
    if let Err(err) = crate::watcher::start(app.clone(), state.inner().clone(), canonical.clone()) {
        tracing::warn!(
            path = %canonical.display(),
            error = %err,
            "watcher setup failed; live-reload disabled for this document"
        );
    }

    Ok(DocumentPayload {
        path: Some(canonical.to_string_lossy().into_owned()),
        source,
    })
}

#[tauri::command]
pub async fn push_toc(toc: Vec<TocEntry>, app: AppHandle) -> Result<(), String> {
    // Re-emit so any external listener (e.g. a native Swift shell hosting the
    // WKWebView via Tauri plugin) can render the sidebar natively. The
    // standalone Tauri configuration already renders the sidebar inside the
    // webview, so this is a no-op in that case.
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