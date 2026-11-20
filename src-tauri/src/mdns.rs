// One-shot legacy mDNS queries for AirScan/eSCL (_uscan/_uscans) sent from an ephemeral port on every IPv4 interface;
// responders answer by unicast, so no system mDNS daemon or port 5353 binding is needed.
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, UdpSocket as StdUdp};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::UdpSocket;

const SERVICES: [&str; 2] = ["_uscan._tcp.local", "_uscans._tcp.local"];

#[derive(Clone, Debug, Default)]
pub struct Found { pub id: String, pub name: String, pub model: String, pub host: String, pub port: u16, pub tls: bool, pub rs: String }

#[derive(Default, Clone)]
struct Entry { inst: String, tls: bool, host: String, port: u16, txt: HashMap<String, String> }

enum Rec { Ptr(String, String), Srv(String, u16, String), A(String, String), Txt(String, HashMap<String, String>), Other }

fn enc_name(n: &str) -> Vec<u8> { let mut v = Vec::new(); for l in n.split('.') { v.push(l.len() as u8); v.extend_from_slice(l.as_bytes()) } v.push(0); v }

fn query() -> Vec<u8> {
  let mut q = vec![0u8; 12]; q[5] = SERVICES.len() as u8;
  for s in SERVICES { q.extend(enc_name(s)); q.extend_from_slice(&[0, 12, 0, 1]) }
  q
}

// Reads a (possibly compressed) DNS name; returns it with the offset right after it
fn read_name(b: &[u8], mut off: usize) -> (String, usize) {
  let (mut labels, mut jumped, mut end) = (Vec::new(), false, off);
  for _ in 0..64 {
    let Some(&len) = b.get(off) else { break };
    if len & 0xc0 == 0xc0 { if !jumped { end = off + 2 } off = (((len & 0x3f) as usize) << 8) | *b.get(off + 1).unwrap_or(&0) as usize; jumped = true; continue }
    if len == 0 { if !jumped { end = off + 1 } break }
    let s = off + 1; labels.push(String::from_utf8_lossy(b.get(s..s + len as usize).unwrap_or_default()).into_owned()); off = s + len as usize;
  }
  (labels.join("."), end)
}

fn u16at(b: &[u8], o: usize) -> Option<u16> { Some(u16::from_be_bytes([*b.get(o)?, *b.get(o + 1)?])) }

fn parse(b: &[u8]) -> Option<Vec<Rec>> {
  let counts: Vec<u16> = [4, 6, 8, 10].iter().map(|&o| u16at(b, o)).collect::<Option<_>>()?;
  let (mut off, mut recs) = (12, Vec::new());
  for _ in 0..counts[0] { off = read_name(b, off).1 + 4 }
  for _ in 0..(counts[1] as usize + counts[2] as usize + counts[3] as usize) {
    let (name, o) = read_name(b, off); let (ty, len, d) = (u16at(b, o)?, u16at(b, o + 8)? as usize, o + 10);
    if d + len > b.len() { return None }
    recs.push(match ty {
      12 => Rec::Ptr(name, read_name(b, d).0),
      33 => Rec::Srv(name, u16at(b, d + 4)?, read_name(b, d + 6).0),
      1 if len == 4 => Rec::A(name, Ipv4Addr::new(b[d], b[d + 1], b[d + 2], b[d + 3]).to_string()),
      16 => { let (mut t, mut p) = (HashMap::new(), d); while p < d + len { let l = b[p] as usize; let s = String::from_utf8_lossy(&b[(p + 1).min(d + len)..(p + 1 + l).min(d + len)]).into_owned(); if l > 0 { match s.split_once('=') { Some((k, v)) => t.insert(k.to_lowercase(), v.into()), None => t.insert(s.to_lowercase(), String::new()) }; } p += l + 1 } Rec::Txt(name, t) }
      _ => Rec::Other,
    });
    off = d + len;
  }
  Some(recs)
}

fn is_svc(inst: &str) -> bool { let l = inst.to_lowercase(); SERVICES.iter().any(|s| l.ends_with(s)) }

fn on_msg(found: &Mutex<HashMap<String, Entry>>, msg: &[u8], from: SocketAddr) {
  let Some(recs) = parse(msg) else { return };
  let a: HashMap<String, String> = recs.iter().filter_map(|r| if let Rec::A(n, ip) = r { Some((n.to_lowercase(), ip.clone())) } else { None }).collect();
  let mut f = found.lock().unwrap();
  for r in &recs {
    let inst = match r { Rec::Ptr(n, p) if SERVICES.contains(&n.to_lowercase().as_str()) => p, Rec::Srv(n, ..) | Rec::Txt(n, _) => n, _ => continue };
    if !is_svc(inst) { continue }
    let e = f.entry(inst.clone()).or_insert_with(|| Entry { inst: inst.clone(), tls: inst.to_lowercase().contains("_uscans."), host: from.ip().to_string(), ..Default::default() });
    match r { Rec::Srv(_, port, target) => { e.port = *port; if let Some(ip) = a.get(&target.to_lowercase()) { e.host = ip.clone() } } Rec::Txt(_, t) => e.txt = t.clone(), _ => {} }
  }
}

// Queries every interface and collects eSCL services for `ms` milliseconds; plain http wins over https per device
pub async fn discover(ms: u64) -> Vec<Found> {
  let found = Arc::new(Mutex::new(HashMap::<String, Entry>::new()));
  let mut ips: Vec<Ipv4Addr> = if_addrs::get_if_addrs().unwrap_or_default().into_iter().filter(|i| !i.is_loopback()).filter_map(|i| match i.ip() { std::net::IpAddr::V4(v) => Some(v), _ => None }).collect();
  if ips.is_empty() { ips.push(Ipv4Addr::UNSPECIFIED) }
  let (q, mut tasks) = (Arc::new(query()), Vec::new());
  for ip in ips {
    let Ok(std) = StdUdp::bind((ip, 0)) else { continue };
    let sk = socket2::SockRef::from(&std); let _ = sk.set_multicast_if_v4(&ip); let _ = sk.set_multicast_ttl_v4(255); let _ = std.set_nonblocking(true);
    let Ok(sock) = UdpSocket::from_std(std) else { continue };
    let (sock, q, found) = (Arc::new(sock), q.clone(), found.clone());
    tasks.push(tokio::spawn(async move {
      let s2 = sock.clone();
      let send = tokio::spawn(async move { for wait in [0, 600, 800] { tokio::time::sleep(Duration::from_millis(wait)).await; let _ = s2.send_to(&q, ("224.0.0.251", 5353)).await; } });
      let mut buf = vec![0u8; 9000];
      let _ = tokio::time::timeout(Duration::from_millis(ms), async { loop { match sock.recv_from(&mut buf).await { Ok((n, from)) => on_msg(&found, &buf[..n], from), Err(_) => tokio::time::sleep(Duration::from_millis(50)).await } } }).await;
      send.abort();
    }));
  }
  for t in tasks { let _ = t.await; }
  let mut by_id: HashMap<String, Found> = HashMap::new();
  for e in found.lock().unwrap().values().filter(|e| e.port > 0) {
    let id = e.txt.get("uuid").filter(|u| !u.is_empty()).cloned().unwrap_or_else(|| format!("{}:{}", e.host, e.port)).to_lowercase();
    if by_id.get(&id).is_some_and(|p| !p.tls) { continue }
    let name = e.inst.split("._uscan").next().unwrap_or(&e.inst).replace("\\032", " ");
    let model = e.txt.get("ty").cloned().filter(|s| !s.is_empty()).or_else(|| e.txt.get("product").map(|p| p.replace(['(', ')'], ""))).unwrap_or_default();
    let rs = e.txt.get("rs").cloned().unwrap_or_else(|| "eSCL".into()).trim_matches('/').to_string();
    by_id.insert(id.clone(), Found { id, name, model, host: e.host.clone(), port: e.port, tls: e.tls, rs });
  }
  by_id.into_values().collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  // Builds a minimal mDNS answer (PTR + SRV + TXT + A, with name compression) like a printer would send
  fn answer() -> Vec<u8> {
    let mut b = vec![0, 0, 0x84, 0, 0, 0, 0, 4, 0, 0, 0, 0];
    let svc = b.len(); b.extend(enc_name("_uscan._tcp.local")); b.extend([0, 12, 0, 1, 0, 0, 0, 120]);
    let inst = { let mut v = vec![7]; v.extend(b"HP-Lab1"); v };
    let mut rd = inst.clone(); rd.extend([0xc0, svc as u8]); b.extend((rd.len() as u16).to_be_bytes()); let iname = b.len(); b.extend(&rd);
    b.extend([0xc0, iname as u8, 0, 33, 0, 1, 0, 0, 0, 120]); let host = enc_name("hp.local"); b.extend(((6 + host.len()) as u16).to_be_bytes()); b.extend([0, 0, 0, 0, 0, 80]); b.extend(&host);
    let txt: Vec<u8> = ["ty=HP Color Laser", "rs=/eSCL", "uuid=ABC-1"].iter().flat_map(|s| { let mut v = vec![s.len() as u8]; v.extend(s.as_bytes()); v }).collect();
    b.extend([0xc0, iname as u8, 0, 16, 0, 1, 0, 0, 0, 120]); b.extend((txt.len() as u16).to_be_bytes()); b.extend(txt);
    b.extend(host); b.extend([0, 1, 0, 1, 0, 0, 0, 120, 0, 4, 192, 168, 1, 50]);
    b
  }

  #[test]
  fn query_asks_for_both_services() { let q = query(); assert_eq!(q[5], 2); assert_eq!(read_name(&q, 12).0, "_uscan._tcp.local"); }

  #[test]
  fn parses_scanner_announcement() {
    let found = Mutex::new(HashMap::new());
    on_msg(&found, &answer(), "192.168.1.9:5353".parse().unwrap());
    let f = found.lock().unwrap(); let e = f.values().next().expect("entry");
    assert_eq!((e.host.as_str(), e.port, e.tls), ("192.168.1.50", 80, false));
    assert_eq!(e.txt.get("ty").map(String::as_str), Some("HP Color Laser"));
    assert_eq!(e.txt.get("uuid").map(String::as_str), Some("ABC-1"));
  }
}
