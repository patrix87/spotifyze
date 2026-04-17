// Prevents the console window from appearing on Windows release builds
#![windows_subsystem = "windows"]

fn main() {
    app_lib::run();
}
