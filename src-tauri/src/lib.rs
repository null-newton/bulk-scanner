mod escl;
mod mdns;
mod process;

use base64::Engine;
use escl::{Caps, ScanOpts, Scanner};
use std::collections::HashMap;
use tauri::{ipc::{Channel, InvokeBody, Request}, State};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct App { scanners: Mutex<HashMap<String, Scanner>>, jobs: std::sync::Mutex<HashMap<String, CancellationToken>>, http: std::sync::OnceLock<reqwest::Client> }
impl App { fn http(&self) -> &reqwest::Client { self.http.get_or_init(escl::client) } }

async fn scanner(st: &App, id: &str) -> Result<Scanner, String> { st.scanners.lock().await.get(id).cloned().ok_or_else(|| "Unknown scanner — search the network again".into()) }
async fn remember(st: &App, s: &Scanner) { st.scanners.lock().await.insert(s.id.clone(), s.clone()); }

// Searches the LAN (or probes one host) and returns every scanner known so far
#[tauri::command]
async fn list_scanners(st: State<'_, App>, host: Option<String>) -> Result<Vec<Scanner>, String> {
  if let Some(h) = host.map(|h| h.trim().to_string()).filter(|h| !h.is_empty()) { let s = escl::probe(st.http(), &h).await?; remember(&st, &s).await; return Ok(vec![s]) }
  let found = mdns::discover(2500).await;
  let mut map = st.scanners.lock().await;
  for f in found { let caps = map.get(&f.id).and_then(|p| p.caps.clone()); map.insert(f.id.clone(), Scanner { id: f.id, name: f.name, model: f.model, host: f.host, port: f.port, manual: false, tls: f.tls, rs: f.rs, caps }); }
  let mut v: Vec<Scanner> = map.values().cloned().collect(); v.sort_by(|a, b| a.name.cmp(&b.name)); Ok(v)
}

#[tauri::command]
async fn capabilities(st: State<'_, App>, id: String) -> Result<Caps, String> {
  let mut s = scanner(&st, &id).await?; let c = escl::capabilities(st.http(), &mut s).await?; remember(&st, &s).await; Ok(c)
}

// Runs a scan job, streaming each page (base64 JPEG) to the UI; `job` lets cancel_scan stop it
#[tauri::command]
async fn scan(st: State<'_, App>, id: String, opts: ScanOpts, fix: process::Opts, job: String, on_page: Channel<serde_json::Value>) -> Result<(), String> {
  let (mut s, token) = (scanner(&st, &id).await?, CancellationToken::new());
  st.jobs.lock().unwrap().insert(job.clone(), token.clone());
  // Pages are cleaned up on a worker thread in arrival order while the scanner keeps feeding; crop only makes sense on the flatbed
  let fix = process::Opts { crop: fix.crop && opts.source == "flatbed", ..fix };
  let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<escl::Page>();
  let worker = tauri::async_runtime::spawn(async move {
    let mut n = 0;
    while let Some(p) = rx.recv().await {
      n += 1;
      let (jpeg, r) = tauri::async_runtime::spawn_blocking(move || process::process(&p.jpeg, fix).unwrap_or((p.jpeg, Default::default()))).await.map_err(|e| e.to_string())?;
      let _ = on_page.send(serde_json::json!({ "type": "page", "n": n, "dpi": p.dpi, "turned": r.turn, "skew": r.skew, "cropped": r.cropped, "data": base64::engine::general_purpose::STANDARD.encode(&jpeg) }));
    }
    Ok::<(), String>(())
  });
  let r = escl::scan(st.http(), &mut s, &opts, &token, |p| { let _ = tx.send(p); }).await;
  drop(tx);
  let w = worker.await.map_err(|e| e.to_string()).and_then(|x| x);
  st.jobs.lock().unwrap().remove(&job); remember(&st, &s).await; r.and(w)
}

#[tauri::command]
fn cancel_scan(st: State<'_, App>, job: String) { if let Some(t) = st.jobs.lock().unwrap().get(&job) { t.cancel() } }

// Writes raw bytes to the path the user picked in the save dialog (path passed percent-encoded in a header)
#[tauri::command]
fn save_file(req: Request<'_>) -> Result<(), String> {
  let path = req.headers().get("path").and_then(|v| v.to_str().ok()).ok_or("Missing path")?;
  let path = percent_encoding::percent_decode_str(path).decode_utf8().map_err(|e| e.to_string())?;
  let InvokeBody::Raw(data) = req.body() else { return Err("Expected file bytes".into()) };
  std::fs::write(path.as_ref(), data).map_err(|e| format!("Could not save file: {e}"))
}

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .manage(App::default())
    .invoke_handler(tauri::generate_handler![list_scanners, capabilities, scan, cancel_scan, save_file])
    .run(tauri::generate_context!())
    .expect("error while running Bulk Scanner");
}

#[cfg(test)]
mod tests {
  // Live check against the LAN: cargo test -- --ignored --nocapture
  #[tokio::test(flavor = "current_thread")]
  #[ignore]
  async fn discover_and_caps() {
    let found = crate::mdns::discover(2500).await; println!("found {found:?}");
    let http = crate::escl::client();
    for f in found { let mut s = crate::escl::Scanner { id: f.id, name: f.name, model: f.model, host: f.host, port: f.port, manual: false, tls: f.tls, rs: f.rs, caps: None }; let c = crate::escl::capabilities(&http, &mut s).await; println!("{} ({}) -> {c:?}", s.name, s.model); }
  }
  // Runs one real 100 dpi flatbed scan on the first scanner found and checks a JPEG comes back
  #[tokio::test(flavor = "current_thread")]
  #[ignore]
  async fn flatbed_scan() {
    let f = crate::mdns::discover(2500).await.into_iter().next().expect("no scanner");
    let mut s = crate::escl::Scanner { id: f.id, name: f.name, model: f.model, host: f.host, port: f.port, manual: false, tls: f.tls, rs: f.rs, caps: None };
    let (http, token, mut pages) = (crate::escl::client(), tokio_util::sync::CancellationToken::new(), vec![]);
    crate::escl::scan(&http, &mut s, &crate::escl::ScanOpts { source: "flatbed".into(), mode: "gray".into(), dpi: 300 }, &token, |p| pages.push(p)).await.unwrap();
    println!("pages: {:?}", pages.iter().map(|p| (p.dpi, p.jpeg.len(), p.jpeg[..2].to_vec())).collect::<Vec<_>>());
    assert!(!pages.is_empty() && pages[0].jpeg.starts_with(&[0xff, 0xd8]));
    let t = std::time::Instant::now();
    let (out, r) = crate::process::process(&pages[0].jpeg, crate::process::Opts { auto_rotate: true, straighten: true, crop: true }).unwrap();
    println!("processed in {:?}: {r:?}, {} -> {} bytes", t.elapsed(), pages[0].jpeg.len(), out.len());
  }
}
