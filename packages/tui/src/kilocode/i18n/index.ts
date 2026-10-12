import { createEffect, createSignal } from "solid-js"
import { dict as zh } from "./dict/zh"
import { dict as zht } from "./dict/zht"

export type Locale = "en" | "zh" | "zht"
export type Preference = Locale | "auto"

export const LOCALES: readonly Locale[] = ["en", "zh", "zht"]

const LABELS: Record<Locale, string> = {
  en: "English",
  zh: "简体中文",
  zht: "繁體中文",
}

const DICTS: Record<Locale, Record<string, string>> = { en: {}, zh, zht }

type Params = Record<string, string | number | boolean | undefined>

export function label(locale: Locale) {
  return LABELS[locale]
}

export function normalizeLocale(value: string): Locale | undefined {
  return LOCALES.includes(value as Locale) ? (value as Locale) : undefined
}

export function detectSystemLocale(): Locale {
  const env = process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG ?? ""
  const tag = env.split(".")[0]?.replace(/_/g, "-") || Intl.DateTimeFormat().resolvedOptions().locale
  return matchLocale(tag)
}

export function matchLocale(tag: string): Locale {
  const lower = tag.toLowerCase()
  if (lower.startsWith("zht")) return "zht"
  if (lower.startsWith("zh")) return /(^|-)(hant|tw|hk|mo)(-|$)/.test(lower) ? "zht" : "zh"
  if (lower.startsWith("en")) return "en"
  return "en"
}

const [preference, setPreference] = createSignal<Preference>("auto")
const [system, setSystem] = createSignal<Locale>(detectSystemLocale())

let persist: ((next: Preference) => void) | undefined

export function currentLocale(): Locale {
  const pref = preference()
  return pref === "auto" ? system() : pref
}

export function currentPreference(): Preference {
  return preference()
}

export function setLanguage(next: Preference) {
  setPreference(next)
  persist?.(next)
}

export function setSystemLocale(next: string) {
  setSystem(matchLocale(next))
}

export function initI18n(kv: {
  readonly ready: boolean
  get(key: string): unknown
  set(key: string, value: unknown): void
}) {
  // The KV store populates asynchronously from disk; wait for readiness before
  // reading the persisted preference so a saved language survives restarts.
  createEffect(() => {
    if (!kv.ready) return
    const stored = kv.get("locale")
    if (typeof stored === "string") {
      const value = stored === "auto" ? "auto" : normalizeLocale(stored)
      if (value) setPreference(value)
    }
  })
  persist = (next) => kv.set("locale", next)
}

function interpolate(raw: string, params: Params | undefined) {
  if (!params) return raw
  return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = params[key]
    return value === undefined ? "" : String(value)
  })
}

export function t(key: string, params?: Params): string {
  const locale = currentLocale()
  const raw = locale === "en" ? key : (DICTS[locale][key] ?? key)
  return interpolate(raw, params)
}
