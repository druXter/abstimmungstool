// app/lib/assembly-coupling.ts
//
// Kopplung der Sitzungen mit rsvp-app (docs/KONZEPT-SITZUNG.md, Gegenstück dort: app/lib/assembly.ts). Drei
// Nachrichten: Beitritt (`assembly-access`, Link aus rsvp-app), Verknüpfung (`assembly-link`, beim Speichern des
// Links in rsvp-app) und die Anwesenheit (`assembly-roster`, hier angefragt, signiert beantwortet). Gleiches
// Format und Secret wie die übrige Kopplung (app/lib/rsvp-verification.ts).
import { rsvpAppBaseUrl } from './rsvp-date'
import { signTypedRsvpMessage, verifyTypedRsvpMessage } from './rsvp-verification'

/** Pseudonym einer Zusage aus rsvp-app (base64url, HMAC) - wie bei den Fragebögen. */
const SUBJECT = /^[A-Za-z0-9_-]{16,128}$/
const ID = /^[A-Za-z0-9_-]{1,100}$/
export const MAX_MEMBER_NAME = 100

/** Beitritt über den Link aus rsvp-app: höchstens 15 Minuten gültig, nur für genau diese Sitzung. */
export function verifyAssemblyAccess(token: string | undefined | null, assemblyId: string): { eventId: string; sub: string; name: string } | null {
  const payload = verifyTypedRsvpMessage(token, 'assembly-access', 15 * 60)
  if (!payload || payload.assemblyId !== assemblyId) return null
  const { eventId, sub, name } = payload
  if (typeof eventId !== 'string' || !ID.test(eventId)) return null
  if (typeof sub !== 'string' || !SUBJECT.test(sub)) return null
  if (typeof name !== 'string' || !name.trim()) return null
  return { eventId, sub, name: name.trim().slice(0, MAX_MEMBER_NAME) }
}

/** Verknüpfung beim Speichern des Links in rsvp-app (POST /api/rsvp-assembly), höchstens 5 Minuten gültig. */
export function verifyAssemblyLink(token: string | undefined | null): { assemblyId: string; eventId: string; eventTitle: string } | null {
  const payload = verifyTypedRsvpMessage(token, 'assembly-link', 5 * 60)
  if (!payload) return null
  const { assemblyId, eventId, eventTitle } = payload
  if (typeof assemblyId !== 'string' || !ID.test(assemblyId)) return null
  if (typeof eventId !== 'string' || !ID.test(eventId)) return null
  if (typeof eventTitle !== 'string' || eventTitle.length > 200) return null
  return { assemblyId, eventId, eventTitle: eventTitle.trim() }
}

export type Roster =
  | { state: 'ok'; checkin: boolean; members: number; present: Set<string> }
  /** Kein Termin verknüpft oder Kopplung nicht eingerichtet */
  | { state: 'off' }
  /** rsvp-app nicht erreichbar oder Antwort ungültig - dann gilt niemand als anwesend (fail closed) */
  | { state: 'unreachable' }

const CACHE_MS = 5000
const cache = new Map<string, { at: number; roster: Roster }>()

/**
 * Wer laut rsvp-app gerade da ist (Pseudonyme), wie viele zugesagt haben und ob der Termin QR-Einlass hat. 5 Sekunden
 * zwischengespeichert - die Mitgliederansicht fragt alle paar Sekunden, abgestimmt wird in Wellen. `fresh` umgeht den
 * Zwischenspeicher (Stimmabgabe), damit wer gerade gegangen ist, nicht noch abstimmen kann.
 */
export async function fetchRoster(assembly: { id: string; rsvpEventId: string | null }, { fresh = false } = {}): Promise<Roster> {
  const base = rsvpAppBaseUrl()
  if (!assembly.rsvpEventId || !base) return { state: 'off' }
  const key = `${assembly.id}:${assembly.rsvpEventId}`
  const hit = cache.get(key)
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.roster

  const body = signTypedRsvpMessage({ typ: 'assembly-roster', assemblyId: assembly.id, eventId: assembly.rsvpEventId }, 5 * 60)
  if (!body) return { state: 'off' }
  let roster: Roster = { state: 'unreachable' }
  try {
    const response = await fetch(`${base}/api/assembly/roster`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, signal: AbortSignal.timeout(4000), cache: 'no-store'
    })
    if (response.ok) roster = parseRoster(await response.text(), assembly.id, assembly.rsvpEventId)
  } catch {
    // bleibt unreachable
  }
  cache.set(key, { at: Date.now(), roster })
  return roster
}

function parseRoster(token: string, assemblyId: string, eventId: string): Roster {
  const payload = verifyTypedRsvpMessage(token, 'assembly-roster-result', 5 * 60)
  if (!payload || payload.assemblyId !== assemblyId || payload.eventId !== eventId) return { state: 'unreachable' }
  const { checkin, members, present } = payload
  if (typeof checkin !== 'boolean' || typeof members !== 'number' || !Number.isInteger(members) || members < 0) return { state: 'unreachable' }
  if (!Array.isArray(present) || present.length > 10_000 || !present.every(s => typeof s === 'string' && SUBJECT.test(s))) return { state: 'unreachable' }
  return { state: 'ok', checkin, members, present: new Set(present as string[]) }
}

/** Nach dem Lösen oder Ändern der Verknüpfung: nichts Veraltetes mehr ausliefern. */
export function forgetRoster(assemblyId: string) {
  for (const key of cache.keys()) if (key.startsWith(`${assemblyId}:`)) cache.delete(key)
}

/** Anfrage von rsvp-app nach den Beschlüssen fürs Protokoll (`assembly-decisions`, POST /api/assembly/decisions). */
export function verifyDecisionsRequest(token: string | undefined | null): { assemblyId: string; eventId: string } | null {
  const payload = verifyTypedRsvpMessage(token, 'assembly-decisions', 5 * 60)
  if (!payload) return null
  const { assemblyId, eventId } = payload
  if (typeof assemblyId !== 'string' || !ID.test(assemblyId) || typeof eventId !== 'string' || !ID.test(eventId)) return null
  return { assemblyId, eventId }
}

export type Decision = {
  title: string
  secret: boolean
  openedAt: string
  closedAt: string
  voters: number
  present: number | null
  quorumMet: boolean | null
  /** Namen nur bei namentlichen Abstimmungen - wie in den Ergebnissen der Sitzung. */
  options: { label: string; votes: number; names?: string[] }[]
}

/** Antwort: die geschlossenen Abstimmungen der Sitzung mit Ergebnis, signiert, 5 Minuten gültig. null ohne Secret. */
export function signDecisions(assemblyId: string, eventId: string, decisions: Decision[]): string | null {
  return signTypedRsvpMessage({ typ: 'assembly-decisions-result', assemblyId, eventId, decisions }, 5 * 60)
}
