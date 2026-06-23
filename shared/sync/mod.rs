//! Współdzielony rdzeń synchronizacji TIMEFLOW.
//!
//! Jedyne źródło prawdy dla logiki sync używanej przez OBA crate'y binarne
//! (daemon: LAN sync; dashboard: import/restore z pliku). Crate'y binarne nie
//! mogą się nawzajem importować, więc wszystko, co było kopiowane między
//! `src/*` a `dashboard/src-tauri/src/*`, mieszka tutaj.

pub mod triggers;
pub mod checksum;
pub mod timestamp;
pub mod columns;
pub mod merge;
