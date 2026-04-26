use std::path::PathBuf;

use parking_lot::Mutex;

use crate::watcher::FileWatcher;

/// Multi-document session state.  A single window holds an ordered list of
/// open documents and an index into that list naming the active one.
/// `add_or_select` and `select` mutate it under the lock.  Lock order:
/// `documents` is taken before `selected` (and `watcher` is independent of
/// both) — keep that order to avoid deadlocks.
#[derive(Default)]
pub struct AppState {
    pub documents: Mutex<Vec<PathBuf>>,
    pub selected: Mutex<Option<usize>>,
    pub watcher: Mutex<Option<FileWatcher>>,
}

impl AppState {
    /// Append `path` to the document list (deduping by canonical path) and
    /// make it the active document.  Returns its index in the list.
    pub fn add_or_select(&self, path: PathBuf) -> usize {
        let mut docs = self.documents.lock();
        let idx = match docs.iter().position(|p| p == &path) {
            Some(idx) => idx,
            None => {
                docs.push(path);
                docs.len() - 1
            }
        };
        drop(docs);
        *self.selected.lock() = Some(idx);
        idx
    }

    /// Set the active document by index.  Returns the new active path, or
    /// `None` when the index is out of range.
    pub fn select(&self, index: usize) -> Option<PathBuf> {
        let docs = self.documents.lock();
        let path = docs.get(index).cloned();
        drop(docs);
        if path.is_some() {
            *self.selected.lock() = Some(index);
        }
        path
    }

    /// Path of the currently-active document, if any.
    pub fn current(&self) -> Option<PathBuf> {
        let sel = *self.selected.lock();
        let docs = self.documents.lock();
        sel.and_then(|i| docs.get(i).cloned())
    }

    /// Snapshot of the document list and the active index.  Used to populate
    /// payloads for the renderer.
    pub fn snapshot(&self) -> (Vec<PathBuf>, Option<usize>) {
        let docs = self.documents.lock().clone();
        let sel = *self.selected.lock();
        (docs, sel)
    }
}
