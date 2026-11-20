// eSCL (AirScan) over HTTP(S): capabilities, scan jobs and page retrieval
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Serialize)]
pub struct Caps { pub sources: Vec<String>, pub resolutions: Vec<u32>, pub modes: Vec<String>, #[serde(skip)] pub jpeg: bool, #[serde(skip)] pub flatbed: Option<(u32, u32)>, #[serde(skip)] pub feeder: Option<(u32, u32)> }

#[derive(Clone, Debug, Serialize)]
pub struct Scanner { pub id: String, pub name: String, pub model: String, pub host: String, pub port: u16, pub manual: bool, #[serde(skip)] pub tls: bool, #[serde(skip)] pub rs: String, #[serde(skip)] pub caps: Option<Caps> }

#[derive(Deserialize)]
pub struct ScanOpts { pub source: String, pub mode: String, pub dpi: u32 }

pub struct Page { pub dpi: u32, pub jpeg: Vec<u8> }

pub fn client() -> reqwest::Client { reqwest::Client::builder().danger_accept_invalid_certs(true).connect_timeout(Duration::from_secs(5)).build().expect("http client") }

fn base(s: &Scanner) -> String {
  let host = if s.host.contains(':') { format!("[{}]", s.host) } else { s.host.clone() };
  format!("{}://{}:{}/{}", if s.tls { "https" } else { "http" }, host, s.port, if s.rs.is_empty() { String::new() } else { format!("{}/", s.rs) })
}

fn tag(xml: &str, t: &str) -> Vec<String> { Regex::new(&format!(r"<(?:\w+:)?{t}>([^<]*)</(?:\w+:)?{t}>")).unwrap().captures_iter(xml).map(|c| c[1].trim().to_string()).collect() }
fn section<'a>(xml: &'a str, t: &str) -> &'a str { Regex::new(&format!(r"(?s)<(?:\w+:)?{t}>.*?</(?:\w+:)?{t}>")).unwrap().find(xml).map_or("", |m| m.as_str()) }
fn err(e: reqwest::Error) -> String { if e.is_timeout() { "Scanner did not respond".into() } else if e.is_connect() { "Could not connect to the scanner".into() } else { e.to_string() } }

// Reads what the scanner supports: sources, resolutions, colour modes and max area (1/300 inch); fills model if unknown
pub async fn capabilities(http: &reqwest::Client, s: &mut Scanner) -> Result<Caps, String> {
  if let Some(c) = &s.caps { return Ok(c.clone()) }
  let r = http.get(base(s) + "ScannerCapabilities").timeout(Duration::from_secs(8)).send().await.map_err(err)?;
  if !r.status().is_success() { return Err(format!("Capabilities request failed ({})", r.status().as_u16())) }
  let x = r.text().await.map_err(err)?;
  let (platen, adf) = (section(&x, "Platen"), section(&x, "Adf"));
  let src = if platen.is_empty() { adf } else { platen };
  if s.model.is_empty() { s.model = tag(&x, "MakeAndModel").into_iter().next().unwrap_or_default() }
  let area = |sec: &str| (tag(sec, "MaxWidth").first().and_then(|v| v.parse().ok()).unwrap_or(2550), tag(sec, "MaxHeight").first().and_then(|v| v.parse().ok()).unwrap_or(3508));
  let mut sources = Vec::new();
  if !platen.is_empty() { sources.push("flatbed".into()) }
  if !adf.is_empty() { sources.push("feeder".into()); if !section(adf, "AdfDuplexInputCaps").is_empty() || adf.contains("Duplex") { sources.push("duplex".into()) } }
  let mut resolutions: Vec<u32> = tag(src, "XResolution").iter().filter_map(|v| v.parse().ok()).collect(); resolutions.sort(); resolutions.dedup();
  let mut modes = tag(src, "ColorMode"); modes.sort(); modes.dedup();
  let c = Caps { sources, resolutions, modes, jpeg: x.contains("image/jpeg"), flatbed: (!platen.is_empty()).then(|| area(platen)), feeder: (!adf.is_empty()).then(|| area(adf)) };
  s.caps = Some(c.clone()); Ok(c)
}

fn settings_xml(source: &str, mode: &str, dpi: u32, w: u32, h: u32) -> String {
  let input = if source == "flatbed" { "Platen" } else { "Feeder" };
  let duplex = if source == "flatbed" { String::new() } else { format!("<scan:Duplex>{}</scan:Duplex>", source == "duplex") };
  format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm"><pwg:Version>2.0</pwg:Version><scan:Intent>Document</scan:Intent><pwg:ScanRegions><pwg:ScanRegion><pwg:Height>{h}</pwg:Height><pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits><pwg:Width>{w}</pwg:Width><pwg:XOffset>0</pwg:XOffset><pwg:YOffset>0</pwg:YOffset></pwg:ScanRegion></pwg:ScanRegions><pwg:InputSource>{input}</pwg:InputSource>{duplex}<scan:ColorMode>{mode}</scan:ColorMode><scan:XResolution>{dpi}</scan:XResolution><scan:YResolution>{dpi}</scan:YResolution><pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat><scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt></scan:ScanSettings>"#)
}

async fn pause(ms: u64, cancel: &CancellationToken) { tokio::select! { _ = tokio::time::sleep(Duration::from_millis(ms)) => {}, _ = cancel.cancelled() => {} } }

// Runs one eSCL job and hands every page to `on_page` as the scanner delivers it; deletes the job when cancelled
pub async fn scan(http: &reqwest::Client, s: &mut Scanner, o: &ScanOpts, cancel: &CancellationToken, mut on_page: impl FnMut(Page)) -> Result<(), String> {
  let caps = capabilities(http, s).await?;
  if !caps.jpeg { return Err("This scanner does not offer JPEG output over eSCL".into()) }
  if !caps.sources.contains(&o.source) { return Err(format!("Source \"{}\" is not supported by this scanner", o.source)) }
  let dpi = caps.resolutions.iter().copied().min_by_key(|r| r.abs_diff(o.dpi)).unwrap_or(o.dpi);
  let want = if o.mode == "color" { "RGB24" } else { "Grayscale8" };
  let mode = if caps.modes.is_empty() || caps.modes.iter().any(|m| m == want) { want.to_string() } else { caps.modes[0].clone() };
  let (mw, mh) = (if o.source == "flatbed" { caps.flatbed } else { caps.feeder }).unwrap_or((2480, 3508));
  let (xml, b) = (settings_xml(&o.source, &mode, dpi, mw.min(2480), mh.min(3508)), base(s));
  let mut job = None;
  for _ in 0..10 {
    if cancel.is_cancelled() { return Ok(()) }
    let r = http.post(b.clone() + "ScanJobs").header("Content-Type", "text/xml").body(xml.clone()).timeout(Duration::from_secs(60)).send().await.map_err(err)?;
    match r.status().as_u16() {
      201 => { let loc = r.headers().get("location").and_then(|v| v.to_str().ok()).ok_or("Scanner gave no job location")?; job = Some(reqwest::Url::parse(&b).and_then(|u| u.join(loc)).map_err(|e| e.to_string())?.to_string().trim_end_matches('/').to_string()); break }
      503 => pause(1500, cancel).await,
      409 => return Err(if o.source == "flatbed" { "Scanner is busy".into() } else { "The document feeder is empty".into() }),
      c => return Err(format!("Scanner refused the job ({c})")),
    }
  }
  let job = job.ok_or("Scanner stayed busy")?;
  let res = async {
    let mut busy = 0;
    while !cancel.is_cancelled() {
      let r = tokio::select! { r = http.get(format!("{job}/NextDocument")).timeout(Duration::from_secs(120)).send() => r.map_err(err)?, _ = cancel.cancelled() => break };
      match r.status().as_u16() {
        200 => { busy = 0; let jpeg = r.bytes().await.map_err(err)?.to_vec(); on_page(Page { dpi, jpeg }) }
        503 if busy < 60 => { busy += 1; pause(1000, cancel).await }
        404 | 410 => return Ok(()),
        c => return Err(format!("Scanner stopped with status {c}")),
      }
    }
    Ok(())
  }.await;
  if cancel.is_cancelled() { let _ = http.delete(&job).timeout(Duration::from_secs(5)).send().await; }
  res
}

// Probes a manually entered IP/host for an eSCL endpoint on the usual ports
pub async fn probe(http: &reqwest::Client, host: &str) -> Result<Scanner, String> {
  for (port, tls) in [(80, false), (443, true), (8080, false)] {
    let mut s = Scanner { id: format!("{host}:{port}").to_lowercase(), name: host.into(), model: String::new(), host: host.into(), port, manual: true, tls, rs: "eSCL".into(), caps: None };
    if capabilities(http, &mut s).await.is_ok() { return Ok(s) }
  }
  Err(format!("No eSCL scanner answered at {host}"))
}
