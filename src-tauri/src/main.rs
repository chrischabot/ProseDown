#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tracing_subscriber::EnvFilter;

use prosedown_lib::{commands, state::AppState, watcher};

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("prosedown=info,prosedown_lib=info,warn"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_level(true)
        .with_ansi(true)
        .try_init();
}

fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&'static str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("<non-string panic payload>");
        tracing::error!(location = %location, payload = %payload, "panic");
        default_hook(info);
    }));
}

fn parse_initial_args() -> Vec<PathBuf> {
    std::env::args_os()
        .skip(1)
        .filter_map(|a| {
            let s = a.to_string_lossy().to_string();
            if s.starts_with("--") {
                return None;
            }
            let p = PathBuf::from(&s);
            if p.exists() {
                Some(p)
            } else {
                tracing::warn!(arg = %s, "CLI argument does not exist as a path; ignoring");
                None
            }
        })
        .collect()
}

fn start_watcher_or_log(app_handle: &tauri::AppHandle, state: Arc<AppState>, path: PathBuf) {
    if let Err(err) = watcher::start(app_handle.clone(), state, path.clone()) {
        tracing::warn!(
            path = %path.display(),
            error = %err,
            "watcher setup failed; live-reload disabled for this document"
        );
    }
}

/// Markdown file extensions accepted by the open dialog and drag-drop handler.
/// Kept in sync with `tauri.conf.json` → `bundle.fileAssociations[0].ext`.
const MARKDOWN_EXTS: &[&str] = &["md", "markdown", "mdown", "mkd"];

fn has_markdown_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MARKDOWN_EXTS.iter().any(|allowed| allowed.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

/// Add `paths` to the session's document list and activate the first newly-
/// added one.  Routes everything through `commands::document_summaries` so
/// the renderer's reload payload always carries an accurate file list.
fn open_paths(app_handle: &tauri::AppHandle, state: Arc<AppState>, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let mut focus_idx: Option<usize> = None;
    for path in paths {
        let idx = state.add_or_select(path);
        if focus_idx.is_none() {
            focus_idx = Some(idx);
        }
    }
    if let Some(idx) = focus_idx {
        activate(app_handle, state, idx);
    }
}

/// Switch the active document to `index`, restart the watcher on it, read
/// the source synchronously, and emit `markview://reload` with the full
/// session payload (path + source + document list + selected index).
fn activate(app_handle: &tauri::AppHandle, state: Arc<AppState>, index: usize) {
    let Some(path) = state.select(index) else {
        tracing::warn!(index, "activate: index out of range");
        return;
    };

    start_watcher_or_log(app_handle, state.clone(), path.clone());

    match std::fs::read_to_string(&path) {
        Ok(source) => {
            let (documents, selected_index) = commands::document_summaries(&state);
            let payload = serde_json::json!({
                "path": path.to_string_lossy().to_string(),
                "source": source,
                "documents": documents,
                "selected_index": selected_index,
            });
            if let Err(err) = app_handle.emit("markview://reload", payload) {
                tracing::warn!(error = %err, "failed to emit reload event");
            }
        }
        Err(err) => {
            tracing::error!(
                path = %path.display(),
                error = %err,
                "failed to read document"
            );
        }
    }
}

fn show_open_dialog(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<Arc<AppState>>().inner().clone();
    let start_dir = state.current().and_then(|p| p.parent().map(PathBuf::from));

    let handle_for_cb = app_handle.clone();
    let mut builder = app_handle
        .dialog()
        .file()
        .set_title("Open Markdown files")
        .add_filter("Markdown", MARKDOWN_EXTS);
    if let Some(dir) = start_dir {
        builder = builder.set_directory(dir);
    }
    builder.pick_files(move |files| {
        let Some(files) = files else { return };
        let paths: Vec<PathBuf> = files
            .into_iter()
            .filter_map(|f| f.into_path().ok())
            .collect();
        if !paths.is_empty() {
            let state = handle_for_cb.state::<Arc<AppState>>().inner().clone();
            open_paths(&handle_for_cb, state, paths);
        }
    });
}

fn main() {
    init_tracing();
    install_panic_hook();
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "prosedown starting");

    let state = Arc::new(AppState::default());
    let initial = parse_initial_args();
    if !initial.is_empty() {
        tracing::info!(count = initial.len(), "initial documents from argv");
        let mut docs = state.documents.lock();
        docs.extend(initial);
        if !docs.is_empty() {
            *state.selected.lock() = Some(0);
        }
    }

    let state_for_setup = state.clone();
    let state_for_run = state.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::load_initial_document,
            commands::open_document,
            commands::set_active_document,
            commands::close_document,
            commands::push_toc,
            commands::mark_ready,
            commands::scroll_to,
            commands::set_zoom,
        ])
        .setup(move |app| {
            let open_item = MenuItemBuilder::new("Open\u{2026}")
                .id("open")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let file_submenu = SubmenuBuilder::new(app, "File")
                .item(&open_item)
                .separator()
                .close_window()
                .build()?;

            #[cfg(target_os = "macos")]
            let menu = {
                let app_submenu = SubmenuBuilder::new(app, "ProseDown")
                    .about(None)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;
                let edit_submenu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;
                let view_submenu = SubmenuBuilder::new(app, "View").fullscreen().build()?;
                let window_submenu = SubmenuBuilder::new(app, "Window")
                    .minimize()
                    .maximize()
                    .separator()
                    .close_window()
                    .build()?;
                MenuBuilder::new(app)
                    .items(&[
                        &app_submenu,
                        &file_submenu,
                        &edit_submenu,
                        &view_submenu,
                        &window_submenu,
                    ])
                    .build()?
            };
            #[cfg(not(target_os = "macos"))]
            let menu = MenuBuilder::new(app).item(&file_submenu).build()?;

            app.set_menu(menu)?;

            if let Some(path) = state_for_setup.current() {
                start_watcher_or_log(app.handle(), state_for_setup.clone(), path);
            }
            Ok(())
        })
        .on_menu_event(|app_handle, event| {
            if event.id() == "open" {
                show_open_dialog(app_handle.clone());
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let app_handle = window.app_handle().clone();
                let state = app_handle.state::<Arc<AppState>>().inner().clone();
                let md_paths: Vec<PathBuf> =
                    paths.iter().filter(|p| has_markdown_ext(p)).cloned().collect();
                let target = if !md_paths.is_empty() {
                    md_paths
                } else {
                    paths.clone()
                };
                if !target.is_empty() {
                    open_paths(&app_handle, state, target);
                }
            }
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|err| {
            tracing::error!(error = %err, "failed to build tauri app");
            std::process::exit(1);
        });

    app.run(move |app_handle, event| {
        #[cfg(target_os = "macos")]
        {
            if let tauri::RunEvent::Opened { urls } = &event {
                let paths: Vec<PathBuf> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .collect();
                if !paths.is_empty() {
                    tracing::info!(count = paths.len(), "open-document event received");
                    open_paths(app_handle, state_for_run.clone(), paths);
                }
            }
        }
        let _ = (app_handle, &event, &state_for_run);
    });
}
