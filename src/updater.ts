// Checks GitHub releases for a newer signed build (release builds only) and installs it on request
import { useCallback, useEffect, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export type UpdateState = { kind: 'idle' } | { kind: 'ready'; update: Update } | { kind: 'installing'; pct: number | null } | { kind: 'error'; text: string }

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' }), [version, setVersion] = useState('')
  useEffect(() => { void getVersion().then(setVersion, () => {}) }, [])
  useEffect(() => {
    if (import.meta.env.DEV) return
    const run = () => void check().then((u) => u && setState((s) => s.kind === 'installing' ? s : { kind: 'ready', update: u }), () => {})
    const first = setTimeout(run, 3000), every = setInterval(run, 6 * 3600e3)
    return () => { clearTimeout(first); clearInterval(every) }
  }, [])
  const install = useCallback(async () => {
    if (state.kind !== 'ready') return
    let total = 0, got = 0
    setState({ kind: 'installing', pct: null })
    try {
      await state.update.downloadAndInstall((e) => { if (e.event === 'Started') total = e.data.contentLength ?? 0; else if (e.event === 'Progress') { got += e.data.chunkLength; setState({ kind: 'installing', pct: total ? Math.round(got / total * 100) : null }) } })
      await relaunch()
    } catch (e) { setState({ kind: 'error', text: String((e as Error)?.message ?? e) }) }
  }, [state])
  return { state, version, install, dismiss: () => setState({ kind: 'idle' }) }
}
