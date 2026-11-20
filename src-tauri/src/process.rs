// Page clean-up after scanning: turn sideways/upside-down pages upright, straighten crooked pages and crop flatbed scans
use image::{codecs::jpeg::JpegEncoder, imageops, GrayImage, RgbImage};
use imageproc::geometric_transformations::{rotate_about_center, Border, Interpolation};

#[derive(Clone, Copy, Default, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Opts { pub auto_rotate: bool, pub straighten: bool, pub crop: bool }

#[derive(Debug, Default, PartialEq)]
pub struct Report { pub turn: u32, pub skew: f32, pub cropped: bool }

const MAX_SKEW: f32 = 10.0;
const ANALYSIS: u32 = 1600;

// Downscaled grey copy plus the paper brightness (60th percentile) and ink points (clearly darker than paper)
fn ink_points(g: &GrayImage) -> (Vec<(f32, f32)>, u8) {
  let mut hist = [0u32; 256];
  g.pixels().for_each(|p| hist[p[0] as usize] += 1);
  let (total, mut acc) = (g.pixels().len() as u32, 0);
  let paper = (0..256).find(|&v| { acc += hist[v]; acc >= total * 6 / 10 }).unwrap_or(255) as u8;
  let limit = paper.saturating_sub(55);
  let pts: Vec<(f32, f32)> = g.enumerate_pixels().filter(|(_, _, p)| p[0] < limit).map(|(x, y, _)| (x as f32, y as f32)).collect();
  let step = (pts.len() / 80_000).max(1);
  (pts.into_iter().step_by(step).collect(), paper)
}

// Row profile of the points after rotating them by `deg` (text lines become sharp peaks when the angle is right)
fn profile(pts: &[(f32, f32)], deg: f32) -> Vec<f32> {
  let (s, c) = deg.to_radians().sin_cos();
  let ys: Vec<f32> = pts.iter().map(|&(x, y)| y * c - x * s).collect();
  let lo = ys.iter().cloned().fold(f32::MAX, f32::min);
  let mut h = vec![0f32; (ys.iter().cloned().fold(f32::MIN, f32::max) - lo) as usize + 2];
  ys.iter().for_each(|&y| h[(y - lo) as usize] += 1.0);
  h
}
fn sharpness(h: &[f32]) -> f32 { h.iter().map(|v| v * v).sum() }

// Best text-line angle in degrees (−90..90]: 0 = upright lines, ±90 = sideways; refined to 0.1°
fn line_angle(pts: &[(f32, f32)]) -> f32 {
  let best = |from: f32, to: f32, step: f32| { let mut a = from; let mut b = (f32::MIN, from); while a <= to + 1e-3 { let s = sharpness(&profile(pts, a)); if s > b.0 { b = (s, a) } a += step } b.1 };
  let coarse = [0.0f32, 90.0].iter().map(|&base| best(base - MAX_SKEW, base + MAX_SKEW, 0.5)).max_by(|a, b| sharpness(&profile(pts, *a)).total_cmp(&sharpness(&profile(pts, *b)))).unwrap();
  let fine = best(coarse - 0.5, coarse + 0.5, 0.1);
  if fine > 90.0 - MAX_SKEW { fine - 180.0 } else { fine }
}

// Upright-ness of text lines in the frame rotated by `deg` (>0 upright, <0 upside down, None = too few lines). Combines two cues:
// Latin letters reach above the x-height band more than below it, and most text is left-aligned with a ragged right edge
fn uprightness(pts: &[(f32, f32)], deg: f32) -> Option<f32> {
  let (s, c) = deg.to_radians().sin_cos();
  let pr: Vec<(f32, f32)> = pts.iter().map(|&(x, y)| (x * c + y * s, y * c - x * s)).collect();
  let lo = pr.iter().map(|p| p.1).fold(f32::MAX, f32::min);
  let mut h = vec![0f32; (pr.iter().map(|p| p.1).fold(f32::MIN, f32::max) - lo) as usize + 2];
  pr.iter().for_each(|p| h[(p.1 - lo) as usize] += 1.0);
  let peak = h.iter().cloned().fold(0.0, f32::max);
  let (mut above, mut below, mut bands, mut y) = (0.0, 0.0, Vec::new(), 0);
  while y < h.len() {
    if h[y] <= peak * 0.08 { y += 1; continue }
    let start = y; while y < h.len() && h[y] > peak * 0.08 { y += 1 }
    let band = &h[start..y]; let top = band.iter().cloned().fold(0.0, f32::max);
    if band.len() < 4 || band.iter().sum::<f32>() < 40.0 { continue }
    let core: Vec<usize> = (0..band.len()).filter(|&i| band[i] > top * 0.5).collect();
    let (c0, c1) = (core[0], *core.last().unwrap());
    above += band[..c0].iter().sum::<f32>(); below += band[c1 + 1..].iter().sum::<f32>();
    bands.push((start as f32 + lo, y as f32 + lo));
  }
  if bands.len() < 3 { return None }
  // Left/right edge of every line (5th/95th percentile of its points' x' so specks don't count)
  let (mut starts, mut ends) = (Vec::new(), Vec::new());
  for &(b0, b1) in &bands {
    let mut xs: Vec<f32> = pr.iter().filter(|p| p.1 >= b0 && p.1 < b1).map(|p| p.0).collect();
    if xs.len() < 20 { continue }
    xs.sort_by(f32::total_cmp);
    starts.push(xs[xs.len() / 20]); ends.push(xs[xs.len() * 19 / 20]);
  }
  let spread = |v: &[f32]| { let m = v.iter().sum::<f32>() / v.len() as f32; (v.iter().map(|x| (x - m).powi(2)).sum::<f32>() / v.len() as f32).sqrt() };
  let (ss, se) = (spread(&starts), spread(&ends));
  let align = if ss + se < 4.0 { 0.0 } else { (se - ss) / (se + ss) };
  let shape = if above + below < 1.0 { 0.0 } else { (above - below) / (above + below) };
  Some(shape + align)
}

fn analysis_copy(img: &RgbImage) -> (GrayImage, f32) {
  let g = imageops::grayscale(img);
  let f = (ANALYSIS as f32 / img.width().max(img.height()) as f32).min(1.0);
  if f >= 1.0 { (g, 1.0) } else { (imageops::resize(&g, (g.width() as f32 * f) as u32, (g.height() as f32 * f) as u32, imageops::FilterType::Triangle), f) }
}

// Decides the clockwise quarter turns (0–3) and remaining skew (degrees, image to be rotated by −skew) for a page
pub fn analyse(img: &RgbImage) -> Option<(u32, f32)> {
  let (g, _) = analysis_copy(img);
  let (pts, _) = ink_points(&g);
  if pts.len() < 1500 { return None } // too little text to judge
  let angle = line_angle(&pts);
  let (turn, skew) = if angle > 45.0 { (3u32, angle - 90.0) } else if angle < -45.0 { (1, angle + 90.0) } else { (0, angle) };
  // Map points into the "lines horizontal" frame, then check which way up the text is
  // A clockwise image turn of q quarters equals rotating the points by −q·90° in profile()'s convention
  let up = uprightness(&pts, skew - turn as f32 * 90.0).unwrap_or(0.0);
  let turn = if up < -0.2 { (turn + 2) % 4 } else { turn };
  Some((turn, skew))
}

fn turn(img: RgbImage, quarter: u32) -> RgbImage { match quarter { 1 => imageops::rotate90(&img), 2 => imageops::rotate180(&img), 3 => imageops::rotate270(&img), _ => img } }

// Crops to what differs from the scanner-lid background (a contrasting page, or else the printed content) plus a margin
fn crop_box(img: &RgbImage) -> Option<(u32, u32, u32, u32)> {
  let (g, f) = analysis_copy(img);
  let (w, h) = g.dimensions();
  let mut border: Vec<u8> = g.enumerate_pixels().filter(|(x, y, _)| *x < w / 50 || *y < h / 50 || *x >= w - w / 50 || *y >= h - h / 50).map(|(_, _, p)| p[0]).collect();
  border.sort_unstable();
  let bg = border[border.len() / 2] as i16;
  let fg = |x: u32, y: u32| (g.get_pixel(x, y)[0] as i16 - bg).abs() > 6;
  let rows: Vec<u32> = (0..h).map(|y| (0..w).filter(|&x| fg(x, y)).count() as u32).collect();
  let cols: Vec<u32> = (0..w).map(|x| (0..h).filter(|&y| fg(x, y)).count() as u32).collect();
  let span = |v: &[u32], min: u32| { let i = v.iter().position(|&n| n > min)?; let j = v.iter().rposition(|&n| n > min)?; Some((i as u32, j as u32)) };
  let (y0, y1) = span(&rows, (w / 100).max(2))?;
  let (x0, x1) = span(&cols, (h / 100).max(2))?;
  let m = (w.min(h) as f32 * 0.02) as u32;
  let (x0, y0, x1, y1) = (x0.saturating_sub(m), y0.saturating_sub(m), (x1 + m).min(w - 1), (y1 + m).min(h - 1));
  if (x1 - x0) * (y1 - y0) > w * h * 85 / 100 { return None } // nothing worth cropping
  let s = |v: u32| (v as f32 / f) as u32;
  Some((s(x0), s(y0), s(x1 - x0).min(img.width() - s(x0)), s(y1 - y0).min(img.height() - s(y0))))
}

// Applies the enabled steps to one scanned JPEG; returns the new JPEG (unchanged bytes if nothing applied) and what was done
pub fn process(jpeg: &[u8], o: Opts) -> Result<(Vec<u8>, Report), String> {
  if !o.auto_rotate && !o.straighten && !o.crop { return Ok((jpeg.to_vec(), Report::default())) }
  let mut img = image::load_from_memory(jpeg).map_err(|e| format!("Could not read scanned page: {e}"))?.to_rgb8();
  let mut r = Report::default();
  if o.auto_rotate || o.straighten {
    if let Some((q, skew)) = analyse(&img) {
      if o.auto_rotate && q != 0 { img = turn(img, q); r.turn = q * 90 }
      if o.straighten && skew.abs() >= 0.3 {
        let paper = ink_points(&analysis_copy(&img).0).1;
        img = rotate_about_center(&img, -skew.to_radians(), Interpolation::Bilinear, Border::Constant(image::Rgb([paper; 3])));
        r.skew = skew;
      }
    }
  }
  if o.crop { if let Some((x, y, w, h)) = crop_box(&img) { img = imageops::crop_imm(&img, x, y, w, h).to_image(); r.cropped = true } }
  if r == Report::default() { return Ok((jpeg.to_vec(), r)) }
  let mut out = Vec::new();
  JpegEncoder::new_with_quality(&mut out, 88).encode_image(&img).map_err(|e| e.to_string())?;
  Ok((out, r))
}

#[cfg(test)]
mod tests {
  use super::*;
  fn fixture(name: &str) -> RgbImage { image::open(format!("{}/tests/fixtures/{name}.jpg", env!("CARGO_MANIFEST_DIR"))).unwrap().to_rgb8() }
  fn check(name: &str, turn: u32, skew: f32) {
    let (q, s) = analyse(&fixture(name)).unwrap_or_else(|| panic!("{name}: no decision"));
    println!("{name}: turn {} skew {s:.2}", q * 90);
    assert_eq!(q * 90, turn, "{name}: wrong turn"); assert!((s - skew).abs() < 0.6, "{name}: skew {s} expected {skew}");
  }
  #[test] fn upright() { check("upright", 0, 0.0) }
  #[test] fn upside_down() { check("upside_down", 180, 0.0) }
  #[test] fn sideways_cw() { check("sideways_cw", 270, 0.0) }
  #[test] fn sideways_ccw() { check("sideways_ccw", 90, 0.0) }
  #[test] fn skew_plus4() { check("skew_plus4", 0, -4.0) }
  #[test] fn skew_minus3() { check("skew_minus3", 0, 3.0) }
  #[test] fn upside_down_skewed() { check("upside_down_skew2", 180, -2.0) }
  #[test]
  fn mostly_blank_is_left_alone() { if let Some((q, s)) = analyse(&fixture("mostly_blank")) { assert_eq!(q, 0); assert!(s.abs() < 0.6) } }
  // Processing must actually level and right the page: re-analysing the output finds nothing left to fix
  #[test]
  fn processed_pages_come_out_level() {
    for name in ["skew_plus4", "skew_minus3", "upside_down_skew2", "sideways_cw", "sideways_ccw"] {
      let bytes = std::fs::read(format!("{}/tests/fixtures/{name}.jpg", env!("CARGO_MANIFEST_DIR"))).unwrap();
      let (out, _) = process(&bytes, Opts { auto_rotate: true, straighten: true, crop: false }).unwrap();
      let (q, s) = analyse(&image::load_from_memory(&out).unwrap().to_rgb8()).unwrap();
      assert!(q == 0 && s.abs() < 0.4, "{name}: still turn {} skew {s}", q * 90);
    }
  }
  #[test]
  fn flatbed_receipt_is_straightened_and_cropped() {
    let bytes = std::fs::read(format!("{}/tests/fixtures/flatbed_receipt.jpg", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let (out, r) = process(&bytes, Opts { auto_rotate: true, straighten: true, crop: true }).unwrap();
    let (src, dst) = (image::load_from_memory(&bytes).unwrap(), image::load_from_memory(&out).unwrap());
    println!("receipt: {r:?} {}x{} -> {}x{}", src.width(), src.height(), dst.width(), dst.height());
    assert!(r.cropped && dst.width() < src.width() / 2 && dst.height() < src.height() * 2 / 3);
    assert_eq!(r.turn, 0); assert!((r.skew + 5.0).abs() < 1.0, "skew {}", r.skew);
  }
  // Writes processed fixtures to $BS_DUMP for eyeballing: BS_DUMP=dir cargo test dump -- --ignored
  #[test]
  #[ignore]
  fn dump() {
    let dir = std::env::var("BS_DUMP").unwrap();
    for name in ["flatbed_receipt", "skew_plus4", "sideways_cw"] {
      let bytes = std::fs::read(format!("{}/tests/fixtures/{name}.jpg", env!("CARGO_MANIFEST_DIR"))).unwrap();
      std::fs::write(format!("{dir}/{name}.jpg"), process(&bytes, Opts { auto_rotate: true, straighten: true, crop: true }).unwrap().0).unwrap();
    }
  }
}
