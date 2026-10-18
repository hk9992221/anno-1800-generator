#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(windows)]
mod native;
mod rda;
mod resources;
mod storage;
#[cfg(windows)]
fn main() {
    native::run();
}
#[cfg(not(windows))]
fn main() {
    eprintln!("Anno 1800 CardForge is a Windows application.");
}
