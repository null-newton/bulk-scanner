import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Download, ArrowRight, Calendar, ChevronLeft, ChevronRight, Clock, Copy, FileArchive, FileDown, FilePlus2, FolderOpen, Hash, Keyboard, Loader2, Pencil, Plus, Printer, RefreshCw, RotateCw, ScanLine, Square, TextCursorInput, Trash2, Type, X } from 'lucide-react'
import { useLang, useT } from './i18n'
import { useUpdater } from './updater'
import { buildPdf, buildZip, download } from './pdf-zip'
import { native, capabilities, listScanners, runScan, uid, type Caps, type ColorMode, type Page, type Scanner, type Source } from './scanner'
import { deleteSession, getSession, listSessions, newSession, putSession, type Doc, type Session } from './store'

const STR = {
  en: {
    intro: 'Scan many documents in one session. Each scan is named by your own rules and everything stays on this computer — save the whole batch as a ZIP of PDFs.',
    loading: 'Opening your scan session…', scanner: 'Scanner', refresh: 'Search network', addIp: 'Add by IP', ipPh: '192.168.1.42',
    online: (n: number) => `${n} scanner${n === 1 ? '' : 's'} found`, none: 'No scanners found', browserOnly: 'Browser preview — demo scanner only, open the app for real scanners', update: (v: string) => `Update to ${v}`, updating: 'Updating…', updateFail: 'Update failed', updateHint: 'Downloads the new version and restarts the app', searching: 'Searching for scanners…', add: 'Add',
    source: 'Source', flatbed: 'Flatbed', feeder: 'Feeder', duplex: 'Duplex', color: 'Colour', mode: { color: 'Colour', gray: 'Grey', bw: 'B&W' }, dpi: 'Resolution', skipBlank: 'Skip blank pages',
    scan: 'Scan pages', scanning: (n: number) => n > 1 ? `Scanning… ${n - 1} received` : 'Scanning…', stop: 'Stop', newScan: 'Finish & new scan', current: 'Current scan', pages: (n: number) => `${n} page${n === 1 ? '' : 's'}`,
    skipped: (n: number) => `${n} blank page${n === 1 ? '' : 's'} skipped`, empty: 'No pages yet. Put a document on the scanner and press Scan.', namePreview: 'Will be saved as', dragHint: 'Drag to reorder · click to view',
    naming: 'Naming convention', preset: 'Preset', newPreset: 'New preset', dupPreset: 'Duplicate', delPreset: 'Delete preset', delPresetConfirm: 'Delete this naming preset?', presetName: 'Preset name', copyOf: (n: string) => `${n} copy`,
    addBlock: 'Add block', preview: 'Preview', kinds: { date: 'Date', time: 'Time', text: 'Text', sep: 'Separator', input: 'Input on save', counter: 'Counter' },
    whichDate: 'Which date', when: { today: 'Today', ask: 'Ask on save', fixed: 'Fixed' }, today: 'Today', yesterday: 'Yesterday', fmt: 'Format', textVal: 'Text', label: 'Question', start: 'Next number', pad: 'Digits', ask: 'Asked when you finish a scan',
    session: 'Files in this session', started: (d: string) => `Started ${d}`, noDocs: 'Finished scans appear here. The session is saved on this device, so you can close the page and resume later.',
    saveAll: (n: number) => `Save all (${n})`, sessions: 'Sessions', newSession: 'New session', resume: 'Resume', active: 'Open', saved: 'Downloaded', delSessionConfirm: 'Delete this session and all its scans from this device?', noSessions: 'No other sessions.', docsCount: (n: number) => `${n} scan${n === 1 ? '' : 's'}`,
    dialogTitle: 'Name this scan', save: 'Save scan', cancel: 'Cancel', dup: 'A scan with this name already exists — a number will be added.',
    keep: 'Keep anyway', delete: 'Delete', ok: 'Continue', newSessionConfirm: 'Start a new session? The current one stays under Sessions, including the unfinished scan.', addPages: 'Add pages to this file', addPagesBusy: 'Finish the current scan first', addingTo: 'Adding pages to', doneAdding: 'Done adding pages', discardAdded: 'Discard the pages you added and put the file back as it was?', shortcuts: 'S scan · N finish & new · Enter save all', rotate: 'Rotate (R)', remove: 'Remove (Del)', rename: 'Rename', pdf: 'Download PDF', lastValues: 'Recent', page: (a: number, b: number) => `Page ${a} of ${b}`,
  },
  nl: {
    intro: 'Scan veel documenten in één sessie. Elke scan krijgt een naam volgens je eigen regels en alles blijft op deze computer — bewaar alles als ZIP met PDF\'s.',
    loading: 'Je scansessie openen…', scanner: 'Scanner', refresh: 'Netwerk doorzoeken', addIp: 'Toevoegen via IP', ipPh: '192.168.1.42',
    online: (n: number) => `${n} scanner${n === 1 ? '' : 's'} gevonden`, none: 'Geen scanners gevonden', browserOnly: 'Browservoorbeeld — alleen demoscanner, open de app voor echte scanners', update: (v: string) => `Bijwerken naar ${v}`, updating: 'Bijwerken…', updateFail: 'Bijwerken mislukt', updateHint: 'Downloadt de nieuwe versie en herstart de app', searching: 'Scanners zoeken…', add: 'Toevoegen',
    source: 'Bron', flatbed: 'Glasplaat', feeder: 'Invoer', duplex: 'Dubbelzijdig', color: 'Kleur', mode: { color: 'Kleur', gray: 'Grijs', bw: 'Z/W' }, dpi: 'Resolutie', skipBlank: 'Lege pagina\'s overslaan',
    scan: 'Pagina\'s scannen', scanning: (n: number) => n > 1 ? `Scannen… ${n - 1} ontvangen` : 'Scannen…', stop: 'Stoppen', newScan: 'Afronden & nieuwe scan', current: 'Huidige scan', pages: (n: number) => `${n} pagina${n === 1 ? '' : '\'s'}`,
    skipped: (n: number) => `${n} lege pagina${n === 1 ? '' : '\'s'} overgeslagen`, empty: 'Nog geen pagina\'s. Leg een document op de scanner en druk op Scannen.', namePreview: 'Wordt opgeslagen als', dragHint: 'Sleep om te ordenen · klik om te bekijken',
    naming: 'Naamconventie', preset: 'Voorinstelling', newPreset: 'Nieuwe voorinstelling', dupPreset: 'Dupliceren', delPreset: 'Voorinstelling verwijderen', delPresetConfirm: 'Deze naamvoorinstelling verwijderen?', presetName: 'Naam voorinstelling', copyOf: (n: string) => `${n} kopie`,
    addBlock: 'Blok toevoegen', preview: 'Voorbeeld', kinds: { date: 'Datum', time: 'Tijd', text: 'Tekst', sep: 'Scheiding', input: 'Invoer bij opslaan', counter: 'Teller' },
    whichDate: 'Welke datum', when: { today: 'Vandaag', ask: 'Vragen bij opslaan', fixed: 'Vast' }, today: 'Vandaag', yesterday: 'Gisteren', fmt: 'Formaat', textVal: 'Tekst', label: 'Vraag', start: 'Volgend nummer', pad: 'Cijfers', ask: 'Gevraagd wanneer je een scan afrondt',
    session: 'Bestanden in deze sessie', started: (d: string) => `Gestart ${d}`, noDocs: 'Afgeronde scans verschijnen hier. De sessie wordt op dit toestel bewaard, dus je kunt de pagina sluiten en later verdergaan.',
    saveAll: (n: number) => `Alles opslaan (${n})`, sessions: 'Sessies', newSession: 'Nieuwe sessie', resume: 'Hervatten', active: 'Open', saved: 'Gedownload', delSessionConfirm: 'Deze sessie en alle scans van dit toestel verwijderen?', noSessions: 'Geen andere sessies.', docsCount: (n: number) => `${n} scan${n === 1 ? '' : 's'}`,
    dialogTitle: 'Geef deze scan een naam', save: 'Scan opslaan', cancel: 'Annuleren', dup: 'Er bestaat al een scan met deze naam — er wordt een nummer toegevoegd.',
    keep: 'Toch behouden', delete: 'Verwijderen', ok: 'Doorgaan', newSessionConfirm: 'Een nieuwe sessie starten? De huidige blijft bewaard onder Sessies, ook de onafgeronde scan.', addPages: "Pagina's toevoegen aan dit bestand", addPagesBusy: 'Rond eerst de huidige scan af', addingTo: "Pagina's toevoegen aan", doneAdding: 'Klaar met toevoegen', discardAdded: "De toegevoegde pagina's weggooien en het bestand terugzetten zoals het was?", shortcuts: 'S scannen · N afronden & nieuw · Enter alles opslaan', rotate: 'Draaien (R)', remove: 'Verwijderen (Del)', rename: 'Hernoemen', pdf: 'PDF downloaden', lastValues: 'Recent', page: (a: number, b: number) => `Pagina ${a} van ${b}`,
  },
}
type T = (typeof STR)['en']

type Kind = 'date' | 'time' | 'text' | 'sep' | 'input' | 'counter'
interface Block { id: string; kind: Kind; value?: string; fmt?: string; label?: string; pad?: number; when?: 'today' | 'ask' | 'fixed'; date?: string }
interface Preset { id: string; name: string; blocks: Block[]; counter: number }
interface Settings { scannerId: string; source: Source; mode: ColorMode; dpi: number; skipBlank: boolean; presets: Preset[]; presetId: string; recent: Record<string, string[]> }

const KEY = 'bulk-scanner:v1', SESSION_KEY = 'bulk-scanner:session'
const DEF_PRESET: Preset = { id: 'default', name: 'Default', counter: 1, blocks: [{ id: uid(), kind: 'date', fmt: 'dmonth' }, { id: uid(), kind: 'sep', value: '_' }, { id: uid(), kind: 'input', label: 'Description' }] }
const DEFAULTS: Settings = { scannerId: '', source: 'feeder', mode: 'color', dpi: 300, skipBlank: true, presets: [DEF_PRESET], presetId: DEF_PRESET.id, recent: {} }
const DATE_FMTS = ['dmonth', 'iso', 'dmy', 'compact', 'ym'] as const
const ICONS: Record<Kind, typeof Calendar> = { date: Calendar, time: Clock, text: Type, sep: Hash, input: TextCursorInput, counter: Hash }

// Loads settings from localStorage, migrating the single-convention format into presets
function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (raw.blocks && !raw.presets) raw.presets = [{ ...DEF_PRESET, blocks: raw.blocks, counter: raw.counter ?? 1 }]
    const s = { ...DEFAULTS, ...raw }; delete (s as Record<string, unknown>).blocks; delete (s as Record<string, unknown>).counter
    return s.presets.length ? s : { ...s, presets: [DEF_PRESET] }
  } catch { return DEFAULTS }
}
const clean = (s: string) => s.replace(/[\\/:*?"<>|\n\r\t]+/g, '-').replace(/\s+/g, ' ').trim()
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parseIso = (v?: string) => { const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null }
const asked = (b: Block) => b.kind === 'input' || (b.kind === 'date' && b.when === 'ask')
const move = <X,>(a: X[], from: number, to: number) => { const b = [...a], [x] = b.splice(from, 1); b.splice(to, 0, x); return b }

function fmtDate(d: Date, fmt: string, lang: string) {
  const p = (n: number) => String(n).padStart(2, '0'), y = d.getFullYear(), m = p(d.getMonth() + 1), day = p(d.getDate())
  return fmt === 'dmonth' ? `${d.getDate()}${d.toLocaleString(lang === 'nl' ? 'nl-BE' : 'en-GB', { month: 'long' }).toLowerCase()}` : fmt === 'iso' ? `${y}-${m}-${day}` : fmt === 'dmy' ? `${day}-${m}-${y}` : fmt === 'ym' ? `${y}-${m}` : `${y}${m}${day}`
}

// Resolves the block list into a filename (without extension); missing inputs render as their label
function buildName(blocks: Block[], values: Record<string, string>, counter: number, lang: string, at = new Date()) {
  return clean(blocks.map((b) => b.kind === 'date' ? fmtDate((b.when === 'fixed' ? parseIso(b.date) : b.when === 'ask' ? parseIso(values[b.id]) : null) ?? at, b.fmt ?? 'iso', lang) : b.kind === 'time' ? `${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}` : b.kind === 'counter' ? String(counter).padStart(b.pad ?? 3, '0') : b.kind === 'input' ? (values[b.id] ?? `[${b.label || 'Input'}]`) : b.value ?? '').join(''))
}

// Object URLs per blob, revoked together when the session changes
const urls = new Map<Blob, string>()
const urlOf = (b: Blob) => { let u = urls.get(b); if (!u) urls.set(b, u = URL.createObjectURL(b)); return u }
const revokeAll = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear() }

const docPdf = async (d: Doc) => buildPdf(await Promise.all(d.pages.map(async (p) => ({ jpeg: new Uint8Array(await p.blob.arrayBuffer()), w: p.w, h: p.h, dpi: p.dpi, rot: p.rot }))))
const uniqueNames = (docs: Doc[]) => { const seen = new Map<string, number>(); return docs.map((d) => { const base = d.name || 'scan', n = (seen.get(base) ?? 0) + 1; seen.set(base, n); return n > 1 ? `${base} (${n})` : base }) }

const btn = 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-field px-2.5 text-[13px] text-fg shadow-[0_1px_0_rgb(0_0_0/0.04)] hover:bg-hover disabled:pointer-events-none disabled:opacity-40'
const ghost = 'inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-mute hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35'
const primary = 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:brightness-110 active:brightness-95 disabled:pointer-events-none disabled:opacity-40'
const field = 'h-7 w-full rounded-md border border-line bg-field px-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/25'
const head = 'flex items-center justify-between px-3 pb-1 pt-3 text-[11px] font-semibold text-mute'
const fmtWhen = (ms: number, lang: string) => new Date(ms).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })

export function BulkScanner() {
  const t = useT(STR), { lang, setLang } = useLang(), upd = useUpdater()
  const [s, setS] = useState<Settings>(loadSettings)
  const [scanners, setScanners] = useState<Scanner[]>([]), [searching, setSearching] = useState(true), [caps, setCaps] = useState<Caps | null>(null), [ip, setIp] = useState(''), [ipOpen, setIpOpen] = useState(false)
  const [session, setSession] = useState<Session | null>(null), [sessions, setSessions] = useState<Session[]>([])
  const [scanning, setScanning] = useState(0), [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string; keep?: Page[] } | null>(null), abort = useRef<AbortController | null>(null)
  const [asking, setAsking] = useState<null | 'new' | 'saveAll'>(null), [values, setValues] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null), [selBlock, setSelBlock] = useState<string | null>(null), [renamingPreset, setRenamingPreset] = useState(false)
  const [view, setView] = useState<{ target: string; i: number } | null>(null)
  // In-app confirm: native confirm() is blocked in embedded webviews and silently returns false
  const [ask, setAsk] = useState<{ text: string; ok: () => void; danger?: boolean } | null>(null)
  const confirmThen = (text: string, ok: () => void, danger = true) => setAsk({ text, ok, danger })
  const update = useCallback((p: Partial<Settings>) => setS((prev) => ({ ...prev, ...p })), [])
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* unavailable */ } }, [s])

  // ---- session persistence (IndexedDB) ----
  const openSession = useCallback(async (id?: string) => {
    revokeAll()
    const x = (id && await getSession(id).catch(() => undefined)) || newSession()
    try { localStorage.setItem(SESSION_KEY, x.id) } catch { /* unavailable */ }
    setSession(x); setView(null); setNotice(null); setEditing(null)
  }, [])
  const refreshSessions = useCallback(() => void listSessions().then(setSessions, () => {}), [])
  useEffect(() => { let id: string | null = null; try { id = localStorage.getItem(SESSION_KEY) } catch { /* unavailable */ } const h = setTimeout(() => void openSession(id ?? undefined), 0); void navigator.storage?.persist?.(); return () => clearTimeout(h) }, [openSession])
  useEffect(() => { if (!session) return; const h = setTimeout(async () => { if (session.docs.length || session.current.length) await putSession({ ...session, updated: Date.now() }); refreshSessions() }, 400); return () => clearTimeout(h) }, [session, refreshSessions])
  const patch = useCallback((fn: (x: Session) => Partial<Session>) => setSession((x) => x && { ...x, ...fn(x) }), [])
  const setCurrent = (fn: (p: Page[]) => Page[]) => patch((x) => ({ current: fn(x.current) }))
  const setDocs = (fn: (d: Doc[]) => Doc[]) => patch((x) => ({ docs: fn(x.docs) }))
  const editPages = (target: string, fn: (p: Page[]) => Page[]) => target === 'current' ? setCurrent(fn) : setDocs((ds) => ds.map((d) => d.id === target ? { ...d, pages: fn(d.pages) } : d).filter((d) => d.pages.length))

  // ---- scanner discovery ----
  const search = useCallback(async (host?: string) => {
    setSearching(true)
    try {
      const list = await listScanners(true, host)
      setScanners((prev) => host ? [...prev.filter((p) => !list.some((l) => l.id === p.id)), ...list] : list)
      setS((p) => list.some((m) => m.id === p.scannerId) || (!host && !list.length) ? p : { ...p, scannerId: list[0]?.id ?? p.scannerId })
      if (host) { setIp(''); setIpOpen(false) }
    } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }) }
    setSearching(false)
  }, [])
  useEffect(() => { const h = setTimeout(() => void search(), 0); return () => clearTimeout(h) }, [search])
  const scanner = scanners.find((x) => x.id === s.scannerId)
  useEffect(() => { if (!scanner) return; let live = true; capabilities(scanner.id).then((c) => live && setCaps(c), () => live && setCaps(null)); return () => { live = false } }, [scanner])
  const source = caps?.sources.length && !caps.sources.includes(s.source) ? caps.sources[0] : s.source
  const dpis = caps?.resolutions.filter((r) => r >= 100 && r <= 600).length ? caps.resolutions.filter((r) => r >= 100 && r <= 600) : [150, 300, 600]
  const dpi = dpis.includes(s.dpi) ? s.dpi : dpis.reduce((b, r) => Math.abs(r - s.dpi) < Math.abs(b - s.dpi) ? r : b)

  // ---- naming ----
  const preset = s.presets.find((p) => p.id === s.presetId) ?? s.presets[0]
  const setPreset = (p: Partial<Preset>) => update({ presets: s.presets.map((x) => x.id === preset.id ? { ...x, ...p } : x) })
  const inputs = preset.blocks.filter(asked)
  const preview = buildName(preset.blocks, values, preset.counter, lang)
  const existing = useMemo(() => new Set(session?.docs.map((d) => d.name)), [session?.docs])

  async function scan() {
    if (scanning || !scanner || !session) return
    const ac = new AbortController(); abort.current = ac; setNotice(null); setScanning(1)
    try {
      const skipped = await runScan(scanner, { source, mode: s.mode, dpi, skipBlank: s.skipBlank }, (p) => setCurrent((c) => [...c, p]), (n) => setScanning(n), ac.signal)
      if (skipped.length) setNotice({ kind: 'info', text: t.skipped(skipped.length), keep: skipped })
    } catch (e) { if (!ac.signal.aborted) setNotice({ kind: 'error', text: (e as Error).message }) }
    setScanning(0); abort.current = null
  }

  // Finishing a scan asks for the input blocks, then files the pages under the resolved name
  function finish(then: 'new' | 'saveAll') {
    if (!session) return
    if (!session.current.length) return then === 'saveAll' ? void saveAll(session.docs) : undefined
    if (session.reopened || !inputs.length) return commit(then, {})
    setValues(Object.fromEntries(inputs.map((b) => [b.id, b.kind === 'date' ? iso(new Date()) : '']))); setAsking(then)
  }
  function commit(then: 'new' | 'saveAll', vals: Record<string, string>) {
    if (!session) return
    const ro = session.reopened
    if (ro) { const docs = [...session.docs]; docs.splice(Math.min(ro.index, docs.length), 0, { ...ro.doc, pages: session.current }); patch(() => ({ docs, current: [], reopened: undefined })); setNotice(null); if (then === 'saveAll') void saveAll(docs); return }
    const doc: Doc = { id: uid(), name: buildName(preset.blocks, vals, preset.counter, lang), pages: session.current, at: Date.now() }, docs = [...session.docs, doc]
    const recent = { ...s.recent }; inputs.forEach((b) => { if (b.kind !== 'input') return; const v = vals[b.id]?.trim(); if (v) recent[b.id] = [v, ...(recent[b.id] ?? []).filter((x) => x !== v)].slice(0, 6) })
    patch(() => ({ docs, current: [] })); setAsking(null); setNotice(null)
    update({ recent, presets: s.presets.map((x) => x.id === preset.id && x.blocks.some((b) => b.kind === 'counter') ? { ...x, counter: x.counter + 1 } : x) })
    if (then === 'saveAll') void saveAll(docs)
  }
  // Moves a finished file back into the current scan so more pages can be added; finishing puts it back under the same name
  const reopen = (d: Doc, index: number) => patch((x) => ({ current: d.pages, docs: x.docs.filter((y) => y.id !== d.id), reopened: { doc: d, index } }))
  const cancelReopen = () => { const ro = session?.reopened; if (!ro) return; const undo = () => patch((x) => { const docs = [...x.docs]; docs.splice(Math.min(ro.index, docs.length), 0, ro.doc); return { docs, current: [], reopened: undefined } }); if (session.current.length !== ro.doc.pages.length) confirmThen(t.discardAdded, undo); else undo() }
  async function saveAll(docs: Doc[]) {
    if (!docs.length) return
    const names = uniqueNames(docs)
    try { if (await download(buildZip(await Promise.all(docs.map(async (d, i) => ({ name: `${names[i]}.pdf`, data: new Uint8Array(await (await docPdf(d)).arrayBuffer()) })))), `scans_${fmtDate(new Date(), 'iso', lang)}.zip`)) patch(() => ({ finished: Date.now() })) } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }) }
  }
  const savePdf = async (d: Doc, name: string) => { try { await download(await docPdf(d), `${name}.pdf`) } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }) } }
  const startNew = () => session?.current.length ? confirmThen(t.newSessionConfirm, () => void openSession(), false) : void openSession()

  const keys = useRef({ scan, finish }); keys.current = { scan, finish }
  const scanningRef = useRef(0); scanningRef.current = scanning
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (asking || view || ask || (e.target as HTMLElement).closest('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key.toLowerCase(); if (k === 's') { e.preventDefault(); void keys.current.scan() } else if (k === 'n') { e.preventDefault(); keys.current.finish('new') } else if (k === 'enter' && !scanningRef.current && !(e.target as HTMLElement).closest('button,a')) { e.preventDefault(); keys.current.finish('saveAll') } }
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey)
  }, [asking, view, ask])

  const setBlock = (id: string, p: Partial<Block>) => setPreset({ blocks: preset.blocks.map((b) => b.id === id ? { ...b, ...p } : b) })
  const addBlock = (kind: Kind) => { const b: Block = { id: uid(), kind, ...(kind === 'date' ? { fmt: 'dmonth' } : kind === 'sep' ? { value: '_' } : kind === 'text' ? { value: '' } : kind === 'input' ? { label: '' } : kind === 'counter' ? { pad: 3 } : {}) }; setPreset({ blocks: [...preset.blocks, b] }); setSelBlock(b.id) }
  const addPreset = (copy: boolean) => { const p: Preset = copy ? { ...preset, id: uid(), name: t.copyOf(preset.name), blocks: preset.blocks.map((b) => ({ ...b, id: uid() })) } : { id: uid(), name: t.newPreset, counter: 1, blocks: [{ id: uid(), kind: 'date', fmt: 'iso' }, { id: uid(), kind: 'sep', value: '_' }, { id: uid(), kind: 'input', label: '' }] }; update({ presets: [...s.presets, p], presetId: p.id }); setRenamingPreset(true) }
  const sel = preset.blocks.find((b) => b.id === selBlock)
  const blockText = (b: Block) => b.kind === 'input' ? `[${b.label || t.kinds.input}]` : b.kind === 'date' && b.when === 'ask' ? `[${t.kinds.date}]` : b.kind === 'sep' ? (b.value === ' ' ? '␣' : b.value || '∅') : b.kind === 'text' ? (b.value || '…') : buildName([b], {}, preset.counter, lang)
  const viewPages = view ? (view.target === 'current' ? session?.current : session?.docs.find((d) => d.id === view.target)?.pages) ?? [] : []

  if (!session) return <div className="flex h-full items-center justify-center text-mute">{t.loading}</div>
  const total = session.docs.length + (session.current.length ? 1 : 0), names = uniqueNames(session.docs)
  const sessionRows = sessions.some((x) => x.id === session.id) ? sessions : [session, ...sessions]
  const target = session.reopened ? session.reopened.doc.name : buildName(preset.blocks, {}, preset.counter, lang)

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <div className="flex w-80 min-w-48 shrink items-center gap-1">
          <select className={field} title={t.scanner} value={s.scannerId} onChange={(e) => update({ scannerId: e.target.value })}>
            {!scanner && <option value={s.scannerId}>{searching ? t.searching : t.none}</option>}
            {scanners.map((x) => <option key={x.id} value={x.id}>{x.model && !x.demo ? x.model : x.name}{x.demo ? ` · ${x.model}` : ` (${x.host})`}</option>)}
          </select>
          <button className={ghost} title={t.refresh} onClick={() => void search()} disabled={searching}><RefreshCw className={`size-4 ${searching ? 'animate-spin' : ''}`} /></button>
          <div className="relative">
            <button className={ghost} title={t.addIp} onClick={() => setIpOpen((o) => !o)}><Plus className="size-4" /></button>
            {ipOpen && <><div className="fixed inset-0 z-30" onClick={() => setIpOpen(false)} />
              <form className="absolute left-0 top-9 z-40 w-64 rounded-lg border border-line bg-panel p-3 shadow-xl" onSubmit={(e) => { e.preventDefault(); if (ip.trim()) void search(ip.trim()) }}>
                <p className="mb-2 font-medium">{t.addIp}</p>
                <div className="flex gap-1.5"><input autoFocus className={field} placeholder={t.ipPh} value={ip} onChange={(e) => setIp(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setIpOpen(false)} /><button className={primary} disabled={!ip.trim() || searching}>{t.add}</button></div>
              </form></>}
          </div>
        </div>
        <Divider />
        <Seg value={source} onChange={(v) => update({ source: v })} opts={(['flatbed', 'feeder', 'duplex'] as Source[]).map((v) => [v, t[v], !!caps && !caps.sources.includes(v)])} />
        <Seg value={s.mode} onChange={(v) => update({ mode: v })} opts={[['color', t.mode.color], ['gray', t.mode.gray], ['bw', t.mode.bw]]} />
        <select className={field.replace('w-full', 'w-24 shrink-0')} title={t.dpi} value={dpi} onChange={(e) => update({ dpi: +e.target.value })}>{dpis.map((d) => <option key={d} value={d}>{d} dpi</option>)}</select>
        <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-1"><input type="checkbox" className="size-3.5 accent-[var(--accent)]" checked={s.skipBlank} onChange={(e) => update({ skipBlank: e.target.checked })} />{t.skipBlank}</label>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar: sessions + files */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-side">
          <div className={head}>{t.sessions}<button className={ghost + ' h-6 min-w-6'} title={t.newSession} disabled={!total || !!scanning} onClick={startNew}><Plus className="size-3.5" /></button></div>
          <div className="max-h-44 shrink-0 overflow-y-auto px-1.5">
            {sessionRows.map((x) => { const active = x.id === session.id, docs = active ? session.docs.length : x.docs.length; return (
              <div key={x.id} className={`group flex h-8 items-center gap-2 rounded-md px-2 ${active ? 'bg-sel' : 'hover:bg-hover'}`} onClick={() => !active && !scanning && void openSession(x.id)}>
                <FolderOpen className={`size-3.5 shrink-0 ${active ? 'text-accent' : 'text-mute'}`} />
                <span className="min-w-0 flex-1 truncate">{fmtWhen(x.created, lang)}</span>
                <span className="text-[11px] text-mute group-hover:hidden">{docs}{(active ? session.finished : x.finished) ? ' ✓' : ''}</span>
                <button className="hidden text-mute hover:text-red-500 group-hover:block" title={t.delete} onClick={(e) => { e.stopPropagation(); confirmThen(t.delSessionConfirm, async () => { await deleteSession(x.id); if (active) await openSession(); refreshSessions() }) }}><Trash2 className="size-3.5" /></button>
              </div>) })}
          </div>
          <div className={head + ' mt-1 border-t border-line'}>{t.session}<span className="font-normal">{session.docs.length}</span></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {!session.docs.length ? <p className="px-2 py-2 leading-5 text-mute">{t.noDocs}</p> : (
              <Sortable items={session.docs} onMove={(a, b) => setDocs((d) => move(d, a, b))} render={(d, i) => (
                <div className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover" onDoubleClick={() => setView({ target: d.id, i: 0 })}>
                  <img src={urlOf(d.pages[0].thumb)} alt="" draggable={false} className="h-10 w-[30px] shrink-0 rounded-sm border border-line bg-white object-cover" style={{ transform: `rotate(${d.pages[0].rot}deg)` }} onClick={() => setView({ target: d.id, i: 0 })} />
                  <div className="min-w-0 flex-1">
                    {editing === d.id ? <input autoFocus className={field + ' h-6'} defaultValue={d.name} onFocus={(e) => e.target.select()} onBlur={(e) => { const v = clean(e.target.value); setDocs((x) => x.map((y) => y.id === d.id ? { ...y, name: v || y.name } : y)); setEditing(null) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }} />
                      : <p className="truncate" title={`${names[i]}.pdf`}>{names[i]}.pdf</p>}
                    <p className="text-[11px] text-mute">{t.pages(d.pages.length)} · {new Date(d.at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="hidden shrink-0 group-hover:flex" onDoubleClick={(e) => e.stopPropagation()}>
                    <button className={ghost + ' h-6 min-w-6'} title={session.current.length ? t.addPagesBusy : t.addPages} disabled={!!session.current.length || !!scanning} onClick={() => reopen(d, i)}><FilePlus2 className="size-3.5" /></button>
                    <button className={ghost + ' h-6 min-w-6'} title={t.rename} onClick={() => setEditing(d.id)}><Pencil className="size-3.5" /></button>
                    <button className={ghost + ' h-6 min-w-6'} title={t.pdf} onClick={() => void savePdf(d, names[i])}><FileDown className="size-3.5" /></button>
                    <button className={ghost + ' h-6 min-w-6 hover:!text-red-500'} title={t.delete} onClick={() => setDocs((x) => x.filter((y) => y.id !== d.id))}><Trash2 className="size-3.5" /></button>
                  </div>
                </div>)} />
            )}
          </div>
          <div className="border-t border-line p-2.5"><button className={primary + ' h-8 w-full justify-center'} disabled={!total || !!scanning} onClick={() => finish('saveAll')}><FileArchive className="size-4" />{t.saveAll(total)}</button></div>
        </aside>

        {/* Canvas: current scan */}
        <main className="flex min-w-0 flex-1 flex-col bg-app">
          <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
            <div className="min-w-0 flex-1 truncate"><span className="font-semibold">{session.reopened ? t.addingTo : t.current}</span>
              <span className="ml-2 text-mute">{session.reopened ? `${session.reopened.doc.name}.pdf · ` : ''}{t.pages(session.current.length)}</span></div>
            {session.reopened && <button className={btn} onClick={cancelReopen}>{t.cancel}</button>}
            {scanning ? <button className={primary} onClick={() => abort.current?.abort()}><Loader2 className="size-4 animate-spin" />{t.scanning(scanning)}<Square className="size-3 fill-current" /></button>
              : <button className={primary} disabled={!scanner} title="S" onClick={() => void scan()}><ScanLine className="size-4" />{t.scan}</button>}
            <button className={btn} title="N" disabled={!session.current.length || !!scanning} onClick={() => finish('new')}>{session.reopened ? <FilePlus2 className="size-4" /> : <Plus className="size-4" />}{session.reopened ? t.doneAdding : t.newScan}</button>
          </div>
          {notice && <div className={`flex shrink-0 items-center gap-2 border-b px-4 py-2 ${notice.kind === 'error' ? 'border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-300' : 'border-line bg-sel'}`}>
            <span className="min-w-0 flex-1">{notice.text}</span>
            {notice.keep && <button className={btn + ' h-6'} onClick={() => { const k = notice.keep!; setCurrent((c) => [...c, ...k]); setNotice(null) }}>{t.keep}</button>}
            <button className={ghost + ' h-6 min-w-6'} onClick={() => setNotice(null)}><X className="size-3.5" /></button>
          </div>}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {session.current.length ? (
              <Sortable className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4" items={session.current} onMove={(a, b) => setCurrent((c) => move(c, a, b))}
                render={(p, i) => <Thumb page={p} n={i + 1} t={t} onOpen={() => setView({ target: 'current', i })} onRotate={() => editPages('current', (c) => c.map((x) => x.id === p.id ? { ...x, rot: (x.rot + 90) % 360 } : x))} onRemove={() => editPages('current', (c) => c.filter((x) => x.id !== p.id))} />}
                tail={!!scanning && <div className="flex aspect-[1/1.414] items-center justify-center rounded-md border border-dashed border-accent/50 text-accent"><Loader2 className="size-6 animate-spin" /></div>} />
            ) : <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-mute">
              {scanning ? <Loader2 className="size-8 animate-spin text-accent" /> : <Printer className="size-10 opacity-50" strokeWidth={1.25} />}
              <p className="max-w-xs leading-5">{scanning ? t.scanning(scanning) : t.empty}</p>
              {!scanning && scanner && <button className={primary} onClick={() => void scan()}><ScanLine className="size-4" />{t.scan}</button>}
            </div>}
          </div>
        </main>

        {/* Inspector: naming convention */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-line bg-panel">
          <div className={head + ' pt-3.5'}>{t.naming}</div>
          <div className="space-y-3 px-3 pb-4">
            <div className="flex gap-1">
              {renamingPreset ? <input autoFocus className={field} aria-label={t.presetName} defaultValue={preset.name} onFocus={(e) => e.target.select()} onBlur={(e) => { setPreset({ name: e.target.value.trim() || preset.name }); setRenamingPreset(false) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                : <select className={field} aria-label={t.preset} value={preset.id} onChange={(e) => { update({ presetId: e.target.value }); setSelBlock(null) }}>{s.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
              <button className={ghost} title={t.rename} onClick={() => setRenamingPreset(true)}><Pencil className="size-3.5" /></button>
              <button className={ghost} title={t.dupPreset} onClick={() => addPreset(true)}><Copy className="size-3.5" /></button>
              <button className={ghost} title={t.newPreset} onClick={() => addPreset(false)}><Plus className="size-3.5" /></button>
              <button className={ghost + ' hover:!text-red-500'} title={t.delPreset} disabled={s.presets.length < 2} onClick={() => confirmThen(t.delPresetConfirm, () => update({ presets: s.presets.filter((p) => p.id !== preset.id), presetId: s.presets.find((p) => p.id !== preset.id)!.id }))}><Trash2 className="size-3.5" /></button>
            </div>
            <Sortable className="flex min-h-11 flex-wrap items-center gap-1 rounded-md border border-line bg-field p-1.5" items={preset.blocks} onMove={(a, b) => setPreset({ blocks: move(preset.blocks, a, b) })} render={(b) => { const I = ICONS[b.kind]; return (
              <button onClick={() => setSelBlock(b.id === selBlock ? null : b.id)} className={`inline-flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-[12px] ${b.id === selBlock ? 'border-accent bg-sel text-accent' : asked(b) ? 'border-ask/40 bg-ask/10 text-ask' : b.kind === 'sep' ? 'border-line bg-hover text-mute' : 'border-line bg-panel text-fg'}`}>
                {b.kind !== 'sep' && <I className="size-3" />}{blockText(b)}
              </button>) }} />
            <p className="break-all leading-5 text-mute">{t.preview}: <span className="font-mono text-[12px] text-fg">{buildName(preset.blocks, {}, preset.counter, lang)}.pdf</span></p>

            {sel && (
              <div className="space-y-2.5 rounded-md border border-line bg-app p-2.5">
                <div className="flex items-center justify-between font-semibold">{t.kinds[sel.kind]}
                  <div className="flex">
                    {[-1, 1].map((d) => <button key={d} className={ghost + ' h-6 min-w-6'} onClick={() => { const i = preset.blocks.indexOf(sel), j = i + d; if (j >= 0 && j < preset.blocks.length) setPreset({ blocks: move(preset.blocks, i, j) }) }}>{d < 0 ? <ArrowLeft className="size-3.5" /> : <ArrowRight className="size-3.5" />}</button>)}
                    <button className={ghost + ' h-6 min-w-6 hover:!text-red-500'} title={t.delete} onClick={() => { setPreset({ blocks: preset.blocks.filter((b) => b.id !== sel.id) }); setSelBlock(null) }}><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
                {sel.kind === 'date' && <>
                  <label className="block text-mute">{t.fmt}<select className={field + ' mt-1'} value={sel.fmt} onChange={(e) => setBlock(sel.id, { fmt: e.target.value })}>{DATE_FMTS.map((f) => <option key={f} value={f}>{fmtDate(new Date(), f, lang)}</option>)}</select></label>
                  <div className="text-mute">{t.whichDate}<div className="mt-1"><Seg full value={sel.when ?? 'today'} onChange={(w) => setBlock(sel.id, { when: w, date: w === 'fixed' ? sel.date ?? iso(new Date(Date.now() - 864e5)) : sel.date })} opts={(['today', 'ask', 'fixed'] as const).map((w) => [w, t.when[w]])} /></div></div>
                  {sel.when === 'fixed' && <input type="date" className={field} value={sel.date ?? ''} onChange={(e) => setBlock(sel.id, { date: e.target.value })} />}
                  {sel.when === 'ask' && <span className="block text-[12px] text-mute">{t.ask}</span>}
                </>}
                {sel.kind === 'sep' && <Seg full value={sel.value ?? ''} onChange={(v) => setBlock(sel.id, { value: v })} opts={['_', '-', ' ', '.', ''].map((v) => [v, v === ' ' ? '␣' : v || '∅'])} mono />}
                {sel.kind === 'text' && <label className="block text-mute">{t.textVal}<input autoFocus className={field + ' mt-1'} value={sel.value ?? ''} onChange={(e) => setBlock(sel.id, { value: e.target.value })} /></label>}
                {sel.kind === 'input' && <label className="block text-mute">{t.label}<input autoFocus className={field + ' mt-1'} value={sel.label ?? ''} placeholder="Description, Client, Invoice nr…" onChange={(e) => setBlock(sel.id, { label: e.target.value })} /><span className="mt-1 block text-[12px]">{t.ask}</span></label>}
                {sel.kind === 'counter' && <div className="grid grid-cols-2 gap-2">
                  <label className="text-mute">{t.start}<input type="number" min={0} className={field + ' mt-1'} value={preset.counter} onChange={(e) => setPreset({ counter: Math.max(0, +e.target.value) })} /></label>
                  <label className="text-mute">{t.pad}<input type="number" min={1} max={6} className={field + ' mt-1'} value={sel.pad ?? 3} onChange={(e) => setBlock(sel.id, { pad: Math.min(6, Math.max(1, +e.target.value)) })} /></label>
                </div>}
              </div>
            )}
          </div>
          <div className={head + ' border-t border-line'}>{t.addBlock}</div>
          <div className="grid grid-cols-2 gap-1 px-3 pb-4">
            {(Object.keys(ICONS) as Kind[]).map((k) => { const I = ICONS[k]; return <button key={k} className={btn + ' justify-start'} onClick={() => addBlock(k)}><I className="size-3.5 text-mute" />{t.kinds[k]}</button> })}
          </div>
        </aside>
      </div>

      {/* Status bar */}
      <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-side px-3 text-[12px] text-mute">
        <span className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${searching ? 'animate-pulse bg-amber-400' : scanners.length ? 'bg-emerald-500' : 'bg-red-500'}`} />{searching ? t.searching : t.online(scanners.length)}</span>
        {!native && <span className="shrink-0 text-ask">{t.browserOnly}</span>}
        <span className="min-w-0 flex-1 truncate">{t.namePreview} <span className="font-mono text-fg">{target}.pdf</span></span>
        <span className="flex shrink-0 items-center gap-1.5"><Keyboard className="size-3.5" />{session.current.length > 1 ? t.dragHint : t.shortcuts}</span>
        {upd.state.kind === 'ready' && <button className="flex shrink-0 items-center gap-1 rounded bg-accent px-2 font-medium text-white hover:brightness-110 disabled:opacity-40" title={t.updateHint} disabled={!!scanning} onClick={() => void upd.install()}><Download className="size-3.5" />{t.update(upd.state.update.version)}</button>}
        {upd.state.kind === 'installing' && <span className="flex shrink-0 items-center gap-1 text-accent"><Loader2 className="size-3.5 animate-spin" />{t.updating}{upd.state.pct !== null && ` ${upd.state.pct}%`}</span>}
        {upd.state.kind === 'error' && <button className="shrink-0 text-red-500" title={upd.state.text} onClick={upd.dismiss}>{t.updateFail}</button>}
        {upd.version && <span className="shrink-0">v{upd.version}</span>}
        <span className="flex shrink-0 overflow-hidden rounded border border-line">{(['en', 'nl'] as const).map((l) => <button key={l} className={`px-1.5 uppercase ${lang === l ? 'bg-sel text-fg' : 'hover:text-fg'}`} onClick={() => setLang(l)}>{l}</button>)}</span>
      </footer>

      {ask && <Dialog onClose={() => setAsk(null)} onSubmit={() => { ask.ok(); setAsk(null) }} width="max-w-sm">
        <p className="leading-5">{ask.text}</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" className={btn} onClick={() => setAsk(null)}>{t.cancel}</button><button autoFocus className={ask.danger ? primary + ' !bg-red-600' : primary}>{ask.danger ? t.delete : t.ok}</button></div>
      </Dialog>}

      {view && viewPages.length > 0 && <QuickView t={t} pages={viewPages} i={Math.min(view.i, viewPages.length - 1)} onIndex={(i) => setView({ ...view, i })} onClose={() => setView(null)}
        onRotate={(id) => editPages(view.target, (ps) => ps.map((x) => x.id === id ? { ...x, rot: (x.rot + 90) % 360 } : x))}
        onRemove={(id) => { if (viewPages.length === 1) setView(null); editPages(view.target, (ps) => ps.filter((x) => x.id !== id)) }} />}

      {/* Input-on-save dialog */}
      {asking && <Dialog onClose={() => setAsking(null)} onSubmit={() => commit(asking, Object.fromEntries(inputs.map((b) => [b.id, b.kind === 'date' ? values[b.id] ?? '' : clean(values[b.id] ?? '')])))} width="max-w-md">
        <div className="flex items-start justify-between"><div><h2 className="text-[15px] font-semibold">{t.dialogTitle}</h2><p className="text-mute">{t.pages(session.current.length)} · {preset.name}</p></div><button type="button" className={ghost} onClick={() => setAsking(null)}><X className="size-4" /></button></div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{session.current.slice(0, 6).map((p) => <img key={p.id} src={urlOf(p.thumb)} alt="" className="h-20 rounded-sm border border-line bg-white" style={{ transform: `rotate(${p.rot}deg)` }} />)}</div>
        <div className="mt-3 space-y-3">
          {inputs.map((b, i) => b.kind === 'date' ? (
            <div key={b.id}>{t.kinds.date}
              <div className="mt-1 flex gap-1.5"><input type="date" autoFocus={i === 0} className={field + ' h-8'} value={values[b.id] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [b.id]: e.target.value }))} />
                {[[0, t.today], [1, t.yesterday]].map(([d, l]) => <button type="button" key={d} className={`${btn} h-8 ${values[b.id] === iso(new Date(Date.now() - +d * 864e5)) ? '!border-accent bg-sel' : ''}`} onClick={() => setValues((v) => ({ ...v, [b.id]: iso(new Date(Date.now() - +d * 864e5)) }))}>{l}</button>)}</div>
            </div>
          ) : (
            <label key={b.id} className="block">{b.label || t.kinds.input}
              <input autoFocus={i === 0} className={field + ' mt-1 h-8'} value={values[b.id] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [b.id]: e.target.value }))} />
              {!!s.recent[b.id]?.length && <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[12px] text-mute">{t.lastValues}:{s.recent[b.id].map((r) => <button type="button" key={r} className="rounded bg-hover px-1.5 py-0.5 text-fg hover:bg-sel" onClick={() => setValues((v) => ({ ...v, [b.id]: r }))}>{r}</button>)}</div>}
            </label>
          ))}
        </div>
        <p className="mt-4 break-all rounded-md bg-app px-2.5 py-2 font-mono text-[12px]">{preview}.pdf</p>
        {existing.has(preview) && <p className="mt-2 text-[12px] text-ask">{t.dup}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" className={btn} onClick={() => setAsking(null)}>{t.cancel}</button><button className={primary}>{t.save}</button></div>
      </Dialog>}
    </div>
  )
}

const Divider = () => <div className="mx-1 h-5 w-px shrink-0 bg-line" />

// Modal sheet; Esc or clicking outside closes, Enter submits
function Dialog({ children, onClose, onSubmit, width }: { children: React.ReactNode; onClose: () => void; onSubmit: () => void; width: string }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onMouseDown={onClose}>
      <form className={`w-full ${width} rounded-lg border border-line bg-panel p-5 shadow-2xl`} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()} onSubmit={(e) => { e.preventDefault(); onSubmit() }}>{children}</form>
    </div>, document.body)
}

function Seg<V extends string>({ value, opts, onChange, full, mono }: { value: V; opts: [V, string, boolean?][]; onChange: (v: V) => void; full?: boolean; mono?: boolean }) {
  return <div className={`flex h-7 shrink-0 rounded-md border border-line bg-hover p-0.5 ${full ? 'w-full' : ''}`}>{opts.map(([v, l, off]) => <button key={v} type="button" disabled={off} onClick={() => onChange(v)} className={`whitespace-nowrap rounded-[5px] px-2.5 text-[12px] disabled:opacity-30 ${full ? 'flex-1' : ''} ${mono ? 'font-mono' : ''} ${v === value ? 'bg-field font-medium text-fg shadow-sm' : 'text-mute hover:text-fg'}`}>{l}</button>)}</div>
}

// Generic HTML5 drag-and-drop list: drag any item onto another to move it there
function Sortable<X extends { id: string }>({ items, render, onMove, className, tail }: { items: X[]; render: (x: X, i: number) => React.ReactNode; onMove: (from: number, to: number) => void; className?: string; tail?: React.ReactNode }) {
  const [drag, setDrag] = useState<number | null>(null), [over, setOver] = useState<number | null>(null)
  return (
    <div className={className}>
      {items.map((x, i) => (
        <div key={x.id} draggable onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.id) }} onDragEnd={() => { setDrag(null); setOver(null) }}
          onDragOver={(e) => { if (drag === null) return; e.preventDefault(); setOver(i) }} onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) onMove(drag, i); setDrag(null); setOver(null) }}
          className={`rounded-md ${drag === i ? 'opacity-40' : ''} ${over === i && drag !== i ? 'outline-2 outline-offset-1 outline-accent' : ''}`}>
          {render(x, i)}
        </div>
      ))}
      {tail}
    </div>
  )
}

function Thumb({ page, n, t, onOpen, onRotate, onRemove }: { page: Page; n: number; t: T; onOpen: () => void; onRotate: () => void; onRemove: () => void }) {
  const b = 'rounded bg-black/60 p-1 text-white hover:bg-black/80'
  return (
    <div className="group">
      <div className="relative flex aspect-[1/1.414] items-center justify-center overflow-hidden rounded-md border border-line bg-white shadow-sm group-hover:border-accent" onClick={onOpen}>
        <img src={urlOf(page.thumb)} alt="" draggable={false} className="max-h-full max-w-full" style={{ transform: `rotate(${page.rot}deg) scale(${page.rot % 180 ? 0.707 : 1})` }} />
        <div className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button className={b} title={t.rotate} onClick={onRotate}><RotateCw className="size-3.5" /></button>
          <button className={b + ' hover:!bg-red-600'} title={t.remove} onClick={onRemove}><Trash2 className="size-3.5" /></button>
        </div>
      </div>
      <p className="mt-1.5 text-center text-[12px] text-mute">{n}</p>
    </div>
  )
}

// Full-size page viewer: ←/→ browse, R rotates, Delete removes, Esc closes
function QuickView({ t, pages, i, onIndex, onClose, onRotate, onRemove }: { t: T; pages: Page[]; i: number; onIndex: (i: number) => void; onClose: () => void; onRotate: (id: string) => void; onRemove: (id: string) => void }) {
  const p = pages[i], go = useCallback((d: number) => onIndex(Math.max(0, Math.min(pages.length - 1, i + d))), [i, pages.length, onIndex])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { const m: Record<string, () => void> = { Escape: onClose, ArrowLeft: () => go(-1), ArrowRight: () => go(1), r: () => onRotate(p.id), R: () => onRotate(p.id), Delete: () => onRemove(p.id) }; if (m[e.key]) { e.preventDefault(); m[e.key]() } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [go, onClose, onRotate, onRemove, p.id])
  const side = p.rot % 180 !== 0, vb = 'rounded-md p-1.5 text-neutral-300 hover:bg-white/10 hover:text-white'
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-900/95 text-neutral-200" onClick={onClose}>
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4" onClick={(e) => e.stopPropagation()}>
        <span>{t.page(i + 1, pages.length)} <span className="text-neutral-500">· {p.w}×{p.h} · {p.dpi} dpi</span></span>
        <div className="flex gap-1">
          <button className={vb} title={t.rotate} onClick={() => onRotate(p.id)}><RotateCw className="size-4" /></button>
          <button className={vb + ' hover:!text-red-400'} title={t.remove} onClick={() => onRemove(p.id)}><Trash2 className="size-4" /></button>
          <button className={vb} onClick={onClose}><X className="size-4" /></button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-6">
        <img src={urlOf(p.blob)} alt="" onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full bg-white object-contain shadow-2xl" style={{ transform: `rotate(${p.rot}deg)`, maxHeight: side ? '80vw' : undefined, maxWidth: side ? 'calc(100vh - 9rem)' : undefined }} />
        {i > 0 && <button className="absolute left-4 rounded-full bg-black/50 p-2 hover:bg-black/70" onClick={(e) => { e.stopPropagation(); go(-1) }}><ChevronLeft className="size-6" /></button>}
        {i < pages.length - 1 && <button className="absolute right-4 rounded-full bg-black/50 p-2 hover:bg-black/70" onClick={(e) => { e.stopPropagation(); go(1) }}><ChevronRight className="size-6" /></button>}
      </div>
      <div className="flex shrink-0 justify-center gap-2 overflow-x-auto border-t border-white/10 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
        {pages.map((x, j) => <button key={x.id} onClick={() => onIndex(j)} className={`h-14 shrink-0 overflow-hidden rounded-sm border-2 bg-white ${j === i ? 'border-accent' : 'border-transparent opacity-60 hover:opacity-100'}`}><img src={urlOf(x.thumb)} alt="" className="h-full" style={{ transform: `rotate(${x.rot}deg)` }} /></button>)}
      </div>
    </div>, document.body
  )
}
