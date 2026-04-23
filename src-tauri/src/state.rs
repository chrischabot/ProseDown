use std::path::PathBuf;

use parking_lot::Mutex;

use crate::watcher::FileWatcher;

#[derive(Default)]
pub struct AppState {
    pub current_path: Mutex<Option<PathBuf>>,
    pub pending_initial: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<FileWatcher>>,
}