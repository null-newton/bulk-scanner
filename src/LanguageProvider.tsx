import { useState, type ReactNode } from 'react'
import { detectLang, LANG_STORAGE_KEY, LanguageContext, LOCALES, type Lang } from './i18n'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(detectLang)
  const setLang = (l: Lang) => { set(l); try { localStorage.setItem(LANG_STORAGE_KEY, l) } catch { /* unavailable */ } document.documentElement.lang = l }
  return <LanguageContext.Provider value={{ lang, locale: LOCALES[lang], setLang }}>{children}</LanguageContext.Provider>
}
