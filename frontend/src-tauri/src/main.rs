#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod printer;

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

struct BackendProcess(Mutex<Option<Child>>);

fn is_port_listening(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

fn resolve_backend_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let res_dir = app.path().resource_dir().ok()?;
    let candidates = [
        res_dir.join("resources").join("backend"),
        res_dir.join("backend"),
    ];
    candidates.into_iter().find(|dir| {
        dir.join("node.exe").exists() && dir.join("dist").join("src").join("server.js").exists()
    })
}

fn spawn_bundled_backend(app: &tauri::AppHandle) -> Option<Child> {
    if is_port_listening(4000) {
        return None;
    }

    let backend_dir = resolve_backend_dir(app)?;
    let node_exe = backend_dir.join("node.exe");
    let server_js = backend_dir.join("dist").join("src").join("server.js");

    let mut cmd = Command::new(node_exe);
    cmd.arg(server_js).current_dir(&backend_dir);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().ok()
}

fn main() {
    let app = tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            let child = spawn_bundled_backend(app.handle());
            if let Some(c) = child {
                let state = app.state::<BackendProcess>();
                if let Ok(mut guard) = state.0.lock() {
                    *guard = Some(c);
                };
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            printer::print_thermal_receipt,
            printer::print_z_report,
            printer::trigger_cash_drawer
        ])
        .build(tauri::generate_context!())
        .expect("error while building Alamir Market POS Tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let state = app_handle.state::<BackendProcess>();
            if let Ok(mut guard) = state.0.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            };
        }
    });
}
