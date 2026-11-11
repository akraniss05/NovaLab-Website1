use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, atomic::{AtomicBool, Ordering}, Mutex},
    time::Instant,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

#[derive(Default)]
struct DownloadRegistry(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Serialize, Clone)]
#[serde(rename_all="camelCase")]
struct Progress {
    id: String,
    status: String,
    percent: Option<u8>,
    speed: Option<String>,
    message: Option<String>,
    path: Option<String>,
}
fn emit(app: &AppHandle, progress: Progress) { let _ = app.emit("novalab:download-progress", progress); }

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root.join("linked-games.json"))
}
fn read_links(app: &AppHandle) -> Vec<String> {
    registry_path(app).ok().and_then(|p| fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok()).unwrap_or_default()
}
fn store_link(app: &AppHandle, path: &Path) -> Result<(), String> {
    let mut links = read_links(app);
    let new_path = path.to_string_lossy().into_owned();
    if !links.contains(&new_path) { links.push(new_path); }
    fs::write(registry_path(app)?, serde_json::to_vec_pretty(&links).map_err(|e|e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_game(app: AppHandle) -> Result<serde_json::Value, String> {
    let file = app.dialog().file().set_title("Windows-Spieldatei (.exe) auswählen")
        .add_filter("Windows Programme", &["exe"])
        .blocking_pick_file();
    let Some(file) = file else { return Ok(serde_json::json!({"cancelled":true})); };
    let path = file.into_path().map_err(|e| e.to_string())?;
    if !path.extension().and_then(|x|x.to_str()).is_some_and(|e|e.eq_ignore_ascii_case("exe")) {
        return Err("Bitte eine .exe-Datei auswählen".into());
    }
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.is_file() { return Err("Die Datei existiert nicht".into()); }
    store_link(&app, &canonical)?;
    Ok(serde_json::json!({
        "path":canonical.to_string_lossy(),
        "name":canonical.file_name().unwrap_or_default().to_string_lossy()
    }))
}

#[tauri::command]
fn launch_game(app: AppHandle, path: String) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(path);
    if !path.extension().and_then(|x|x.to_str()).is_some_and(|e|e.eq_ignore_ascii_case("exe")) {
        return Err("Nur zuvor verknüpfte EXE-Spiele dürfen gestartet werden".into());
    }
    let canonical = path.canonicalize().map_err(|_|"Spiel nicht gefunden. Bitte neu verknüpfen.".to_string())?;
    if !read_links(&app).contains(&canonical.to_string_lossy().into_owned()) {
        return Err("Bitte das Spiel zuerst über die Dateiauswahl verknüpfen".into());
    }
    Command::new(&canonical).current_dir(canonical.parent().unwrap_or(Path::new(".")))
        .spawn().map_err(|e|format!("Spiel konnte nicht gestartet werden: {e}"))?;
    Ok(serde_json::json!({"ok":true}))
}

#[tauri::command]
fn open_external(url: String) -> Result<serde_json::Value, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_|"Ungültiger Link".to_owned())?;
    if parsed.scheme() != "https" { return Err("Nur HTTPS-Webseiten erlaubt".into()); }
    // Do not invoke a shell or accept untrusted command-line switches.
    #[cfg(target_os="windows")]
    {
        Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url.as_str()])
            .spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os="linux")]
    {
        Command::new("xdg-open").arg(url).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os="macos")]
    {
        Command::new("open").arg(url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(serde_json::json!({"ok":true}))
}

async fn download_task(app: AppHandle, id: String, url: String, target: PathBuf, cancelled: Arc<AtomicBool>) {
    let result: Result<(), String> = async {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(60))
            .build().map_err(|e|e.to_string())?;
        let mut response = client.get(&url).send().await.map_err(|e|e.to_string())?;
        if !response.status().is_success() { return Err(format!("HTTP {} – Download nicht möglich (Weiterleitungen sind aus Sicherheitsgründen deaktiviert).",response.status())); }
        let total = response.content_length();
        let mut file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(&target).await.map_err(|e|e.to_string())?;
        let mut downloaded = 0_u64;
        let start = Instant::now();
        let mut last = Instant::now();
        while let Some(chunk) = response.chunk().await.map_err(|e|e.to_string())? {
            if cancelled.load(Ordering::Relaxed) { return Err("__cancelled__".into()); }
            file.write_all(&chunk).await.map_err(|e|e.to_string())?;
            downloaded += chunk.len() as u64;
            if last.elapsed().as_millis() > 350 {
                let percent=total.filter(|n| *n>0).map(|n| ((downloaded.saturating_mul(100)/n).min(100)) as u8);
                let speed=(downloaded as f64/1_048_576.0)/start.elapsed().as_secs_f64().max(0.1);
                emit(&app,Progress{id:id.clone(),status:"active".into(),percent,speed:Some(format!("{speed:.1} MB/s")),message:None,path:None});
                last=Instant::now();
            }
        }
        file.flush().await.map_err(|e|e.to_string())?;
        if cancelled.load(Ordering::Relaxed) { return Err("__cancelled__".into()); }
        emit(&app,Progress{id:id.clone(),status:"done".into(),percent:Some(100),speed:None,message:Some("Download gespeichert, nicht automatisch installiert".into()),path:Some(target.to_string_lossy().into_owned())});
        Ok(())
    }.await;
    if let Err(err) = result {
        let _ = tokio::fs::remove_file(&target).await;
        let user_cancelled = cancelled.load(Ordering::Relaxed) || err=="__cancelled__";
        emit(&app, Progress{id:id.clone(),status:if user_cancelled{"cancelled"}else{"error"}.into(),percent:None,speed:None,message:Some(if user_cancelled{"Abgebrochen".into()}else{err}),path:None});
    }
    // Remove the completed/cancelled task from registry.
    app.state::<DownloadRegistry>().0.lock().unwrap().remove(&id);
}

#[tauri::command]
async fn download_game(app:AppHandle, registry:State<'_,DownloadRegistry>, game_id:String, url:String, filename:String) -> Result<serde_json::Value,String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_|"Ungültige Downloadadresse".to_string())?;
    if parsed.scheme()!="https" { return Err("Nur HTTPS-Downloads sind erlaubt".into()); }
    let name=filename.chars().filter(|c|c.is_alphanumeric()||" -_.".contains(*c)).take(65).collect::<String>();
    let ext=Path::new(parsed.path()).extension().and_then(|x|x.to_str()).unwrap_or("zip");
    let ext=if ["zip","exe","msi","7z","rar"].contains(&ext){ext}else{"zip"};
    let suggested=format!("{}-{}.{}",if name.is_empty(){"NovaLab-Spiel"}else{&name}, &game_id.chars().filter(|c|c.is_alphanumeric()||*c=='-').take(30).collect::<String>(),ext);
    let selected=app.dialog().file().set_title("Download-Datei speichern (keine automatische Installation)")
        .set_file_name(&suggested).blocking_save_file();
    let Some(file) = selected else {return Ok(serde_json::json!({"cancelled":true}));};
    let path=file.into_path().map_err(|e|e.to_string())?;
    if path.exists() {return Err("Die Zieldatei existiert bereits. Bitte anderen Dateinamen wählen".into());}
    let id=Uuid::new_v4().to_string();
    let flag=Arc::new(AtomicBool::new(false));
    registry.0.lock().unwrap().insert(id.clone(),flag.clone());
    tauri::async_runtime::spawn(download_task(app,id.clone(),url,path,flag));
    Ok(serde_json::json!({"ok":true,"downloadId":id}))
}
#[tauri::command]
fn cancel_download(registry:State<'_,DownloadRegistry>, id:String) -> Result<serde_json::Value,String> {
    let table=registry.0.lock().unwrap();
    if let Some(flag)=table.get(&id) {flag.store(true,Ordering::Relaxed);return Ok(serde_json::json!({"ok":true}));}
    Ok(serde_json::json!({"ok":false}))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DownloadRegistry::default())
        .invoke_handler(tauri::generate_handler![pick_game,launch_game,open_external,download_game,cancel_download])
        .run(tauri::generate_context!())
        .expect("NovaLab Studios Launcher konnte nicht gestartet werden");
}