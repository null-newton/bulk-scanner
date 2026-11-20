import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LanguageProvider } from './LanguageProvider'
import { BulkScanner } from './BulkScanner'

// Desktop feel: no browser context menu outside text fields in release builds
if (!import.meta.env.DEV) addEventListener('contextmenu', (e) => { if (!(e.target as HTMLElement).closest('input,textarea')) e.preventDefault() })

createRoot(document.getElementById('root')!).render(<StrictMode><LanguageProvider><BulkScanner /></LanguageProvider></StrictMode>)
