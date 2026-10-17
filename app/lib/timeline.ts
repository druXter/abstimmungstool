// app/lib/timeline.ts
//
// Zeitplan in der Sitzung (Idee L7, docs/KONZEPT-SITZUNG.md Abschnitt 6): Die Tagesordnung kommt aus dem Zeitplan-Tool,
// gesteuert wird sie dort. Zwei Links pro Sitzung, beide nur auf ZEITPLAN_BASE_URL:
//
// - Gästeansicht bzw. Tafel-Link (`<Zeitplan>/<slug>` oder `<Zeitplan>/<slug>/tafel?k=…`): Mitgliederansicht und
//   Tafel zeigen daraus die Tagesordnung. Gelesen wird über den öffentlichen Polling-Endpunkt des Zeitplans
//   (`/api/view/<slug>?k=…`) - dieselben Daten, die jeder mit dem Link sieht, kein Secret, nichts gespeichert.
// - Live-Steuerung (`<Zeitplan>/admin/events/<id>/live`): die Sitzungsleitung bedient sie eingebettet. Der Zeitplan
//   erlaubt das nur für Seiten aus seinem LIVE_EMBED_ORIGINS und nur mit Anmeldung dort.
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/
const KEY = /^[A-Za-z0-9_-]{8,200}$/
const ID = /^[A-Za-z0-9_-]{1,100}$/

export function zeitplanOrigin(): string | null {
  const url = process.env.ZEITPLAN_BASE_URL
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Fehler beim Eintragen eines Links (Code für die Meldung in der Sitzungsleitung). */
export type TimelineLinkError = 'zeitplan-aus' | 'zeitplan-link' | 'zeitplan-live'
type Parsed = { value: string | null } | { error: TimelineLinkError }

function parseOnOrigin(input: string, error: TimelineLinkError): URL | null | { error: TimelineLinkError } {
  const value = input.trim()
  if (!value) return null
  const origin = zeitplanOrigin()
  if (!origin) return { error: 'zeitplan-aus' }
  try {
    const url = new URL(value)
    return url.origin === origin ? url : { error }
  } catch {
    return { error }
  }
}

/** Gästeansicht bzw. Tafel-Link → `<Zeitplan>/<slug>` mit dem Tafel-Schlüssel, falls angegeben. Leer = keiner. */
export function parseTimelineUrl(input: string): Parsed {
  const url = parseOnOrigin(input, 'zeitplan-link')
  if (!(url instanceof URL)) return url ?? { value: null }
  const [slug, rest, ...more] = url.pathname.split('/').filter(Boolean)
  const key = url.searchParams.get('k')
  if (!slug || !SLUG.test(slug) || more.length > 0 || (rest && rest !== 'tafel') || (key !== null && !KEY.test(key))) return { error: 'zeitplan-link' }
  return { value: `${url.origin}/${slug}${key ? `?k=${encodeURIComponent(key)}` : ''}` }
}

/** Live-Steuerung → `<Zeitplan>/admin/events/<id>/live`. Leer = keine. */
export function parseTimelineLiveUrl(input: string): Parsed {
  const url = parseOnOrigin(input, 'zeitplan-live')
  if (!(url instanceof URL)) return url ?? { value: null }
  const match = url.pathname.match(/^\/admin\/events\/([^/]+)\/live\/?$/)
  if (!match || !ID.test(match[1])) return { error: 'zeitplan-live' }
  return { value: `${url.origin}/admin/events/${match[1]}/live` }
}

/** Gilt ein gespeicherter Link noch für die aktuelle Einrichtung? (ZEITPLAN_BASE_URL kann sich ändern.) */
export function onTimelineOrigin(url: string | null): string | null {
  const origin = zeitplanOrigin()
  if (!url || !origin) return null
  try {
    return new URL(url).origin === origin ? url : null
  } catch {
    return null
  }
}

export type AgendaItem = { id: string; title: string; status: 'upcoming' | 'now' | 'past' | 'cancelled'; start: string; approximate: boolean; delayMin: number | null }
export type Agenda = { title: string; timezone: string; announcement: string | null; items: AgendaItem[] }

const STATUS = new Set(['upcoming', 'now', 'past', 'cancelled'])
const CACHE_MS = 5000
const MAX_ITEMS = 200
const cache = new Map<string, { at: number; agenda: Agenda | null }>()

/**
 * Tagesordnung aus dem Zeitplan (öffentlicher Polling-Endpunkt `/api/view/<slug>`, mit Tafel-Schlüssel, falls im Link).
 * Nur die Felder, die hier gebraucht werden, jedes geprüft. 5 Sekunden zwischengespeichert (Mitglieder und Tafel
 * laden alle paar Sekunden neu). null, wenn nicht eingerichtet, nicht erreichbar oder nicht freigegeben.
 */
export async function fetchAgenda(timelineUrl: string | null): Promise<Agenda | null> {
  const link = onTimelineOrigin(timelineUrl)
  if (!link) return null
  const hit = cache.get(link)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.agenda

  let agenda: Agenda | null = null
  try {
    const url = new URL(link)
    const slug = url.pathname.split('/').filter(Boolean)[0]
    const key = url.searchParams.get('k')
    const response = await fetch(`${url.origin}/api/view/${encodeURIComponent(slug)}${key ? `?k=${encodeURIComponent(key)}` : ''}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000), cache: 'no-store', redirect: 'error'
    })
    if (response.ok) agenda = parseAgenda(await response.json())
  } catch {
    // bleibt null
  }
  cache.set(link, { at: Date.now(), agenda })
  return agenda
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null
}

function parseAgenda(payload: unknown): Agenda | null {
  if (!payload || typeof payload !== 'object') return null
  const { event, items, announcement } = payload as Record<string, unknown>
  if (!event || typeof event !== 'object' || !Array.isArray(items)) return null
  const title = text((event as Record<string, unknown>).title, 200)
  const timezone = text((event as Record<string, unknown>).timezone, 60)
  if (title === null || !timezone) return null
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: timezone })
  } catch {
    return null
  }
  const parsed: AgendaItem[] = []
  for (const raw of items.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== 'object') return null
    const item = raw as Record<string, unknown>
    const start = text(item.shownStart, 40)
    if (typeof item.id !== 'string' || text(item.title, 300) === null || !STATUS.has(item.status as string) || !start || Number.isNaN(Date.parse(start))) return null
    parsed.push({
      id: item.id.slice(0, 100), title: text(item.title, 300)!, status: item.status as AgendaItem['status'], start,
      approximate: item.approximate === true, delayMin: typeof item.delayMin === 'number' && Number.isFinite(item.delayMin) ? Math.round(item.delayMin) : null
    })
  }
  const note = announcement && typeof announcement === 'object' ? text((announcement as Record<string, unknown>).text, 500) : null
  return { title, timezone, announcement: note, items: parsed }
}

/** Uhrzeit eines Punkts in der Zeitzone des Events ("14:05"). */
export function agendaClock(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
}
