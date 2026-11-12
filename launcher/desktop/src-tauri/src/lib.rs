use std::{
    collections::{HashMap, HashSet},
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
#[derive(Default)]
struct InstallRegistry(Mutex<HashSet<String>>);
struct InstallGuard { app: AppHandle, id: String }
impl Drop for InstallGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = self.app.state::<InstallRegistry>().0.lock() {
            active.remove(&self.id);
        }
    }
}
fn reserve_install(app:&AppHandle,id:&str)->Result<InstallGuard,String>{
    let state=app.state::<InstallRegistry>();
    let mut active=state.0.lock().map_err(|_|"Installationsverwaltung nicht verfügbar")?;
    if !active.insert(id.to_owned()) {
        return Err("Dieses Spiel wird bereits installiert. Bitte den laufenden Vorgang beenden.".into());
    }
    Ok(InstallGuard{app:app.clone(),id:id.into()})
}


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
fn redirect_is_safe(url:&reqwest::Url,redirects:usize,limit:usize)->bool {
    redirects<limit && url.scheme()=="https"
}
fn emit(app: &AppHandle, progress: Progress) { let _ = app.emit("novalab:download-progress", progress); }
fn emit_install(app:&AppHandle, id:&str, status:&str, percent:Option<u8>, message:&str){
  let _=app.emit("novalab:install-progress",Progress{id:id.into(),status:status.into(),percent,speed:None,message:Some(message.into()),path:None});
}

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
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if !redirect_is_safe(attempt.url(),attempt.previous().len(),5) {
                    attempt.error("Unsichere oder zu viele Weiterleitungen")
                } else { attempt.follow() }
            }))
            .timeout(std::time::Duration::from_secs(180))
            .build().map_err(|e|e.to_string())?;
        let mut response = client.get(&url).send().await.map_err(|e|e.to_string())?;
        if !response.status().is_success() { return Err(format!("HTTP {} – Download nicht möglich (Weiterleitungen sind aus Sicherheitsgründen deaktiviert).",response.status())); }
        const MAX_GENERIC_DOWNLOAD:u64=2_000_000_000;
        let total = response.content_length();
        if total.is_some_and(|n|n>MAX_GENERIC_DOWNLOAD){return Err("Download überschreitet das 2-GB-Limit.".into())}
        let mut file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(&target).await.map_err(|e|e.to_string())?;
        let mut downloaded = 0_u64;
        let start = Instant::now();
        let mut last = Instant::now();
        while let Some(chunk) = response.chunk().await.map_err(|e|e.to_string())? {
            if cancelled.load(Ordering::Relaxed) { return Err("__cancelled__".into()); }
            file.write_all(&chunk).await.map_err(|e|e.to_string())?;
            downloaded=downloaded.saturating_add(chunk.len() as u64);
            if downloaded>MAX_GENERIC_DOWNLOAD{return Err("Download überschreitet das 2-GB-Limit.".into())}
            if last.elapsed().as_millis() > 350 {
                let percent=total.filter(|n| *n>0).map(|n| ((downloaded.saturating_mul(100)/n).min(100)) as u8);
                let speed=(downloaded as f64/1_048_576.0)/start.elapsed().as_secs_f64().max(0.1);
                emit(&app,Progress{id:id.clone(),status:"active".into(),percent,speed:Some(format!("{speed:.1} MB/s")),message:None,path:None});
                last=Instant::now();
            }
        }
        file.flush().await.map_err(|e|e.to_string())?;
        if total.is_some_and(|n|n!=downloaded){return Err("Der Download ist unvollständig.".into())}
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
        .manage(InstallRegistry::default())
        .invoke_handler(tauri::generate_handler![pick_game,launch_game,open_external,download_game,cancel_download,installed_games,install_game_version,launch_installed_game,uninstall_installed_game,check_launcher_update,install_launcher_update])
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
fn valid_semver(s:&str)->bool {
    let parts=s.split('.').collect::<Vec<_>>();
    parts.len()==3 && parts.iter().all(|part|
        !part.is_empty() && part.len()<=12 && part.bytes().all(|ch|ch.is_ascii_digit()))
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
    let current=installed_manifest(app,id)?;
    let backup=current.with_file_name("current.backup.json");
    // Recover a previously saved manifest after an interrupted update.
    if !current.exists() && backup.is_file(){let _=fs::rename(&backup,&current);}
    let text=fs::read_to_string(current).map_err(|_|"Dieses Spiel ist noch nicht installiert".to_string())?;
    let manifest:InstalledRelease=serde_json::from_str(&text).map_err(|_|"Ungültige installierte Version".to_string())?;
    if manifest.game_id!=id || !valid_semver(&manifest.version)
        || !matches!(manifest.format.as_str(),"html"|"windows")
        || manifest.entry.is_empty() || manifest.entry.len()>140
        || Path::new(&manifest.entry).is_absolute()
        || Path::new(&manifest.entry).components().any(|c|matches!(c,std::path::Component::ParentDir|std::path::Component::Prefix(_))){
        return Err("Ungültige oder beschädigte Installationsdaten".into());
    }
    Ok(manifest)
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
    let extension=if manifest.format=="windows" {".exe"}else{".html"};
    if !manifest.entry.to_ascii_lowercase().ends_with(extension) && !(manifest.format=="html"&&manifest.entry.to_ascii_lowercase().ends_with(".htm")) {
        return Err("Die Startdatei entspricht nicht dem Paketformat".into());
    }
    let base=installed_dir(&app)?.join(&game_id).join(&manifest.version).canonicalize().map_err(|e|e.to_string())?;
    let executable=base.join(&manifest.entry).canonicalize().map_err(|_|"Die Startdatei fehlt".to_string())?;
    if !executable.starts_with(&base)||!executable.is_file(){return Err("Ungültiger Startpfad".into())}
    if manifest.format=="windows" {
        Command::new(&executable).current_dir(executable.parent().unwrap_or(&base)).spawn().map_err(|e|e.to_string())?;
    } else {
        let url=reqwest::Url::from_file_path(&executable).map_err(|_|"Ungültiger HTML-Spielpfad")?;
        #[cfg(target_os="windows")]
        Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler",url.as_str()]).spawn().map_err(|e|e.to_string())?;
        #[cfg(target_os="macos")]
        Command::new("open").arg(&executable).spawn().map_err(|e|e.to_string())?;
        #[cfg(target_os="linux")]
        Command::new("xdg-open").arg(&executable).spawn().map_err(|e|e.to_string())?;
    }
    Ok(serde_json::json!({"ok":true}))
}
#[tauri::command]
fn uninstall_installed_game(app:AppHandle, game_id:String)->Result<serde_json::Value,String>{
    let manifest=read_installed(&app,&game_id)?;
    if manifest.game_id!=game_id {return Err("Ungültiges Installationsmanifest".into())}
    let root=installed_dir(&app)?.canonicalize().map_err(|e|e.to_string())?;
    let path=root.join(&game_id);
    let canonical=path.canonicalize().map_err(|e|e.to_string())?;
    if !canonical.starts_with(&root)||canonical==root {return Err("Ungültiger Installationspfad".into())}
    fs::remove_dir_all(&canonical).map_err(|e|format!("Spiel konnte nicht entfernt werden: {e}"))?;
    Ok(serde_json::json!({"ok":true,"gameId":game_id}))
}
fn extract_verified_zip(bytes_path:&Path, dest:&Path, entry:&str)->Result<(),String>{
    use std::io::Read;
    let file=fs::File::open(bytes_path).map_err(|e|e.to_string())?;
    let mut archive=zip::ZipArchive::new(file).map_err(|_|"Ungültiges ZIP-Archiv".to_string())?;
    if archive.len()>3000 {return Err("Zu viele Dateien im Spielarchiv".into())}
    let mut uncompressed=0_u64;
    for i in 0..archive.len() {
        let item=archive.by_index(i).map_err(|e|e.to_string())?;
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
    if !valid_release_part(&game_id,64)||!game_id.starts_with("community-")||!valid_release_part(&version,30)||!valid_semver(&version){return Err("Ungültige Spiel-ID/Version".into())}
    if !matches!(game_format.as_str(),"windows"|"html"){return Err("Unbekanntes Paketformat".into())}
    let entry_path=PathBuf::from(&entry);
    if entry.len()>140||entry.is_empty()||entry_path.is_absolute()||entry_path.components().any(|part|matches!(part,std::path::Component::ParentDir|std::path::Component::Prefix(_))){return Err("Ungültige Startdatei".into())}
    if game_format=="windows"&&!entry.to_ascii_lowercase().ends_with(".exe"){return Err("Windows-Paket benötigt eine EXE".into())}
    if game_format=="html"&&!entry.to_ascii_lowercase().ends_with(".html"){return Err("HTML-Paket benötigt eine HTML-Datei".into())}
    if sha256.len()!=64||!sha256.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Ungültige Paket-Prüfsumme".into())}
    let u=reqwest::Url::parse(&url).map_err(|_|"Ungültige Download-URL")?;
    if u.scheme()!="https"{return Err("Nur HTTPS-Downloads erlaubt".into())}
    let _install_guard=reserve_install(&app,&game_id)?;
    let root=installed_dir(&app)?;
    let game_root=root.join(&game_id);
    fs::create_dir_all(&game_root).map_err(|e|e.to_string())?;
    let scratch=game_root.join(format!(".temp-{}.zip",Uuid::new_v4()));
    let stage=game_root.join(format!(".stage-{}",Uuid::new_v4()));
    emit_install(&app,&game_id,"active",Some(0),"Starte sicheren Download");
    let result:Result<serde_json::Value,String>=async{
      let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(180))
          .redirect(reqwest::redirect::Policy::custom(|attempt|{
              if !redirect_is_safe(attempt.url(),attempt.previous().len(),3){attempt.error("Unsichere Spiel-Download-Weiterleitung")}else{attempt.follow()}
          })).build().map_err(|e|e.to_string())?;
      let mut response=client.get(u).send().await.map_err(|e|e.to_string())?;
      if !response.status().is_success(){return Err(format!("Download: HTTP {}",response.status()))}
      if response.content_length().unwrap_or(0)>250_000_000{return Err("Spielpaket ist zu groß".into())}
      let mut hash=Sha256::new();let mut bytes=0_usize;let mut next_progress=0_u8;
      let expected=response.content_length().filter(|n|*n>0);
      let mut file=tokio::fs::File::create(&scratch).await.map_err(|e|e.to_string())?;
      while let Some(chunk)=response.chunk().await.map_err(|e|e.to_string())?{
        bytes+=chunk.len();if bytes>250_000_000{return Err("Spielpaket ist zu groß".into())}
        hash.update(&chunk);file.write_all(&chunk).await.map_err(|e|e.to_string())?;
        if let Some(total)=expected {let pct=((bytes as u64).saturating_mul(75)/total).min(75) as u8;
          if pct>=next_progress {emit_install(&app,&game_id,"active",Some(pct),"Spielpaket wird heruntergeladen");next_progress=pct.saturating_add(4);}
        }
      }
      file.flush().await.map_err(|e|e.to_string())?;drop(file);
      let digest=hash.finalize().iter().map(|b|format!("{b:02x}")).collect::<String>();
      if digest!=sha256.to_ascii_lowercase(){return Err("SHA-256 stimmt nicht überein: Download verworfen".into())}
      emit_install(&app,&game_id,"active",Some(80),"SHA-256 erfolgreich geprüft");
      emit_install(&app,&game_id,"active",Some(84),"Spiel wird sicher entpackt");
      fs::create_dir_all(&stage).map_err(|e|e.to_string())?;
      let stage_dir=stage.clone();let scratch_file=scratch.clone();let requested_entry=entry.clone();
      tauri::async_runtime::spawn_blocking(move||extract_verified_zip(&scratch_file,&stage_dir,&requested_entry)).await.map_err(|e|e.to_string())??;
      emit_install(&app,&game_id,"active",Some(94),"Neue Spielversion wird aktiviert");
      let live=game_root.join(&version);
      if live.exists(){
         return Err("Diese Spielversion ist bereits vorhanden. Eine identische Version wird aus Sicherheitsgründen nicht überschrieben; lade eine neue Versionsnummer hoch.".into());
      }
      fs::rename(&stage,&live).map_err(|e|e.to_string())?;
      let manifest=InstalledRelease{game_id:game_id.clone(),version:version.clone(),entry:entry.clone(),sha256:sha256.to_ascii_lowercase(),format:game_format.clone()};
      let staging_manifest=game_root.join("current.tmp.json");
      let current=game_root.join("current.json");
      let backup=game_root.join("current.backup.json");
      let previous=read_installed(&app,&game_id).ok().map(|old|old.version);
      let activation:Result<(),String>=(||{
          fs::write(&staging_manifest,serde_json::to_vec_pretty(&manifest).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
          if current.exists(){
              if backup.exists(){fs::remove_file(&backup).map_err(|e|e.to_string())?;}
              fs::rename(&current,&backup).map_err(|e|format!("Alte Spielversion konnte nicht gesichert werden: {e}"))?;
          }
          if let Err(err)=fs::rename(&staging_manifest,&current){
              if backup.exists(){let _=fs::rename(&backup,&current);}
              return Err(format!("Neue Spielversion konnte nicht aktiviert werden: {err}"));
          }
          Ok(())
      })();
      if let Err(reason)=activation{
          let _=fs::remove_dir_all(&live);
          let _=fs::remove_file(&staging_manifest);
          return Err(reason);
      }
      let _=fs::remove_file(&backup);
      // Keep one previous release as a rollback fallback; evict older ones.
      if let Ok(dirs)=fs::read_dir(&game_root){
          for dir in dirs.flatten(){
              let name=dir.file_name().to_string_lossy().to_string();
              if dir.path().is_dir() && valid_semver(&name) && name!=version && previous.as_deref()!=Some(name.as_str()){
                  let _=fs::remove_dir_all(dir.path());
              }
          }
      }
      emit_install(&app,&game_id,"done",Some(100),"Spiel erfolgreich installiert");
      Ok(serde_json::json!({"ok":true,"version":version,"gameId":game_id}))
    }.await;
    let _=tokio::fs::remove_file(&scratch).await;
    let _=tokio::fs::remove_dir_all(&stage).await;
    if let Err(ref reason)=result {emit_install(&app,&game_id,"error",None,reason)}
    result
}

// NovaLab updater v0.6. Fetch only official releases, validate asset digests,
// and hand over the installer after Tauri has exited, so installed files are
// never replaced while the app is still running.
fn parse_launcher_version(value: &str) -> Option<(u64,u64,u64)> {
    let parts=value.split('.').collect::<Vec<_>>();
    if parts.len()!=3 { return None; }
    Some((parts[0].parse().ok()?,parts[1].parse().ok()?,parts[2].parse().ok()?))
}
static LAUNCHER_UPDATING: AtomicBool=AtomicBool::new(false);
struct UpdateGuard;
impl Drop for UpdateGuard { fn drop(&mut self){LAUNCHER_UPDATING.store(false,Ordering::Release);} }
fn emit_launcher_update(app:&AppHandle,status:&str,percent:Option<u8>,message:&str){
    let _=app.emit("novalab:launcher-update-progress",Progress {
        id:"launcher".into(),status:status.into(),percent,speed:None,
        message:Some(message.into()),path:None
    });
}
async fn available_launcher_update() -> Result<Option<serde_json::Value>,String> {
    let client=reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(18))
        .build().map_err(|e|e.to_string())?;
    let response=client.get("https://api.github.com/repos/akraniss05/NovaLab-Website1/releases?per_page=25")
        .header("User-Agent","NovaLab-Studios-Launcher/0.6")
        .header("Accept","application/vnd.github+json")
        .send().await.map_err(|e|format!("Update-Server nicht erreichbar: {e}"))?
        .error_for_status().map_err(|e|format!("GitHub Releases nicht erreichbar: {e}"))?;
    let releases:serde_json::Value=response.json().await.map_err(|e|e.to_string())?;
    let releases=releases.as_array().ok_or("Ungültige GitHub Release-Liste")?;
    let current=env!("CARGO_PKG_VERSION");
    let current_num=parse_launcher_version(current).ok_or("Ungültige installierte Version")?;
    let mut candidate: Option<((u64,u64,u64),serde_json::Value)>=None;
    for release in releases {
        if release.get("draft").and_then(|x|x.as_bool())==Some(true){continue;}
        let tag=release.get("tag_name").and_then(|v|v.as_str()).unwrap_or("");
        let Some(version)=tag.strip_prefix("novalab-launcher-v").and_then(|v|v.strip_suffix("-alpha")) else {continue};
        let Some(number)=parse_launcher_version(version) else {continue};
        if number<=current_num||candidate.as_ref().is_some_and(|(best,_)|number<=*best){continue}
        let Some(asset)=release.get("assets").and_then(|x|x.as_array()).and_then(|items|items.iter().find(|a|
            a.get("name").and_then(|x|x.as_str()).is_some_and(|name|
                name.starts_with("NovaLab.Studios.Launcher_") && name.ends_with("_x64-setup.exe")
            )
        )) else {continue};
        let url=asset.get("browser_download_url").and_then(|x|x.as_str()).unwrap_or("");
        if !url.starts_with(&format!("https://github.com/akraniss05/NovaLab-Website1/releases/download/{tag}/")){continue;}
        let digest=asset.get("digest").and_then(|x|x.as_str()).unwrap_or("");
        let checksum=digest.strip_prefix("sha256:").unwrap_or("");
        if checksum.len()!=64||!checksum.bytes().all(|b|b.is_ascii_hexdigit()){continue;}
        let size=asset.get("size").and_then(|x|x.as_u64()).unwrap_or(0);
        if !(100_000..=180_000_000).contains(&size){continue;}
        let notes=release.get("body").and_then(|x|x.as_str()).unwrap_or("");
        candidate=Some((number,serde_json::json!({
            "available":true,"version":version,"currentVersion":current,
            "url":url,"digest":digest,"bytes":size,
            "notes":notes.chars().take(1000).collect::<String>(),
            "publishedAt":release.get("published_at")
        })));
    }
    Ok(candidate.map(|(_,value)|value))
}
#[tauri::command]
async fn check_launcher_update() -> Result<serde_json::Value,String> {
    Ok(available_launcher_update().await?.unwrap_or(serde_json::json!({
        "available":false,"currentVersion":env!("CARGO_PKG_VERSION")
    })))
}
#[cfg(target_os="windows")]
fn spawn_installer_after_exit(path:&Path) -> Result<(),String> {
    use std::os::windows::process::CommandExt;
    // Controlled path, single-quoted and escaped for PowerShell. No parameters
    // are accepted from web content; only our checksum-verified staged installer.
    let safe=path.to_string_lossy().replace('\'',"''");
    let command=format!(
        "$ErrorActionPreference='Stop'; Start-Sleep -Seconds 2; \
         $installer='{safe}'; \
         if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {{ exit 2 }}; \
         Start-Process -FilePath $installer -ArgumentList @('/P','/UPDATE','/R') -Wait"
    );
    Command::new("powershell.exe")
        .arg("-NoProfile").arg("-NonInteractive")
        .arg("-WindowStyle").arg("Hidden")
        .arg("-Command").arg(command)
        .creation_flags(0x08000000)
        .spawn().map_err(|e|format!("Updater konnte nicht gestartet werden: {e}"))?;
    Ok(())
}
#[tauri::command]
async fn install_launcher_update(app:AppHandle) -> Result<serde_json::Value,String> {
    use sha2::{Digest,Sha256};
    if LAUNCHER_UPDATING.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err() {
        return Err("Ein Launcher-Update wird bereits heruntergeladen.".into());
    }
    let _guard=UpdateGuard;
    emit_launcher_update(&app,"checking",Some(0),"Prüfe offizielle NovaLab Releases");
    let info=available_launcher_update().await?.ok_or("Dein Launcher ist bereits aktuell.")?;
    let url=info["url"].as_str().ok_or("Ungültiger Downloadlink")?;
    let digest=info["digest"].as_str().ok_or("Prüfsumme fehlt")?;
    let checksum=digest.strip_prefix("sha256:").ok_or("Keine SHA-256-Prüfsumme")?;
    let expected=info["bytes"].as_u64().ok_or("Dateigröße fehlt")?;
    let version=info["version"].as_str().ok_or("Versionsnummer fehlt")?.to_owned();
    let client=reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::custom(|attempt|{
            if !redirect_is_safe(attempt.url(),attempt.previous().len(),5){attempt.error("Unsichere Launcher-Update-Weiterleitung")}else{attempt.follow()}
        }))
        .build().map_err(|e|e.to_string())?;
    let mut response=client.get(url).send().await.map_err(|e|e.to_string())?
        .error_for_status().map_err(|e|e.to_string())?;
    if response.content_length().is_some_and(|size|size>180_000_000||size!=expected) {
        return Err("Unerwartete Größe des Update-Installers".into());
    }
    let folder=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("updates");
    tokio::fs::create_dir_all(&folder).await.map_err(|e|e.to_string())?;
    let target=folder.join(format!("NovaLab-{}-{}.exe",version,Uuid::new_v4()));
    let download:Result<(),String>=async {
        let mut file=tokio::fs::File::create(&target).await.map_err(|e|e.to_string())?;
        let mut digest=Sha256::new();
        let mut total=0_u64;
        emit_launcher_update(&app,"downloading",Some(0),"Update wird heruntergeladen");
        while let Some(chunk)=response.chunk().await.map_err(|e|e.to_string())?{
            total=total.saturating_add(chunk.len() as u64);
            if total>180_000_000||total>expected{return Err("Download ist größer als erwartet".into());}
            digest.update(&chunk);
            file.write_all(&chunk).await.map_err(|e|e.to_string())?;
            let percent=((total.saturating_mul(100))/expected).min(100) as u8;
            emit_launcher_update(&app,"downloading",Some(percent),"Launcher-Installer wird geladen");
        }
        file.flush().await.map_err(|e|e.to_string())?;
        drop(file);
        if total!=expected{return Err("Download unvollständig. Update wird nicht gestartet.".into())}
        emit_launcher_update(&app,"verifying",Some(100),"Prüfe SHA-256-Integrität");
        let actual=digest.finalize().iter().map(|b|format!("{b:02x}")).collect::<String>();
        if actual!=checksum.to_ascii_lowercase(){return Err("Prüfsumme stimmt nicht: Update gesperrt".into())}
        Ok(())
    }.await;
    if let Err(e)=download {
        let _=tokio::fs::remove_file(&target).await;
        emit_launcher_update(&app,"error",None,&e);
        return Err(e);
    }
    emit_launcher_update(&app,"installing",Some(100),"Launcher wird geschlossen; Windows-Installer startet gleich");
    #[cfg(target_os="windows")]
    {
        if let Err(error)=spawn_installer_after_exit(&target) {
            emit_launcher_update(&app,"error",None,&error);
            return Err(error);
        }
        // NSIS must not replace files of a still-running Tauri executable.
        // Run a separate Windows handoff process and exit before install begins.
        app.exit(0);
    }
    #[cfg(not(target_os="windows"))]
    return Err("Launcher-Updates werden nur unter Windows unterstützt.".into());
    #[allow(unreachable_code)]
    Ok(serde_json::json!({"ok":true,"version":version,"message":"Installer wird nach dem Beenden gestartet."}))
}
#[cfg(test)]
mod updater_tests {
    use super::parse_launcher_version;
    #[test]
    fn only_strict_three_part_versions(){
        assert_eq!(parse_launcher_version("0.5.0"),Some((0,5,0)));
        assert_eq!(parse_launcher_version("0.6.0"),Some((0,6,0)));
        assert!(parse_launcher_version("0.6").is_none());
        assert!(parse_launcher_version("garbage").is_none());
        assert!(parse_launcher_version("0.6.0.1").is_none());
    }
    #[test]
    fn proper_numeric_ordering(){
        assert!(parse_launcher_version("0.10.0")>parse_launcher_version("0.9.9"));
        assert!(parse_launcher_version("1.0.0")>parse_launcher_version("0.99.99"));
    }
}

#[cfg(test)]
mod audit_tests {
    #[test]
    fn refuses_http_redirect_and_excessive_redirects(){
        let https=reqwest::Url::parse("https://github.com/novalab/example").unwrap();
        let http=reqwest::Url::parse("http://github.com/novalab/example").unwrap();
        assert!(super::redirect_is_safe(&https,0,5));
        assert!(super::redirect_is_safe(&https,4,5));
        assert!(!super::redirect_is_safe(&https,5,5));
        assert!(!super::redirect_is_safe(&http,0,5));
    }

    use super::{valid_semver,extract_verified_zip};
    use std::{fs,io::Write,path::PathBuf};
    use uuid::Uuid;
    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let root=std::env::temp_dir().join(format!("novalab-zip-audit-{}",Uuid::new_v4()));
            fs::create_dir_all(&root).expect("create audit temp dir");
            Self(root)
        }
        fn path(&self,name:&str)->PathBuf { self.0.join(name) }
    }
    impl Drop for Scratch { fn drop(&mut self){let _=fs::remove_dir_all(&self.0);} }
    #[test]
    fn rejects_malformed_game_versions() {
        for invalid in ["","1","1.0","1.0.0.0","1.0.x","../1","1..0","1.2.-3"," 1.2.3","1.2.3-beta"] {
            assert!(!valid_semver(invalid),"accepted malformed game version: {}",invalid);
        }
        for valid in ["0.0.1","1.2.3","10.100.1234"] {
            assert!(valid_semver(valid),"rejected valid version: {}",valid);
        }
    }
    #[test]
    fn extracts_normal_game_archive_and_checks_entry(){
        let tmp=Scratch::new();
        let zip_path=tmp.path("normal.zip");
        let file=fs::File::create(&zip_path).unwrap();
        let mut writer=zip::ZipWriter::new(file);
        writer.start_file("index.html",zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(b"<!doctype html><title>NovaLab QA</title>").unwrap();
        writer.finish().unwrap();
        let dest=tmp.path("game");
        fs::create_dir_all(&dest).unwrap();
        extract_verified_zip(&zip_path,&dest,"index.html").unwrap();
        assert_eq!(fs::read(dest.join("index.html")).unwrap(),b"<!doctype html><title>NovaLab QA</title>");
        let missing=tmp.path("missing");
        fs::create_dir_all(&missing).unwrap();
        assert!(extract_verified_zip(&zip_path,&missing,"Game.exe").is_err());
    }
    #[test]
    fn rejects_corrupted_zip_and_path_traversal() {
        let tmp=Scratch::new();
        let broken=tmp.path("broken.zip");
        fs::write(&broken,b"not a zip archive").unwrap();
        let dest=tmp.path("game");
        fs::create_dir_all(&dest).unwrap();
        assert!(extract_verified_zip(&broken,&dest,"index.html").is_err());

        let bad=tmp.path("path-traversal.zip");
        let file=fs::File::create(&bad).unwrap();
        let mut writer=zip::ZipWriter::new(file);
        writer.start_file("../escape.txt",zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(b"must never escape").unwrap();
        writer.finish().unwrap();
        assert!(extract_verified_zip(&bad,&dest,"index.html").is_err());
        assert!(!tmp.path("escape.txt").exists());
    }
}
