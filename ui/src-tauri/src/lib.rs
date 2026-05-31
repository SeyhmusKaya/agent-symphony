use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command as ProcCommand, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// AUMID = tauri.conf.identifier ile esit olmali. tauri-plugin-notification
// toast'i CreateToastNotifierWithId(identifier) ile gonderiyor; AUMID
// uyusmazligi olunca Windows toast saglayicisi olarak "Windows PowerShell"
// fallback'i dusuyor. Identifier ile ayni AUMID + HKCU registry'de DisplayName
// kaydi = toast basligi kalici olarak "Agent Symphony".
#[cfg(windows)]
const APP_USER_MODEL_ID: &str = "com.seyh.architect";
#[cfg(windows)]
const APP_DISPLAY_NAME: &str = "Agent Symphony";

// Bizim notification komutumuz — tauri-plugin-notification (target/release'da
// AUMID atlatma bug'i nedeniyle "Windows PowerShell" gosteriyor) yerine
// tauri-winrt-notification ile direk Toast acar, AUMID set eder.
// M2: project_id verilirse projeler.json'dan path bulup logo dosya yolunu icon
// olarak ekler. Yoksa default app icon (AUMID IconUri) gosterilir.
#[tauri::command]
fn notify_user(
    app: AppHandle,
    title: String,
    body: String,
    project_id: Option<String>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::path::Path;
        use tauri_winrt_notification::Toast;
        let icon_path: Option<PathBuf> = project_id.as_ref().and_then(|pid| {
            let projects = read_projects(&app).ok()?;
            let proj = projects.into_iter().find(|p| &p.id == pid)?;
            find_project_logo_file(&proj.path)
        });
        let mut toast = Toast::new(APP_USER_MODEL_ID);
        toast = toast.title(&title).text1(&body);
        if let Some(p) = icon_path.as_ref() {
            // Toast::icon takes &Path. Crop=Default, alt=""
            toast = toast.icon(
                p.as_path(),
                tauri_winrt_notification::IconCrop::Square,
                "",
            );
        }
        toast.show().map_err(|e| e.to_string())?;
        let _ = title;
        let _ = body;
        let _ = (app, project_id);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, title, body, project_id);
        Ok(())
    }
}

// Disktek proje logo dosyasinin absolute path'ini bulur (varsa). scan_logo_for_path
// data URI dondururken bu fonksiyon sadece dosya yolu uretir — Windows Toast::icon
// dosya yolu istiyor.
#[cfg(windows)]
fn find_project_logo_file(project_path: &str) -> Option<PathBuf> {
    const MAX_BYTES: u64 = 600_000;
    let root = PathBuf::from(project_path);
    let dirs = [
        "", "public", "static", "assets", "src/assets", "app/assets",
        "resources", "images", "img", "src-tauri/icons", "icons",
        "frontend/public", "client/public", "web/public",
    ];
    let names = [
        "logo.png", "logo.jpg", "logo.jpeg", "logo.webp", "logo.ico",
        "icon.png", "icon.ico",
        "favicon.png", "favicon.ico",
        "apple-touch-icon.png", "128x128.png", "32x32.png",
    ];
    for d in dirs.iter() {
        for name in names.iter() {
            let p = if d.is_empty() { root.join(name) } else { root.join(d).join(name) };
            if let Ok(meta) = fs::metadata(&p) {
                if meta.is_file() && meta.len() <= MAX_BYTES {
                    return Some(p);
                }
            }
        }
    }
    None
}

// Windows Toast bildirimlerinde basligin "Windows PowerShell" yerine
// "Agent Symphony" gozukmesi icin AppUserModelID set ediyoruz. AUMID
// process-bazli set edildikten sonra Start Menu'de bir shortcut da
// olusturulup uzerine ayni AUMID property'si yazilirsa Windows Toast
// API bunu kalici olarak benimser ve toast'in saglayici basligini
// shortcut'in adina (ya da AUMID'e bagli DisplayName'e) baglar.
#[cfg(windows)]
fn set_app_user_model_id() {
    use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let mut wide: Vec<u16> = APP_USER_MODEL_ID.encode_utf16().collect();
    wide.push(0);
    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(wide.as_ptr());
    }
}

// HKCU\Software\Classes\AppUserModelId\<AUMID> altinda DisplayName + IconUri
// kaydi. Windows Toast Notification API bu kaydi gorunce toast saglayicisi
// olarak DisplayName'i kullanir; AUMID kayitli degilse "Windows PowerShell"
// veya callerin .exe adi fallback'i dusuyor. Idempotent.
#[cfg(windows)]
fn register_aumid_in_registry() {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return,
    };
    let exe_str = exe.to_string_lossy().replace('\'', "''");
    let aumid = APP_USER_MODEL_ID;
    let name = APP_DISPLAY_NAME;
    let script = format!(
        r#"$ErrorActionPreference='SilentlyContinue'
$key='HKCU:\Software\Classes\AppUserModelId\{aumid}'
if(-not (Test-Path $key)){{ New-Item -Path $key -Force | Out-Null }}
Set-ItemProperty -Path $key -Name 'DisplayName' -Value '{name}' -Type String
Set-ItemProperty -Path $key -Name 'IconUri' -Value '{exe}' -Type ExpandString
"#,
        aumid = aumid,
        name = name,
        exe = exe_str,
    );
    let mut cmd = ProcCommand::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    hide_console(&mut cmd);
    let _ = cmd.output();
}

// Start Menu'de Agent Symphony.lnk olustur ve AUMID'i shortcut'in
// property store'una yaz. Bu, Windows Toast API'sinin AUMID'i kalici
// olarak taniyip toast saglayicisi (toast'in en ust kucuk baslik
// alanini) shortcut adina baglamasini saglar. Shortcut zaten varsa
// AUMID property'sini tekrar yazma — idempotent.
#[cfg(windows)]
fn install_start_menu_shortcut() {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return,
    };
    let exe_str = exe.to_string_lossy().replace('\'', "''");
    let aumid = APP_USER_MODEL_ID;
    let script = format!(
        r#"$ErrorActionPreference='SilentlyContinue'
$AppId='{aumid}'
$AppName='Agent Symphony'
$Exe='{exe}'
$StartMenu=[Environment]::GetFolderPath('Programs')
$Link=Join-Path $StartMenu ($AppName+'.lnk')
if(-not(Test-Path $Link)){{
  $WshShell=New-Object -ComObject WScript.Shell
  $Sc=$WshShell.CreateShortcut($Link)
  $Sc.TargetPath=$Exe
  $Sc.WorkingDirectory=(Split-Path $Exe)
  $Sc.Save()
}}
# AUMID'i shortcut'in property store'una yaz (System.AppUserModel.ID)
$code=@'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class ShellLinkAumid {{
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, PreserveSig=false)]
  static extern void SHCreateItemFromParsingName([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr pbc, [In] ref Guid riid, [Out, MarshalAs(UnmanagedType.Interface)] out object ppv);
  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {{
    [PreserveSig] int GetCount(out uint c);
    [PreserveSig] int GetAt(uint i, out PropertyKey k);
    [PreserveSig] int GetValue(ref PropertyKey k, out PropVariant v);
    [PreserveSig] int SetValue(ref PropertyKey k, ref PropVariant v);
    [PreserveSig] int Commit();
  }}
  [StructLayout(LayoutKind.Sequential)] public struct PropertyKey {{ public Guid fmtid; public uint pid; }}
  [StructLayout(LayoutKind.Explicit)] public struct PropVariant {{
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pwszVal;
  }}
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant v);
  static Guid IID_IPropertyStore = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
  public static void Set(string lnk, string aumid){{
    object o; SHCreateItemFromParsingName(lnk, IntPtr.Zero, ref IID_IPropertyStore, out o);
    var ps = (IPropertyStore)o;
    var key = new PropertyKey {{ fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 }};
    var pv = new PropVariant {{ vt = 31, pwszVal = Marshal.StringToCoTaskMemUni(aumid) }}; // VT_LPWSTR
    ps.SetValue(ref key, ref pv);
    ps.Commit();
    PropVariantClear(ref pv);
    Marshal.ReleaseComObject(ps);
  }}
}}
'@
try{{
  Add-Type -TypeDefinition $code -Language CSharp -ErrorAction Stop
  [ShellLinkAumid]::Set($Link,$AppId)
}}catch{{}}
"#,
        aumid = aumid,
        exe = exe_str,
    );
    let mut cmd = ProcCommand::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    hide_console(&mut cmd);
    let _ = cmd.output();
}

fn hide_console(cmd: &mut ProcCommand) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;

// Fix 132: Webview navigasyon guard (guvenlik agi). Sef chat'indeki bir link
// JS interceptor'i atlatsa bile (ornek: yeni render yolu, event capture sirasi)
// app'in kendi origin'i disindaki http(s) adreslere IN-WEBVIEW gitmesini engeller
// ve adresi isletim sisteminin varsayilan tarayicisinda acar. Boylece app asla
// harici bir sayfada (Google login vb.) mahsur kalmaz.
//
// `app_handle` tum pencerelere uygulanan ayni guard'i paylasir. on_navigation
// closure'u `Fn(&Url) -> bool` — true = navigasyona izin ver, false = engelle.
fn nav_guard(app: &AppHandle, url: &tauri::Url) -> bool {
    let scheme = url.scheme();
    // App'in kendi sayfalari: tauri:// (prod) ve http://localhost:1420 (dev devUrl).
    // Windows'ta prod origin http://tauri.localhost olabilir — host bazli kontrol.
    let host = url.host_str().unwrap_or("");
    let is_app_origin = scheme == "tauri"
        || host == "tauri.localhost"
        || (host == "localhost" && url.port() == Some(1420));
    // http(s) olmayan (data:, blob:, about:, mailto: vb.) sema'lara karisma —
    // webview'in normal davranisi.
    let is_external_http = (scheme == "http" || scheme == "https") && !is_app_origin;
    if is_external_http {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
        return false; // in-webview navigasyonu engelle
    }
    true
}

#[derive(Default)]
struct OrchestratorState(Mutex<HashMap<String, (u16, Child)>>);

fn orchestrator_entry() -> Option<PathBuf> {
    if let Ok(env) = std::env::var("ARCHITECT_ORCHESTRATOR") {
        let p = PathBuf::from(env);
        if p.exists() {
            return Some(p);
        }
    }
    let exe = std::env::current_exe().ok()?;
    for ancestor in exe.ancestors() {
        let candidate = ancestor.join("orchestrator").join("main.ts");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn ensure_orchestrator(app: &AppHandle, id: &str, project_path: &str) -> u16 {
    let state = app.state::<OrchestratorState>();
    let mut map = match state.0.lock() {
        Ok(m) => m,
        Err(_) => return 4320,
    };
    // Cached port varsa once canli mi diye kontrol et; olmusse map'ten sil
    // ve yeniden spawn et. Aksi halde stale port donup UI hic baglanamaz.
    if let Some((p, _)) = map.get(id) {
        if port_alive(*p) {
            return *p;
        }
        // port oldu — asagida yeniden spawn edilecek
        map.remove(id);
    }
    match map.get(id) {
        Some((p, _)) => *p, // remove sonrasi buraya dusmez ama guard olarak kaliyor
        None => {
            // Cakisma riski: map.len() advisor/global/tunnel sayisini icerir,
            // ama bazi entry'ler asagi sira ile kullanildiysa duplicate.
            // Bos port tara — 4320'den baslayip kullanilmayani bul.
            // KRITIK (port cakisma fix): proje sefi portlari ADVISOR aralginin
            // USTUNDEN baslamali. Advisor/Mimar portlari: 4305-4315 danismanlar +
            // Mimar 4316 + urun 4317 + ai 4318 + sunucu 4319 (bkz. ADVISORS).
            // Eski base 4317 idi -> proje sefi 4317'ye atanip urun advisor ile
            // ayni porta dusuyordu; UI proje sekmesi yanlislikla "Urun Yoneticisi"
            // advisor WS'ine baglanip onun session'ini gosteriyordu. 4320 base ile
            // proje sefleri 4305-4319'a ASLA dokunmaz.
            let used: std::collections::HashSet<u16> =
                map.values().map(|(p, _)| *p).collect();
            let mut assigned = 4320u16;
            while used.contains(&assigned) || port_alive(assigned) {
                assigned = assigned.saturating_add(1);
                if assigned > 4500 {
                    assigned = 4320;
                    break;
                }
            }
            if let Some(child) = spawn_orchestrator(assigned, project_path) {
                map.insert(id.to_string(), (assigned, child));
            }
            assigned
        }
    }
}

#[cfg(windows)]
fn cleanup_orphan_orchestrators() {
    use std::collections::HashSet;
    // CMD flash fix: her ProcCommand'a hide_console — yoksa netstat/tasklist/
    // taskkill her cagrida bir console acip kapatir, startup'ta 30+ cmd flash.
    let mut netstat = ProcCommand::new("netstat");
    netstat.arg("-ano");
    hide_console(&mut netstat);
    let out = match netstat.output() {
        Ok(o) => o,
        Err(_) => return,
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut pids: HashSet<String> = HashSet::new();
    for line in stdout.lines() {
        if !line.contains("LISTENING") {
            continue;
        }
        let trimmed = line.trim();
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }
        let local = parts[1];
        let port: u16 = match local.rsplit(':').next().and_then(|s| s.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        if !(4305..=4500).contains(&port) {
            continue;
        }
        if let Some(pid) = parts.last() {
            pids.insert(pid.to_string());
        }
    }
    for pid in pids {
        // sadece node.exe oldur — yanlislikla baska bir surec olmasin
        let mut tl = ProcCommand::new("tasklist");
        tl.args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"]);
        hide_console(&mut tl);
        let chk = tl.output();
        if let Ok(chk) = chk {
            let s = String::from_utf8_lossy(&chk.stdout);
            if s.to_lowercase().contains("node.exe") {
                let mut tk = ProcCommand::new("taskkill");
                tk.args(["/F", "/PID", &pid]);
                hide_console(&mut tk);
                let _ = tk.output();
            }
        }
    }
}

fn kill_all_orchestrators(app: &AppHandle) {
    let state = app.state::<OrchestratorState>();
    let mut map = match state.0.lock() {
        Ok(m) => m,
        Err(_) => return,
    };
    for (_, (_, mut child)) in map.drain() {
        let _ = child.kill();
    }
}

fn spawn_orchestrator(port: u16, project_path: &str) -> Option<Child> {
    let entry = orchestrator_entry()?;
    let repo_root = entry.parent()?.parent()?.to_path_buf();
    let mut cmd = ProcCommand::new("node");
    cmd.arg("--import")
        .arg("tsx")
        .arg(&entry)
        .arg(port.to_string())
        .arg(project_path)
        .current_dir(&repo_root);
    hide_console(&mut cmd);
    cmd.spawn().ok()
}

fn spawn_global_orchestrator(port: u16) -> Option<Child> {
    let entry = orchestrator_entry()?;
    let repo_root = entry.parent()?.parent()?.to_path_buf();
    let mut cmd = ProcCommand::new("node");
    cmd.arg("--import")
        .arg("tsx")
        .arg(&entry)
        .arg(port.to_string())
        .arg("--global")
        .current_dir(&repo_root);
    hide_console(&mut cmd);
    cmd.spawn().ok()
}

// Danisman ajanlar — anahtar ve sabit port. advisors.ts ile ayni olmali.
const ADVISORS: &[(&str, u16)] = &[
    ("pazarlama", 4310),
    ("seo", 4311),
    ("trading", 4312),
    ("sosyal-medya", 4313),
    ("uxtasarim", 4305),
    ("hukuk", 4306),
    ("veri", 4307),
    ("finans", 4308),
    ("devops", 4309),
    ("siber-guvenlik", 4315),
    ("urun", 4317),
    ("ai", 4318),
    ("sunucu", 4319),
];

fn spawn_advisor(key: &str, port: u16) -> Option<Child> {
    let entry = orchestrator_entry()?;
    let repo_root = entry.parent()?.parent()?.to_path_buf();
    let mut cmd = ProcCommand::new("node");
    cmd.arg("--import")
        .arg("tsx")
        .arg(&entry)
        .arg(port.to_string())
        .arg("--advisor")
        .arg(key)
        .current_dir(&repo_root);
    hide_console(&mut cmd);
    cmd.spawn().ok()
}

fn ensure_advisors(app: &AppHandle) {
    let state = app.state::<OrchestratorState>();
    let mut map = match state.0.lock() {
        Ok(m) => m,
        Err(_) => return,
    };
    for (key, port) in ADVISORS {
        let id = format!("__advisor_{}__", key);
        if map.contains_key(&id) {
            continue;
        }
        if let Some(child) = spawn_advisor(key, *port) {
            map.insert(id, (*port, child));
        }
    }
}

// Windows-MCP HTTP sidecar — stdio yerine streamable-http kullaniyoruz ki
// MCP client connect/disconnect yapsa bile sunucu canli kalsin. Stdio mod
// her SDK turn'unde process'i yeniden baslatip kararsizlik uretiyordu.
const WINDOWS_MCP_PORT: u16 = 17893;

fn spawn_windows_mcp(port: u16) -> Option<Child> {
    let mut cmd = ProcCommand::new("uvx");
    cmd.arg("windows-mcp")
        .arg("serve")
        .arg("--transport")
        .arg("streamable-http")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        // uv'nin "Resolving..." ilerleme satirini bastir — CMD flash onlenir.
        .env("UV_NO_PROGRESS", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut cmd);
    cmd.spawn().ok()
}

fn ensure_windows_mcp(app: &AppHandle) {
    let state = app.state::<OrchestratorState>();
    let mut map = match state.0.lock() {
        Ok(m) => m,
        Err(_) => return,
    };
    if map.contains_key("__windows_mcp__") {
        return;
    }
    if let Some(child) = spawn_windows_mcp(WINDOWS_MCP_PORT) {
        map.insert("__windows_mcp__".to_string(), (WINDOWS_MCP_PORT, child));
    }
}

// Web erisim tuneli (relay/tunnel.ts) — arc.volpora.com PC'ye ulasabilsin.
fn spawn_tunnel() -> Option<Child> {
    let entry = orchestrator_entry()?;
    let repo_root = entry.parent()?.parent()?.to_path_buf();
    let tunnel = repo_root.join("relay").join("tunnel.ts");
    if !tunnel.exists() {
        return None;
    }
    let mut cmd = ProcCommand::new("node");
    cmd.arg("--import")
        .arg("tsx")
        .arg(&tunnel)
        .current_dir(&repo_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut cmd);
    cmd.spawn().ok()
}

/// Onceki Tauri oturumlari kapaninca (rebuild_ui, restart_self) olarak kalan
/// orphan tunnel.ts node proseslerini temizle. Bunlar job object olmadigi icin
/// parent olunca otomatik olmuyor; startup'ta fazladan process birikmesini onler.
#[cfg(windows)]
fn cleanup_orphan_tunnels() {
    let mut cmd = ProcCommand::new("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*tunnel.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    hide_console(&mut cmd);
    let _ = cmd.output();
}

fn ensure_tunnel(app: &AppHandle) {
    let state = app.state::<OrchestratorState>();
    let mut map = match state.0.lock() {
        Ok(m) => m,
        Err(_) => return,
    };
    if map.contains_key("__tunnel__") {
        return;
    }
    if let Some(child) = spawn_tunnel() {
        map.insert("__tunnel__".to_string(), (0, child));
    }
}

fn ensure_global_orchestrator(app: &AppHandle) {
    let state = app.state::<OrchestratorState>();
    let mut map = match state.0.lock() {
        Ok(m) => m,
        Err(_) => return,
    };
    if map.contains_key("__global__") {
        return;
    }
    if let Some(child) = spawn_global_orchestrator(4316) {
        map.insert("__global__".to_string(), (4316, child));
    }
}

fn port_alive(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addr: SocketAddr = match format!("127.0.0.1:{}", port).parse() {
        Ok(a) => a,
        Err(_) => return true,
    };
    TcpStream::connect_timeout(&addr, Duration::from_secs(2)).is_ok()
}

fn respawn_entry(app: &AppHandle, id: &str, port: u16, advisor_key: Option<&str>) {
    let state = app.state::<OrchestratorState>();
    let mut map = match state.0.lock() {
        Ok(m) => m,
        Err(_) => return,
    };
    if let Some((_, mut child)) = map.remove(id) {
        let _ = child.kill();
    }
    let child = match advisor_key {
        Some(k) => spawn_advisor(k, port),
        None => spawn_global_orchestrator(port),
    };
    if let Some(c) = child {
        map.insert(id.to_string(), (port, c));
    }
}

/// pending-update.json varsa supervisor.js calisiyor demektir; watchdog
/// karismasin. Marker eski ise (>120s) terk edilmis say, yoksay.
fn update_in_progress(app: &AppHandle) -> bool {
    let dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return false,
    };
    let marker = dir.join("pending-update.json");
    let meta = match fs::metadata(&marker) {
        Ok(m) => m,
        Err(_) => return false,
    };
    let modified = match meta.modified() {
        Ok(t) => t,
        Err(_) => return true,
    };
    match SystemTime::now().duration_since(modified) {
        Ok(age) => age < Duration::from_secs(120),
        Err(_) => true,
    }
}

/// Mimar ve danisman ajanlar dustugunde otomatik yeniden baslatir.
fn start_watchdog(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(45));

        if update_in_progress(&app) {
            // restart_self suruyor; supervisor.js orchestrator'i kaldiriyor.
            // Yarisi onlemek icin bu turu atla.
            respawn_tunnel_if_dead(&app);
            continue;
        }

        if !port_alive(4316) {
            respawn_entry(&app, "__global__", 4316, None);
        }
        for (key, port) in ADVISORS {
            if !port_alive(*port) {
                respawn_entry(&app, &format!("__advisor_{}__", key), *port, Some(key));
            }
        }

        // Windows-MCP HTTP sidecar — port olmamissa respawn.
        if !port_alive(WINDOWS_MCP_PORT) {
            respawn_windows_mcp(&app);
        }

        // Tunel — process oldu mu kontrol et (port dinlemiyor), oldyse respawn.
        respawn_tunnel_if_dead(&app);
    });
}

fn respawn_windows_mcp(app: &AppHandle) {
    let state = app.state::<OrchestratorState>();
    let mut map = match state.0.lock() {
        Ok(m) => m,
        Err(_) => return,
    };
    if let Some((_, mut child)) = map.remove("__windows_mcp__") {
        let _ = child.kill();
    }
    if let Some(child) = spawn_windows_mcp(WINDOWS_MCP_PORT) {
        map.insert("__windows_mcp__".to_string(), (WINDOWS_MCP_PORT, child));
    }
}

fn respawn_tunnel_if_dead(app: &AppHandle) {
    let state = app.state::<OrchestratorState>();
    let mut map = match state.0.lock() {
        Ok(m) => m,
        Err(_) => return,
    };
    let dead = match map.get_mut("__tunnel__") {
        Some((_, child)) => matches!(child.try_wait(), Ok(Some(_))),
        None => true,
    };
    if dead {
        if let Some((_, mut c)) = map.remove("__tunnel__") {
            let _ = c.kill();
        }
        if let Some(child) = spawn_tunnel() {
            map.insert("__tunnel__".to_string(), (0, child));
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct Project {
    id: String,
    name: String,
    path: String,
    #[serde(rename = "lastOpened")]
    last_opened: u64,
    #[serde(rename = "logoUri", default, skip_serializing_if = "Option::is_none")]
    logo_uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    deployment: Option<Deployment>,
    #[serde(rename = "reportEnabled", default, skip_serializing_if = "Option::is_none")]
    report_enabled: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Deployment {
    /// "local" | "remote" | "hibrit"
    mode: String,
    #[serde(rename = "serverIds", default)]
    server_ids: Vec<String>,
    #[serde(rename = "deployScript", default, skip_serializing_if = "Option::is_none")]
    deploy_script: Option<String>,
    #[serde(rename = "publicUrl", default, skip_serializing_if = "Option::is_none")]
    public_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Server {
    id: String,
    name: String,
    host: String,
    #[serde(default = "default_port")]
    port: u16,
    user: String,
    /// "password" | "key"
    #[serde(rename = "authType")]
    auth_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password: Option<String>,
    #[serde(rename = "privateKeyPath", default, skip_serializing_if = "Option::is_none")]
    private_key_path: Option<String>,
    #[serde(rename = "panelUrl", default, skip_serializing_if = "Option::is_none")]
    panel_url: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}

fn default_port() -> u16 {
    22
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn projects_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir.join("projects.json"))
}

fn read_projects(app: &AppHandle) -> Result<Vec<Project>, String> {
    let file = projects_file(app)?;
    if !file.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_projects(app: &AppHandle, projects: &[Project]) -> Result<(), String> {
    let file = projects_file(app)?;
    let raw = serde_json::to_string_pretty(projects).map_err(|e| e.to_string())?;
    fs::write(&file, raw).map_err(|e| e.to_string())
}

fn servers_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir.join("servers.json"))
}

fn read_servers(app: &AppHandle) -> Result<Vec<Server>, String> {
    let file = servers_file(app)?;
    if !file.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_servers(app: &AppHandle, servers: &[Server]) -> Result<(), String> {
    let file = servers_file(app)?;
    let raw = serde_json::to_string_pretty(servers).map_err(|e| e.to_string())?;
    fs::write(&file, raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_servers(app: AppHandle) -> Result<Vec<Server>, String> {
    read_servers(&app)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn add_server(
    app: AppHandle,
    name: String,
    host: String,
    port: Option<u16>,
    user: String,
    auth_type: String,
    password: Option<String>,
    private_key_path: Option<String>,
    panel_url: Option<String>,
    tags: Option<Vec<String>>,
    notes: Option<String>,
) -> Result<Server, String> {
    let mut servers = read_servers(&app)?;
    let srv = Server {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        host,
        port: port.unwrap_or(22),
        user,
        auth_type,
        password,
        private_key_path,
        panel_url,
        tags: tags.unwrap_or_default(),
        notes,
    };
    servers.push(srv.clone());
    write_servers(&app, &servers)?;
    Ok(srv)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn update_server(
    app: AppHandle,
    id: String,
    name: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    auth_type: Option<String>,
    password: Option<String>,
    private_key_path: Option<String>,
    panel_url: Option<String>,
    tags: Option<Vec<String>>,
    notes: Option<String>,
) -> Result<Server, String> {
    let mut servers = read_servers(&app)?;
    let s = servers
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "Sunucu bulunamadi".to_string())?;
    if let Some(v) = name { s.name = v; }
    if let Some(v) = host { s.host = v; }
    if let Some(v) = port { s.port = v; }
    if let Some(v) = user { s.user = v; }
    if let Some(v) = auth_type { s.auth_type = v; }
    if password.is_some() { s.password = password; }
    if private_key_path.is_some() { s.private_key_path = private_key_path; }
    if panel_url.is_some() { s.panel_url = panel_url; }
    if let Some(v) = tags { s.tags = v; }
    if notes.is_some() { s.notes = notes; }
    let result = s.clone();
    write_servers(&app, &servers)?;
    Ok(result)
}

#[tauri::command]
fn delete_server(app: AppHandle, id: String) -> Result<(), String> {
    let mut servers = read_servers(&app)?;
    servers.retain(|s| s.id != id);
    write_servers(&app, &servers)
}

// M1 fix: previously a SYNC tauri command that polled with `std::thread::sleep`.
// On Windows the IPC handler runs on the WebView thread; sync command + sleep
// loop blocked UI for 15s. Converted to async + tauri::async_runtime so the
// blocking subprocess wait runs off the IPC thread.
#[tauri::command]
async fn test_server_connection(app: AppHandle, id: String) -> Result<String, String> {
    let servers = read_servers(&app)?;
    let s = servers
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "Sunucu bulunamadi".to_string())?;
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let mut cmd = ProcCommand::new("plink");
        // P1.33: -batch zorunlu — known_hosts prompt'unda asilmasin. Eski
        // surum stdin'e "y\n" yaziyordu ama race ile plink ya da prompt'tan
        // once exit ediyor ya da hicbir zaman okumuyor → 15sn timeout.
        // -v: verbose stderr (auth/channel asamasini gor). Timeout'ta "Access
        // granted" varsa hata SUNUCU-TARAFI session hang'idir, ag/firewall degil.
        cmd.arg("-ssh").arg("-batch").arg("-v").arg("-P").arg(s.port.to_string());
        if s.auth_type == "password" {
            if let Some(pw) = &s.password {
                cmd.arg("-pw").arg(pw);
            } else {
                return Err("Sifre yok".to_string());
            }
        } else if let Some(kp) = &s.private_key_path {
            cmd.arg("-i").arg(kp);
        }
        cmd.arg(format!("{}@{}", s.user, s.host)).arg("echo OK");
        hide_console(&mut cmd);
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        // P1.33: stdin'e y/n yazma kaldirildi — -batch zaten prompt'u devre disi.
        let mut child = cmd.spawn().map_err(|e| format!("plink spawn: {}", e))?;
        let start = std::time::Instant::now();
        // P1.33: 15sn -> 30sn. TCP handshake + auth + komut ~2-5sn normal,
        // ama known_hosts ilk-yazim + DNS bazi networklerde 10sn+ aliyor.
        let timeout = Duration::from_secs(30);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let mut stdout = String::new();
                    let mut stderr = String::new();
                    use std::io::Read;
                    if let Some(mut o) = child.stdout.take() {
                        let _ = o.read_to_string(&mut stdout);
                    }
                    if let Some(mut e) = child.stderr.take() {
                        let _ = e.read_to_string(&mut stderr);
                    }
                    if status.success() {
                        return Ok(stdout.trim().to_string());
                    }
                    // P1.33: stderr stdout'tan once goster — gercek hata mesaji
                    // (host key uyari, auth fail, network err) burada cikar.
                    let err_msg = if !stderr.trim().is_empty() {
                        stderr.trim().to_string()
                    } else if !stdout.trim().is_empty() {
                        stdout.trim().to_string()
                    } else {
                        format!("plink exit {:?}", status.code())
                    };
                    return Err(err_msg);
                }
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        let _ = child.kill();
                        // P1.33: kill sonrasi stderr/stdout yakala — host
                        // key uyarisi gibi mesajlari kullaniciya goster.
                        let mut stderr = String::new();
                        let mut stdout = String::new();
                        use std::io::Read;
                        if let Some(mut e) = child.stderr.take() {
                            let _ = e.read_to_string(&mut stderr);
                        }
                        if let Some(mut o) = child.stdout.take() {
                            let _ = o.read_to_string(&mut stdout);
                        }
                        // Auth gecmis ama oturum acilmamissa: ag/firewall DEGIL,
                        // sunucu-tarafi session hang (disk dolu / logind / pam).
                        if stderr.contains("Access granted") {
                            return Err(format!(
                                "Sunucu ({}:{}) auth'u KABUL etti ama SSH oturumu acmiyor (timeout {}s). Ag/sifre saglam — sorun sunucuda: disk dolu / systemd-logind / pam_motd. Hetzner console'dan kontrol: df -h, systemctl status systemd-logind, journalctl -xe.",
                                s.host, s.port, timeout.as_secs()
                            ));
                        }
                        let detail = if !stderr.trim().is_empty() {
                            format!(" | stderr: {}", stderr.trim())
                        } else if !stdout.trim().is_empty() {
                            format!(" | stdout: {}", stdout.trim())
                        } else {
                            String::new()
                        };
                        return Err(format!(
                            "Timeout ({}sn) — sunucuya {}:{} ulasilamiyor (firewall / network / port mu?){}",
                            timeout.as_secs(), s.host, s.port, detail
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(e) => return Err(format!("try_wait: {}", e)),
            }
        }
    })
    .await
    .map_err(|e| format!("join: {}", e))?
}

#[tauri::command]
fn set_project_deployment(
    app: AppHandle,
    id: String,
    deployment: serde_json::Value,
) -> Result<(), String> {
    let mut projects = read_projects(&app)?;
    let p = projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "Proje bulunamadi".to_string())?;
    if deployment.is_null() {
        p.deployment = None;
    } else {
        let d: Deployment = serde_json::from_value(deployment).map_err(|e| e.to_string())?;
        p.deployment = Some(d);
    }
    write_projects(&app, &projects)
}

#[tauri::command]
fn set_project_report_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut projects = read_projects(&app)?;
    let p = projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "Proje bulunamadi".to_string())?;
    p.report_enabled = Some(enabled);
    write_projects(&app, &projects)
}

#[tauri::command]
fn list_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    let mut projects = read_projects(&app)?;
    projects.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(projects)
}

#[tauri::command]
fn add_project(app: AppHandle, name: String, path: String) -> Result<Project, String> {
    let mut projects = read_projects(&app)?;
    if let Some(existing) = projects.iter_mut().find(|p| p.path == path) {
        existing.last_opened = now_ms();
        let result = existing.clone();
        write_projects(&app, &projects)?;
        return Ok(result);
    }
    let scanned_logo = scan_logo_for_path(&path);
    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        path,
        last_opened: now_ms(),
        logo_uri: scanned_logo,
        deployment: None,
        report_enabled: None,
    };
    projects.push(project.clone());
    write_projects(&app, &projects)?;
    Ok(project)
}

// Proje klasoru icinde logo dosyasi ara. Bulunursa data URL dondur.
// Aranan yerler: kok, public/, static/, src/assets/, assets/
// Dosya adlari: logo.{png,jpg,jpeg,svg,webp}, icon.png, favicon.png
fn scan_logo_for_path(project_path: &str) -> Option<String> {
    const MAX_BYTES: u64 = 600_000; // 600 KB
    let root = PathBuf::from(project_path);
    let dirs = [
        "", "public", "static", "assets", "src/assets", "app/assets",
        "resources", "images", "img", "src-tauri/icons", "icons",
        "frontend/public", "client/public", "web/public",
    ];
    let names = [
        ("logo.png", "image/png"),
        ("logo.svg", "image/svg+xml"),
        ("logo.jpg", "image/jpeg"),
        ("logo.jpeg", "image/jpeg"),
        ("logo.webp", "image/webp"),
        ("logo.ico", "image/x-icon"),
        ("icon.png", "image/png"),
        ("icon.svg", "image/svg+xml"),
        ("icon.ico", "image/x-icon"),
        ("favicon.png", "image/png"),
        ("favicon.svg", "image/svg+xml"),
        ("favicon.ico", "image/x-icon"),
        ("apple-touch-icon.png", "image/png"),
        ("128x128.png", "image/png"),
        ("32x32.png", "image/png"),
    ];
    use base64::Engine;
    for d in dirs.iter() {
        for (name, mime) in names.iter() {
            let p = if d.is_empty() {
                root.join(name)
            } else {
                root.join(d).join(name)
            };
            if let Ok(meta) = fs::metadata(&p) {
                if meta.is_file() && meta.len() <= MAX_BYTES {
                    if let Ok(bytes) = fs::read(&p) {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                        return Some(format!("data:{};base64,{}", mime, b64));
                    }
                }
            }
        }
    }
    None
}

#[tauri::command]
fn rename_project(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Isim bos olamaz".to_string());
    }
    let mut projects = read_projects(&app)?;
    if let Some(p) = projects.iter_mut().find(|p| p.id == id) {
        p.name = trimmed.to_string();
    } else {
        return Err("Proje bulunamadi".to_string());
    }
    write_projects(&app, &projects)
}

#[tauri::command]
fn refresh_project_logo(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let mut projects = read_projects(&app)?;
    let proj = projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "Proje bulunamadi".to_string())?;
    let logo = scan_logo_for_path(&proj.path);
    proj.logo_uri = logo.clone();
    write_projects(&app, &projects)?;
    Ok(logo)
}

#[tauri::command]
fn refresh_all_logos(app: AppHandle) -> Result<Vec<Project>, String> {
    let mut projects = read_projects(&app)?;
    for p in projects.iter_mut() {
        p.logo_uri = scan_logo_for_path(&p.path);
    }
    write_projects(&app, &projects)?;
    projects.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(projects)
}

#[tauri::command]
fn touch_project(app: AppHandle, id: String) -> Result<(), String> {
    let mut projects = read_projects(&app)?;
    if let Some(p) = projects.iter_mut().find(|p| p.id == id) {
        p.last_opened = now_ms();
    }
    write_projects(&app, &projects)
}

#[tauri::command]
fn remove_project(app: AppHandle, id: String) -> Result<(), String> {
    let mut projects = read_projects(&app)?;
    if let Some(pos) = projects.iter().position(|p| p.id == id) {
        let removed = projects.remove(pos);
        let team = PathBuf::from(&removed.path).join(".team");
        if team.exists() {
            let _ = fs::remove_dir_all(&team);
        }
    }
    write_projects(&app, &projects)
}

#[tauri::command]
fn open_project_window(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let label = format!("project-{}", id);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return Ok(());
    }
    let title = format!("Architect — {}", name);
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let nav_app = app2.clone();
        match WebviewWindowBuilder::new(&app2, &label, WebviewUrl::App("index.html".into()))
            .title(title)
            .inner_size(1280.0, 820.0)
            .min_inner_size(900.0, 560.0)
            .center()
            // Fix 132: harici link guard — proje penceresinde de chat link'leri
            // OS tarayicisinda acilsin, app harici sayfaya dusmesin.
            .on_navigation(move |url| nav_guard(&nav_app, url))
            .build()
        {
            Ok(window) => {
                #[cfg(debug_assertions)]
                window.open_devtools();
            }
            Err(e) => eprintln!("[proje-penceresi] olusturma hatasi: {}", e),
        }
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn start_project(app: AppHandle, id: String) -> Result<u16, String> {
    let project = read_projects(&app)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "Proje bulunamadi".to_string())?;
    Ok(ensure_orchestrator(&app, &id, &project.path))
}

#[derive(Deserialize)]
struct UsageRecord {
    date: String,
    input: u64,
    output: u64,
}

#[derive(Serialize)]
struct DayUsage {
    date: String,
    input: u64,
    output: u64,
}

#[tauri::command]
fn aggregate_usage(app: AppHandle) -> Result<Vec<DayUsage>, String> {
    let projects = read_projects(&app)?;
    let mut files: Vec<PathBuf> = projects
        .into_iter()
        .map(|p| PathBuf::from(&p.path).join(".team").join("usage.json"))
        .collect();
    // Global ekibin (Architect + advisor agents) usage'ini da topla.
    if let Ok(app_dir) = app.path().app_data_dir() {
        files.push(app_dir.join("global").join(".team").join("usage.json"));
        // Advisor agents (her biri kendi global/<key>/.team altinda olabilir)
        let advisors_root = app_dir.join("global");
        if let Ok(rd) = fs::read_dir(&advisors_root) {
            for ent in rd.flatten() {
                let p = ent.path().join(".team").join("usage.json");
                if p.exists() {
                    files.push(p);
                }
            }
        }
    }
    let mut by_date: std::collections::HashMap<String, (u64, u64)> =
        std::collections::HashMap::new();
    for file in files {
        if !file.exists() {
            continue;
        }
        let raw = match fs::read_to_string(&file) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if raw.trim().is_empty() {
            continue;
        }
        let records: Vec<UsageRecord> = match serde_json::from_str(&raw) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for rec in records {
            let entry = by_date.entry(rec.date).or_insert((0, 0));
            entry.0 += rec.input;
            entry.1 += rec.output;
        }
    }
    let mut days: Vec<DayUsage> = by_date
        .into_iter()
        .map(|(date, (input, output))| DayUsage {
            date,
            input,
            output,
        })
        .collect();
    days.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(days)
}

// Madde 2 & 3: delege orani + batch verimliligi telemetrisi.
#[derive(Deserialize, Serialize, Clone)]
struct TurnMetricRec {
    ts: i64,
    #[serde(default)]
    sef: u64,
    #[serde(default)]
    delegate: u64,
    #[serde(default)]
    task: u64,
    #[serde(default)]
    spawn_worker: u64,
    #[serde(default)]
    other: u64,
    #[serde(default)]
    tool_count: u64,
    #[serde(default)]
    round_count: u64,
}

#[derive(Serialize)]
struct TurnMetricsSummary {
    delegation_rate: f64,         // %
    delegation_total: u64,        // toplam tool cagrisi
    delegation_count: u64,        // delege edilen tool
    batch_efficiency: f64,        // ortalama tool/round
    batch_turns: u64,             // hesaba katilan tur sayisi
    recent: Vec<TurnMetricRec>,   // son N tur (sparkline icin)
    window_hours: u64,
}

#[tauri::command]
fn turn_metrics_summary(app: AppHandle, window_hours: Option<u64>) -> Result<TurnMetricsSummary, String> {
    let win_h = window_hours.unwrap_or(24);
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let cutoff_ms = now_ms - (win_h as i64 * 3600 * 1000);
    let projects = read_projects(&app)?;
    let mut files: Vec<PathBuf> = projects
        .into_iter()
        .map(|p| PathBuf::from(&p.path).join(".team").join("turnMetrics.json"))
        .collect();
    if let Ok(app_dir) = app.path().app_data_dir() {
        files.push(app_dir.join("global").join(".team").join("turnMetrics.json"));
        let advisors_root = app_dir.join("global");
        if let Ok(rd) = fs::read_dir(&advisors_root) {
            for ent in rd.flatten() {
                let p = ent.path().join(".team").join("turnMetrics.json");
                if p.exists() {
                    files.push(p);
                }
            }
        }
    }
    let mut all_recs: Vec<TurnMetricRec> = Vec::new();
    for file in files {
        if !file.exists() {
            continue;
        }
        let raw = match fs::read_to_string(&file) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if raw.trim().is_empty() {
            continue;
        }
        let recs: Vec<TurnMetricRec> = match serde_json::from_str(&raw) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for r in recs {
            all_recs.push(r);
        }
    }
    let mut tool_sum: u64 = 0;
    let mut delege_sum: u64 = 0;
    let mut round_sum: u64 = 0;
    let mut batch_tool_sum: u64 = 0;
    let mut batch_turns: u64 = 0;
    for r in all_recs.iter().filter(|r| r.ts >= cutoff_ms) {
        tool_sum += r.tool_count;
        delege_sum += r.delegate + r.task + r.spawn_worker;
        if r.round_count > 0 {
            round_sum += r.round_count;
            batch_tool_sum += r.tool_count;
            batch_turns += 1;
        }
    }
    let delegation_rate = if tool_sum > 0 {
        (delege_sum as f64 / tool_sum as f64) * 100.0
    } else {
        0.0
    };
    let batch_efficiency = if round_sum > 0 {
        batch_tool_sum as f64 / round_sum as f64
    } else {
        0.0
    };
    all_recs.sort_by_key(|r| r.ts);
    let recent: Vec<TurnMetricRec> = all_recs.iter().rev().take(10).cloned().collect::<Vec<_>>().into_iter().rev().collect();
    Ok(TurnMetricsSummary {
        delegation_rate,
        delegation_total: tool_sum,
        delegation_count: delege_sum,
        batch_efficiency,
        batch_turns,
        recent,
        window_hours: win_h,
    })
}

fn notes_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir.join("notes.json"))
}

#[tauri::command]
fn read_notes(app: AppHandle) -> Result<String, String> {
    let file = notes_file(&app)?;
    if !file.exists() {
        return Ok("[]".to_string());
    }
    let raw = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok("[]".to_string());
    }
    Ok(raw)
}

#[tauri::command]
fn write_notes(app: AppHandle, json: String) -> Result<(), String> {
    let file = notes_file(&app)?;
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

// --- Arac katalogu (ekosistem ortak GitHub repo/arac listesi) ---
// notes.json ile ayni desen: ham JSON string oku/yaz; tum CRUD UI store'da.
// Orkestrator (Node) ayni dosyaya RepoCatalogStore ile yazar.
fn tool_catalog_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir.join("tool-catalog.json"))
}

#[tauri::command]
fn read_tool_catalog(app: AppHandle) -> Result<String, String> {
    let file = tool_catalog_file(&app)?;
    if !file.exists() {
        return Ok("[]".to_string());
    }
    let raw = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok("[]".to_string());
    }
    Ok(raw)
}

#[tauri::command]
fn write_tool_catalog(app: AppHandle, json: String) -> Result<(), String> {
    let file = tool_catalog_file(&app)?;
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

// --- Stage 7: Nightly reports ---
fn reports_dir_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let p = dir.join("global").join("reports");
    if !p.exists() {
        fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    }
    Ok(p)
}

#[derive(Serialize)]
struct ReportEntry {
    date: String,
    path: String,
    size: u64,
}

#[tauri::command]
fn list_reports(app: AppHandle) -> Result<Vec<ReportEntry>, String> {
    let dir = reports_dir_path(&app)?;
    let mut out: Vec<ReportEntry> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let date = p
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            out.push(ReportEntry {
                date,
                path: p.to_string_lossy().to_string(),
                size,
            });
        }
    }
    out.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(out)
}

#[tauri::command]
fn read_report(_app: AppHandle, path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_reports_dir(app: AppHandle) -> Result<String, String> {
    let dir = reports_dir_path(&app)?;
    // Sadece string don — UI tarafi opener plugin ile acsin
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn startup_project_path() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|arg| PathBuf::from(arg).is_dir())
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OrchestratorState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Ikinci ui.exe baslatma denemesi — mevcut pencereyi one cikar.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            // Fix 132: "main" penceresini tauri.conf.json otomatik olusturmasi
            // yerine burada from_config ile kuruyoruz — boylece .on_navigation
            // guard ekleyebiliyoruz (config-otomatik pencerede builder erisimi
            // yok). Pencere ozellikleri (maximized/min boyut/center) config'ten
            // aynen gelir; tauri.conf.json windows:[] birakildi.
            if app.get_webview_window("main").is_none() {
                if let Some(win_cfg) = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|w| w.label == "main")
                    .cloned()
                {
                    let nav_app = app.handle().clone();
                    let _ = WebviewWindowBuilder::from_config(app, &win_cfg)
                        .and_then(|b| b.on_navigation(move |url| nav_guard(&nav_app, url)).build());
                }
            }

            let _ = app.autolaunch().enable();

            // Windows Toast bildirimlerinin "Windows PowerShell" yerine
            // "Agent Symphony" gozukmesi icin AUMID set + Start Menu
            // shortcut kayit (idempotent — sadece eksikse olusturur).
            #[cfg(windows)]
            {
                set_app_user_model_id();
                register_aumid_in_registry();
                install_start_menu_shortcut();
            }

            // BLOCKING fix: cleanup + orchestrator spawn'lari arka plan thread'inde.
            // Setup main thread'i bos kalir, UI hemen acilir. Orchestrator'lar
            // ayaklanana kadar UI "Connecting..." gosterir; thread bittiginde
            // her sey hazir.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                #[cfg(windows)]
                cleanup_orphan_orchestrators();
                #[cfg(windows)]
                cleanup_orphan_tunnels();
                ensure_global_orchestrator(&handle);
                ensure_advisors(&handle);
                ensure_tunnel(&handle);
                ensure_windows_mcp(&handle);
                start_watchdog(handle.clone());
            });

            if std::env::args().any(|a| a == "--minimized") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }

            let open_i = MenuItem::with_id(app, "open", "Aç", true, None::<&str>)?;
            let projects_i =
                MenuItem::with_id(app, "projects", "Projeler", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &projects_i, &quit_i])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Architect")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" | "projects" => show_main(app),
                    "quit" => {
                        kill_all_orchestrators(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            add_project,
            touch_project,
            remove_project,
            rename_project,
            refresh_project_logo,
            refresh_all_logos,
            open_project_window,
            start_project,
            startup_project_path,
            aggregate_usage,
            turn_metrics_summary,
            read_notes,
            write_notes,
            read_tool_catalog,
            write_tool_catalog,
            list_reports,
            read_report,
            open_reports_dir,
            list_servers,
            add_server,
            update_server,
            delete_server,
            test_server_connection,
            set_project_deployment,
            set_project_report_enabled,
            notify_user
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
