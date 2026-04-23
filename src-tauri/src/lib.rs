//! ProseDown core — shared Rust code used by the Tauri wrapper and by any
//! alternative native shell that wants to reuse the same commands/IPC shape.

pub mod commands;
pub mod watcher;
pub mod state;

pub use state::AppState;