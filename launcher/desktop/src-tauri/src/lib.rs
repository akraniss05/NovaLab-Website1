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
        .invoke_handler(tauri::generate_handler![pick_game,launch_game,open_external,download_game,cancel_download,installed_games,install_game_version,launch_installed_game,check_launcher_update,install_launcher_update])
        .run(tauri::generate_context!())
        .expect("NovaLab Studios Launcher konnte nicht gestartet werden");
}

// Release packages are distributed as ZIP archives. We only activate an archive
// after verifying its server-published SHA-256 and extracting it safely.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstalledRelease {
    game_id: String,
    version: String,
    entry: String,
    sha256: String,
    format: String,
}
fn valid_release_part(s: &str, max_len: usize) -> bool {
    !s.is_empty() && s.len() <= max_len && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.')
        && !s.starts_with('.') && !s.contains("..")
}
fn installed_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("installed");
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    Ok(dir)
}
fn installed_manifest(app:&AppHandle, id:&str)->Result<PathBuf,String>{
    if !valid_release_part(id,64)||!id.starts_with("community-"){return Err("Ungültige Spielkennung".into())}
    Ok(installed_dir(app)?.join(id).join("current.json"))
}
fn read_installed(app:&AppHandle,id:&str)->Result<InstalledRelease,String>{
    let text=fs::read_to_string(installed_manifest(app,id)?).map_err(|_|"Dieses Spiel ist noch nicht installiert".to_string())?;
    serde_json::from_str(&text).map_err(|_|"Ungültige installierte Version".to_string())
}
#[tauri::command]
fn installed_games(app:AppHandle)->Result<Vec<InstalledRelease>,String>{
    let mut out=Vec::new();
    for file in fs::read_dir(installed_dir(&app)?).map_err(|e|e.to_string())? {
        let file=file.map_err(|e|e.to_string())?;
        let id=file.file_name().to_string_lossy().into_owned();
        if let Ok(manifest)=read_installed(&app,&id){out.push(manifest)}
    }
    Ok(out)
}
#[tauri::command]
fn launch_installed_game(app:AppHandle, game_id:String)->Result<serde_json::Value,String>{
    let manifest=read_installed(&app,&game_id)?;
    if manifest.format!="windows" || !manifest.entry.to_ascii_lowercase().ends_with(".exe") { return Err("Nur installierte Windows-Spiele dürfen als EXE gestartet werden".into()) }
    let base=installed_dir(&app)?.join(&game_id).join(&manifest.version).canonicalize().map_err(|e|e.to_string())?;
    let executable=base.join(&manifest.entry).canonicalize().map_err(|_|"Die Startdatei fehlt".to_string())?;
    if !executable.starts_with(&base)||!executable.is_file(){return Err("Ungültiger Startpfad".into())}
    Command::new(&executable).current_dir(executable.parent().unwrap_or(&base)).spawn().map_err(|e|e.to_string())?;
    Ok(serde_json::json!({"ok":true}))
}
fn extract_verified_zip(bytes_path:&Path, dest:&Path, entry:&str)->Result<(),String>{
    use std::io::Read;
    let file=fs::File::open(bytes_path).map_err(|e|e.to_string())?;
    let mut archive=zip::ZipArchive::new(file).map_err(|_|"Ungültiges ZIP-Archiv".to_string())?;
    if archive.len()>3000 {return Err("Zu viele Dateien im Spielarchiv".into())}
    let mut uncompressed=0_u64;
    for i in 0..archive.len() {
        let mut item=archive.by_index(i).map_err(|e|e.to_string())?;
        let name=item.enclosed_name().ok_or("Unsicherer Dateipfad im ZIP")?.to_owned();
        // Never extract symlinks or hardlinks from untrusted archives.
        if item.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {return Err("ZIP-Links sind nicht erlaubt".into())}
        uncompressed=uncompressed.saturating_add(item.size());
        if uncompressed>1_000_000_000 {return Err("Entpacktes Spiel überschreitet 1 GB".into())}
        let out=dest.join(name);
        if item.is_dir(){fs::create_dir_all(&out).map_err(|e|e.to_string())?;continue;}
        if let Some(parent)=out.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?}
        let mut writer=fs::File::create(&out).map_err(|e|e.to_string())?;
        std::io::copy(&mut item.take(1_000_000_001),&mut writer).map_err(|e|e.to_string())?;
    }
    if !dest.join(entry).is_file(){return Err("Die angegebene Startdatei fehlt im ZIP".into())}
    Ok(())
}
#[tauri::command]
async fn install_game_version(app:AppHandle, game_id:String, version:String, url:String, sha256:String, entry:String, game_format:String)->Result<serde_json::Value,String>{
    use sha2::{Sha256,Digest};
    if !valid_release_part(&game_id,64)||!game_id.starts_with("community-")||!valid_release_part(&version,30)||version.split('.').count()!=3{return Err("Ungültige Spiel-ID/Version".into())}
    if !matches!(game_format.as_str(),"windows"|"html"){return Err("Unbekanntes Paketformat".into())}
    let entry_path=PathBuf::from(&entry);
    if entry.len()>140||entry.is_empty()||entry_path.is_absolute()||entry_path.components().any(|part|matches!(part,std::path::Component::ParentDir|std::path::Component::Prefix(_))){return Err("Ungültige Startdatei".into())}
    if game_format=="windows"&&!entry.to_ascii_lowercase().ends_with(".exe"){return Err("Windows-Paket benötigt eine EXE".into())}
    if game_format=="html"&&!entry.to_ascii_lowercase().ends_with(".html"){return Err("HTML-Paket benötigt eine HTML-Datei".into())}
    if sha256.len()!=64||!sha256.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Ungültige Paket-Prüfsumme".into())}
    let u=reqwest::Url::parse(&url).map_err(|_|"Ungültige Download-URL")?;
    if u.scheme()!="https"{return Err("Nur HTTPS-Downloads erlaubt".into())}
    let root=installed_dir(&app)?;
    let game_root=root.join(&game_id);
    fs::create_dir_all(&game_root).map_err(|e|e.to_string())?;
    let scratch=game_root.join(format!(".temp-{}.zip",Uuid::new_v4()));
    let stage=game_root.join(format!(".stage-{}",Uuid::new_v4()));
    let result:Result<serde_json::Value,String>=async{
      let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(180)).redirect(reqwest::redirect::Policy::limited(3)).build().map_err(|e|e.to_string())?;
      let mut response=client.get(u).send().await.map_err(|e|e.to_string())?;
      if !response.status().is_success(){return Err(format!("Download: HTTP {}",response.status()))}
      if response.content_length().unwrap_or(0)>250_000_000{return Err("Spielpaket ist zu groß".into())}
      let mut hash=Sha256::new();let mut bytes=0_usize;
      let mut file=tokio::fs::File::create(&scratch).await.map_err(|e|e.to_string())?;
      while let Some(chunk)=response.chunk().await.map_err(|e|e.to_string())?{
        bytes+=chunk.len();if bytes>250_000_000{return Err("Spielpaket ist zu groß".into())}
        hash.update(&chunk);file.write_all(&chunk).await.map_err(|e|e.to_string())?;
      }
      file.flush().await.map_err(|e|e.to_string())?;drop(file);
      let digest=hash.finalize().iter().map(|b|format!("{b:02x}")).collect::<String>();
      if digest!=sha256.to_ascii_lowercase(){return Err("SHA-256 stimmt nicht überein: Download verworfen".into())}
      fs::create_dir_all(&stage).map_err(|e|e.to_string())?;
      let stage_dir=stage.clone();let scratch_file=scratch.clone();let requested_entry=entry.clone();
      tauri::async_runtime::spawn_blocking(move||extract_verified_zip(&scratch_file,&stage_dir,&requested_entry)).await.map_err(|e|e.to_string())??;
      let live=game_root.join(&version);
      if live.exists(){
         return Err("Diese Spielversion ist bereits vorhanden. Eine identische Version wird aus Sicherheitsgründen nicht überschrieben; lade eine neue Versionsnummer hoch.".into());
      }
      fs::rename(&stage,&live).map_err(|e|e.to_string())?;
      let manifest=InstalledRelease{game_id:game_id.clone(),version:version.clone(),entry:entry.clone(),sha256:sha256.to_ascii_lowercase(),format:game_format.clone()};
      let staging_manifest=game_root.join("current.tmp.json");
      fs::write(&staging_manifest,serde_json::to_vec_pretty(&manifest).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
      let current=game_root.join("current.json");
      let backup=game_root.join("current.backup.json");
      if current.exists(){
          let _=fs::remove_file(&backup);
          fs::rename(&current,&backup).map_err(|e|format!("Alte Spielversion konnte nicht gesichert werden: {e}"))?;
      }
      if let Err(err)=fs::rename(&staging_manifest,&current) {
          if backup.exists(){let _=fs::rename(&backup,&current);}
          return Err(format!("Neue Spielversion konnte nicht aktiviert werden: {err}"));
      }
      let _=fs::remove_file(&backup);
      Ok(serde_json::json!({"ok":true,"version":version,"gameId":game_id}))
    }.await;
    let _=tokio::fs::remove_file(&scratch).await;
    let _=tokio::fs::remove_dir_all(&stage).await;
    result
}

// The launcher can check its own GitHub Releases and install an update without
// making the user browse to the project website. Only official repository
// release assets are considered; every downloaded installer must match the
// digest supplied by GitHub's authenticated API response.
async fn available_launcher_update() -> Result<Option<serde_json::Value>,String> {
    let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().map_err(|e|e.to_string())?;
    let data:serde_json::Value=client.get("https://api.github.com/repos/akraniss05/NovaLab-Website1/releases?per_page=20")
        .header("User-Agent","NovaLab-Studios-Launcher").send().await.map_err(|e|e.to_string())?
        .error_for_status().map_err(|e|e.to_string())?.json().await.map_err(|e|e.to_string())?;
    let releases=data.as_array().ok_or("Keine gültige Release-Liste")?;
    let current=env!("CARGO_PKG_VERSION");
    fn parse(v:&str)->Option<(u64,u64,u64)>{
       let a=v.split('.').collect::<Vec<_>>();if a.len()!=3{return None}
       Some((a[0].parse().ok()?,a[1].parse().ok()?,a[2].parse().ok()?))
    }
    let Some(current_num)=parse(current) else {return Err("Ungültige Launcher-Version".into())};
    let mut candidate:Option<( (u64,u64,u64),serde_json::Value)>=None;
    for release in releases{
       let tag=release.get("tag_name").and_then(|v|v.as_str()).unwrap_or("");
       let Some(version)=tag.strip_prefix("novalab-launcher-v").and_then(|v|v.strip_suffix("-alpha")) else{continue};
       let Some(num)=parse(version) else {continue};
       if num<=current_num || candidate.as_ref().is_some_and(|(best,_)|num<=*best){continue}
       let Some(asset)=release.get("assets").and_then(|x|x.as_array()).and_then(|a|a.iter().find(|x|x.get("name").and_then(|v|v.as_str()).is_some_and(|s|s.starts_with("NovaLab.")&&s.ends_with("_x64-setup.exe"))))else{continue};
       let url=asset.get("browser_download_url").and_then(|v|v.as_str()).unwrap_or("");
       if !url.starts_with(&format!("https://github.com/akraniss05/NovaLab-Website1/releases/download/{tag}/")){continue}
       let digest=asset.get("digest").and_then(|v|v.as_str()).unwrap_or("");
       candidate=Some((num,serde_json::json!({"available":true,"version":version,"url":url,"digest":digest,"notes":release.get("name"),"currentVersion":current})));
    }
    Ok(candidate.map(|(_,v)|v))
}
#[tauri::command]
async fn check_launcher_update() -> Result<serde_json::Value,String> {
    Ok(available_launcher_update().await?.unwrap_or(serde_json::json!({"available":false,"currentVersion":env!("CARGO_PKG_VERSION")})))
}
#[tauri::command]
async fn install_launcher_update() -> Result<serde_json::Value,String> {
    use sha2::{Sha256,Digest};
    let info=available_launcher_update().await?.ok_or("Keine neuere Launcher-Version gefunden")?;
    let url=info.get("url").and_then(|v|v.as_str()).ok_or("Release-Link fehlt")?;
    let digest=info.get("digest").and_then(|v|v.as_str()).unwrap_or("");
    let checksum=digest.strip_prefix("sha256:").ok_or("Release enthält noch keine überprüfbare SHA-256-Prüfsumme. Update wird aus Sicherheitsgründen nicht ausgeführt.")?;
    if checksum.len()!=64||!checksum.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Ungültige Prüfsumme".into())}
    let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(180)).redirect(reqwest::redirect::Policy::limited(4)).build().map_err(|e|e.to_string())?;
    let mut response=client.get(url).send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
    if response.content_length().unwrap_or(0)>180_000_000{return Err("Installer zu groß".into())}
    let target=std::env::temp_dir().join(format!("novalab-launcher-update-{}.exe",Uuid::new_v4()));
    let result:Result<(),String>=async{
        let mut file=tokio::fs::File::create(&target).await.map_err(|e|e.to_string())?;
        let mut count=0_usize;let mut hash=Sha256::new();
        while let Some(chunk)=response.chunk().await.map_err(|e|e.to_string())? {
            count+=chunk.len();if count>180_000_000{return Err("Installer zu groß".into())}
            hash.update(&chunk);file.write_all(&chunk).await.map_err(|e|e.to_string())?;
        }
        file.flush().await.map_err(|e|e.to_string())?;drop(file);
        let actual=hash.finalize().iter().map(|b|format!("{b:02x}")).collect::<String>();
        if actual!=checksum.to_ascii_lowercase(){return Err("Update-Prüfsumme stimmt nicht; Ausführung blockiert".into())}
        Command::new(&target).spawn().map_err(|e|format!("Installer konnte nicht gestartet werden: {e}"))?;
        Ok(())
    }.await;
    if result.is_err(){let _=tokio::fs::remove_file(&target).await;}
    result?;
    Ok(serde_json::json!({"ok":true,"version":info["version"],"message":"Installationsprogramm wurde gestartet. Windows kann weiterhin eine Sicherheitswarnung anzeigen."}))
}
