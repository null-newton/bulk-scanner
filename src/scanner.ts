// Talks to the Rust backend (mDNS discovery + eSCL scan jobs) and turns raw scans into stored pages. Dev builds add a demo scanner.
import { Channel, invoke } from '@tauri-apps/api/core'
export type Source = 'flatbed' | 'feeder' | 'duplex'
export type ColorMode = 'color' | 'gray' | 'bw'
export interface Scanner { id: string; name: string; model: string; host: string; port?: number; manual?: boolean; demo?: boolean }
export interface Caps { sources: Source[]; resolutions: number[]; modes: string[] }
export interface Page { id: string; blob: Blob; thumb: Blob; w: number; h: number; dpi: number; rot: number }
export interface ScanOpts { source: Source; mode: ColorMode; dpi: number; skipBlank: boolean }

export const uid = () => Math.random().toString(36).slice(2, 10)
const DEMO: Scanner[] = import.meta.env.DEV ? [{ id: 'demo-1', name: 'Demo scanner', model: 'Simulated feeder + flatbed', host: 'demo', demo: true }] : []
const err = (e: unknown) => new Error(typeof e === 'string' ? e : (e as Error)?.message ?? String(e))
const call = <T,>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args).catch((e) => { throw err(e) })

export const bridgeOnline = async () => true
export const listScanners = async (_online: boolean, host?: string) => [...await call<Scanner[]>('list_scanners', { host: host ?? null }), ...(host ? [] : DEMO)]
export const capabilities = (id: string): Promise<Caps> => id.startsWith('demo') ? Promise.resolve({ sources: ['flatbed', 'feeder', 'duplex'], resolutions: [150, 300, 600], modes: [] }) : call<Caps>('capabilities', { id })

type Msg = { type: 'page'; n: number; dpi: number; data: string }
// Runs a scan job in Rust, receiving each page over a channel; returns the blank pages it held back
export async function runScan(scanner: Scanner, o: ScanOpts, onPage: (p: Page) => void, onProgress: (n: number) => void, signal: AbortSignal) {
  const skipped: Page[] = []
  const take = async (blob: Blob, dpi: number) => { const { blank, ...p } = await ingest(blob, dpi, o.mode); if (blank && o.skipBlank) skipped.push(p); else onPage(p) }
  if (scanner.demo) {
    const sides = o.source === 'duplex' ? 2 : 1
    for (let i = 0; i < sides && !signal.aborted; i++) { onProgress(i + 1); await new Promise((r) => setTimeout(r, 700)); await take(await demoPage(i === 1 && Math.random() < 0.5), 75) }
    return skipped
  }
  const job = uid(), ch = new Channel<Msg>()
  let n = 0, chain = Promise.resolve()
  ch.onmessage = (m) => { if (m.type === 'page') { onProgress(++n + 1); chain = chain.then(() => take(new Blob([Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }), m.dpi)) } }
  const stop = () => void invoke('cancel_scan', { job })
  signal.addEventListener('abort', stop)
  onProgress(1)
  try { await call('scan', { id: scanner.id, opts: { source: o.source, mode: o.mode, dpi: o.dpi }, job, onPage: ch }) } finally { signal.removeEventListener('abort', stop) }
  await chain
  return skipped
}

const canvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h })
const jpeg = (c: HTMLCanvasElement, q: number) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', q))

// Decodes a scanned JPEG: flags blank pages, applies B&W threshold and builds a small thumbnail
export async function ingest(blob: Blob, dpi: number, mode: ColorMode): Promise<Page & { blank: boolean }> {
  const bmp = await createImageBitmap(blob), { width: w, height: h } = bmp, blank = isBlank(bmp)
  let out = blob
  if (mode === 'bw') {
    const c = canvas(w, h), g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(bmp, 0, 0)
    const im = g.getImageData(0, 0, w, h), d = im.data
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 > 160 ? 255 : 0
    g.putImageData(im, 0, 0); out = await jpeg(c, 0.8)
  }
  const tw = 240, tc = canvas(tw, Math.round(h * tw / w)); tc.getContext('2d')!.drawImage(bmp, 0, 0, tc.width, tc.height); bmp.close()
  return { id: uid(), blob: out, thumb: await jpeg(tc, 0.7), w, h, dpi, rot: 0, blank }
}

// A page is blank when, ignoring a 5% border, almost no pixels are clearly darker than the paper
function isBlank(bmp: ImageBitmap) {
  const W = 200, H = Math.round(bmp.height * W / bmp.width), c = canvas(W, H), g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(bmp, 0, 0, W, H)
  const d = g.getImageData(0, 0, W, H).data, mx = Math.round(W * 0.05), my = Math.round(H * 0.05), lum: number[] = []
  for (let y = my; y < H - my; y++) for (let x = mx; x < W - mx; x++) { const i = (y * W + x) * 4; lum.push(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) }
  const paper = [...lum].sort((a, b) => a - b)[Math.floor(lum.length * 0.6)], ink = lum.filter((v) => v < paper - 60).length
  return ink / lum.length < 0.002
}

let demoN = 0
// Generates a fake scanned page; `blank` simulates the empty back side of a duplex sheet
function demoPage(blank = false): Promise<Blob> {
  const w = 620, h = 877, c = canvas(w, h), g = c.getContext('2d')!, n = ++demoN
  g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, w, h)
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 1) }
  if (!blank) {
    g.fillStyle = `hsl(${(n * 47) % 360} 55% 42%)`; g.fillRect(48, 52, 180, 26); g.fillRect(w - 128, 48, 80, 80)
    g.fillStyle = '#9a9a9a'; for (let y = 170; y < h - 90; y += 22) g.fillRect(48, y, (w - 96) * (0.55 + Math.random() * 0.45), 8)
    g.fillStyle = '#333'; g.font = 'bold 28px monospace'; g.fillText(`DEMO ${n}`, 48, 140)
  }
  return jpeg(c, 0.85)
}
