import { createContext, useContext } from 'react'

export type Lang = 'en' | 'nl'

export const LANG_STORAGE_KEY = 'bulk-scanner:lang'
export const LOCALES: Record<Lang, string> = { en: 'en-US', nl: 'nl-BE' }

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY)
    if (saved === 'en' || saved === 'nl') return saved
  } catch {
    /* localStorage unavailable — fall through to navigator */
  }
  const nav =
    typeof navigator !== 'undefined' ? navigator.language || navigator.languages?.[0] || '' : ''
  return nav.toLowerCase().startsWith('nl') ? 'nl' : 'en'
}

export interface LanguageContextValue {
  lang: Lang
    locale: string
  setLang: (l: Lang) => void
}

export const LanguageContext = createContext<LanguageContextValue | null>(null)

export function useLang(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLang must be used within a LanguageProvider')
  return ctx
}

export function useT<T>(dict: { en: T; nl: T }): T {
  const { lang } = useLang()
  return dict[lang]
}
