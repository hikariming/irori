// Build the release binary as a Windows GUI app (subsystem "windows") so it does
// not spawn a console window on launch. Debug builds keep the console for logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    irori_lib::run()
}
