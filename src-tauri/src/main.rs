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

fn parse_initial_arg() -> Option<PathBuf> {
    std::env::args_os().skip(1).find_map(|a| {
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
}

fn start_watcher_or_log(
    app_handle: &tauri::AppHandle,
    state: Arc<AppState>,
    path: PathBuf,
) {
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

/// Load `path`, start a watcher for it, and broadcast the result to the
/// renderer. Shared by menu → Open, drag-drop, and the macOS Apple Event
/// `RunEvent::Opened` path so all three behave identically.
fn open_path(app_handle: &tauri::AppHandle, state: Arc<AppState>, path: PathBuf) {
    tracing::info!(path = %path.display(), "opening document");
    {
        *state.current_path.lock() = Some(path.clone());
        *state.pending_initial.lock() = Some(path.clone());
    }
    start_watcher_or_log(app_handle, state.clone(), path.clone());
    match std::fs::read_to_string(&path) {
        Ok(source) => {
            let payload = serde_json::json!({
                "path": path.to_string_lossy().to_string(),
                "source": source,
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
    let start_dir = state
        .current_path
        .lock()
        .clone()
        .and_then(|p| p.parent().map(PathBuf::from));

    let handle_for_cb = app_handle.clone();
    let mut builder = app_handle
        .dialog()
        .file()
        .set_title("Open Markdown file")
        .add_filter("Markdown", MARKDOWN_EXTS);
    if let Some(dir) = start_dir {
        builder = builder.set_directory(dir);
    }
    builder.pick_file(move |file| {
        let Some(file) = file else { return };
        match file.into_path() {
            Ok(path) => {
                let state = handle_for_cb.state::<Arc<AppState>>().inner().clone();
                open_path(&handle_for_cb, state, path);
            }
            Err(err) => tracing::warn!(error = %err, "picked file is not a local path"),
        }
    });
}

fn main() {
    init_tracing();
    install_panic_hook();
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "prosedown starting");

    let state = Arc::new(AppState::default());
    if let Some(p) = parse_initial_arg() {
        tracing::info!(path = %p.display(), "initial document from argv");
        *state.pending_initial.lock() = Some(p);
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

            if let Some(path) = state_for_setup.pending_initial.lock().clone() {
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
                let md = paths.iter().find(|p| has_markdown_ext(p)).cloned();
                let target = md.or_else(|| paths.first().cloned());
                if let Some(path) = target {
                    open_path(&app_handle, state, path);
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
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        tracing::info!(path = %path.display(), "open-document event received");
                        open_path(app_handle, state_for_run.clone(), path);
                    } else {
                        tracing::warn!(url = %url, "open-document url is not a file path");
                    }
                }
            }
        }
        let _ = (app_handle, &event, &state_for_run);
    });
}
