// Windows: konsol penceresi acmasin (debug+release her ikisi).
// Architect zaten dosyaya log yazar (logger.ts), stderr'e ihtiyac yok.
#![windows_subsystem = "windows"]

fn main() {
    ui_lib::run()
}
