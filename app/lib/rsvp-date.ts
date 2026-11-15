// app/lib/rsvp-date.ts
import { createHash } from 'node:crypto'
import { prisma } from './prisma'
import { signPollDateMessage } from './rsvp-verification'

/**
 * Übergabe des festgelegten Termins an rsvp-app (Gegenstück dort: app/lib/poll-date.ts,
 * POST /api/poll-date). Voraussetzung: RSVP_APP_BASE_URL und RSVP_VERIFICATION_SECRET.
 *
 * - Events in rsvp-app, deren Abstimmungslink auf GENAU diese Abstimmung zeigt, deren Datum dort
 *   noch offen ist und die die Besitzerin bestätigt hat, übernehmen den Termin; rsvp-app benachrichtigt
 *   deren Zusagende selbst. Den Link trägt dort jede Verwaltung frei ein - bestätigt sind deshalb nur
 *   der gebundene Termin, die beim Festlegen angekreuzten Events (beide als `eventIds` in jeder
 *   Nachricht) und Events, die dort ihrem verknüpften Konto gehören (docs/AUDIT-2026-11.md, V-02).
 *   Alle anderen ändert rsvp-app nicht und meldet sie als `ignored`.
 * - Gibt es kein bestätigtes, kann rsvp-app ein neues Event anlegen - nur für den Owner der Abstimmung und
 *   nur, wenn dessen Konto mit einem rsvp-app-Konto verknüpft ist (Suite-Verbund). Wir schicken
 *   dafür unsere Konto-ID und, falls hier bekannt, seine rsvp-app-Konto-ID mit.
 * - Doppelte Benachrichtigungen: rsvp-app bekommt SHA-256-Hashes der Adressen, die wir selbst
 *   benachrichtigen, und lässt diese Gäste aus (emailHash).
 */

/** `trusted`: bestätigt bzw. eigenes Event, übernimmt den Termin (fehlt bei älteren rsvp-app-Versionen). */
export type RsvpEventInfo = { id: string; title: string; datePending: boolean; trusted: boolean }
export type RsvpDateStatus =
  | { state: 'off' }
  | { state: 'unreachable' }
  | { state: 'ok'; events: RsvpEventInfo[]; canCreate: boolean }

export type RsvpTransfer = {
  create: boolean
  error?: 'unreachable'
  updated?: { id: string; title: string; url: string; trusted?: boolean }[]
  created?: { id: string; title: string; url: string; adminUrl: string } | null
  unchanged?: { id: string; title: string }[]
  /** Events, die nur auf die Abstimmung zeigen - von rsvp-app nicht geändert. */
  ignored?: { id: string; title: string }[]
  /** Termin, an den die Abstimmung beim Festlegen gebunden war (Poll.rsvpEventId). */
  linkedEventId?: string | null
  /** Events, die die Verwaltung beim Festlegen ausdrücklich als ihre bestätigt hat ("das ist unser Event"). */
  acceptedEventIds?: string[]
}

/**
 * Link zur Veranstaltung für Mail und Abstimmungsseite: das Event, das rsvp-app für die Besitzerin neu angelegt hat,
 * das übernommene Event des gebundenen Termins oder eins, das die Verwaltung beim Festlegen als ihres bestätigt hat.
 * Alle anderen übernommenen Events zeigen nur auf die Abstimmung, weil ihre Verwaltung in rsvp-app den Link
 * eingetragen hat - zugestimmt hat die Besitzerin nie (docs/AUDIT-2026-11.md, V-02).
 */
export function trustedEvent(transfer: RsvpTransfer | null): { id: string; title: string; url: string } | null {
  if (!transfer || transfer.error) return null
  if (transfer.created) return transfer.created
  const trusted = new Set([transfer.linkedEventId, ...(transfer.acceptedEventIds ?? [])].filter(Boolean))
  return transfer.updated?.find(e => e.trusted === true || trusted.has(e.id)) ?? null
}

/** Die als eigene bestätigten Events aus dem Formular (höchstens 10, nur Kennungen). */
export function acceptedEventIds(formData: FormData): string[] {
  return [...new Set(formData.getAll('acceptEventId').filter((v): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)))].slice(0, 10)
}

/** Die Events, die die Besitzerin bestätigt hat: der gebundene Termin und die beim Festlegen angekreuzten. */
function confirmedIds(rsvpEventId: string | null, accepted: string[]): string[] {
  return [...new Set([rsvpEventId, ...accepted].filter((id): id is string => !!id))].slice(0, 20)
}

export function rsvpAppBaseUrl(): string | null {
  const url = process.env.RSVP_APP_BASE_URL
  return url ? url.replace(/\/+$/, '') : null
}

export function isRsvpDateConfigured(): boolean {
  return !!rsvpAppBaseUrl() && !!process.env.RSVP_VERIFICATION_SECRET
}

/** SHA-256 einer normalisierten Adresse (hex) - muss zu emailHash in rsvp-app passen. */
export function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

/** Owner der Abstimmung für rsvp-app: unsere Konto-ID plus - falls über den Verbund verknüpft - seine dortige. */
async function ownerFor(ownerId: string | null): Promise<{ toolUserId: string; rsvpUserId: string | null } | null> {
  if (!ownerId) return null
  const base = rsvpAppBaseUrl()
  const issuer = base ? new URL(base).origin : null
  const identity = issuer
    ? await prisma.externalIdentity.findFirst({ where: { userId: ownerId, issuer }, select: { subject: true } })
    : null
  return { toolUserId: ownerId, rsvpUserId: identity?.subject ?? null }
}

async function post(payload: Parameters<typeof signPollDateMessage>[0]): Promise<Record<string, unknown> | null> {
  const base = rsvpAppBaseUrl()
  const body = signPollDateMessage(payload)
  if (!base || !body) return null
  try {
    const response = await fetch(`${base}/api/poll-date`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      redirect: 'error', signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) return null
    const json = await response.json()
    return json && typeof json === 'object' && json.ok === true ? json : null
  } catch {
    return null
  }
}

/** Was rsvp-app zu dieser Abstimmung weiß - für die Anzeige vor dem Festlegen. */
export async function rsvpDateStatus(poll: { id: string; ownerId: string | null; rsvpEventId: string | null }): Promise<RsvpDateStatus> {
  const owner = await ownerFor(poll.ownerId)
  if (!isRsvpDateConfigured() || !owner) return { state: 'off' }
  const json = await post({ typ: 'poll-date-status', pollId: poll.id, owner, eventIds: confirmedIds(poll.rsvpEventId, []) })
  if (!json || !Array.isArray(json.events)) return { state: 'unreachable' }
  return {
    state: 'ok',
    events: (json.events as RsvpEventInfo[]).map(e => ({
      id: String(e.id), title: String(e.title), datePending: !!e.datePending, trusted: e.trusted === true || e.id === poll.rsvpEventId
    })),
    canCreate: json.canCreate === true
  }
}

/** Den festgelegten Termin an rsvp-app übergeben. Gibt null zurück, wenn nicht eingerichtet. */
export async function transferFinalDate(
  poll: { id: string; title: string; ownerId: string | null; rsvpEventId: string | null },
  startsAt: Date,
  { create, skipEmailHashes, accepted = [] }: { create: boolean; skipEmailHashes: string[]; accepted?: string[] }
): Promise<RsvpTransfer | null> {
  const owner = await ownerFor(poll.ownerId)
  if (!isRsvpDateConfigured() || !owner) return null
  const json = await post({
    typ: 'poll-date-set', pollId: poll.id, pollTitle: poll.title, startsAt: startsAt.toISOString(),
    owner, create, skipEmailHashes, eventIds: confirmedIds(poll.rsvpEventId, accepted)
  })
  if (!json) return { create, error: 'unreachable', acceptedEventIds: accepted }
  return {
    create,
    linkedEventId: poll.rsvpEventId,
    acceptedEventIds: accepted,
    updated: Array.isArray(json.updated) ? (json.updated as RsvpTransfer['updated']) : [],
    created: (json.created as RsvpTransfer['created']) ?? null,
    unchanged: Array.isArray(json.unchanged) ? (json.unchanged as RsvpTransfer['unchanged']) : [],
    ignored: Array.isArray(json.ignored) ? (json.ignored as RsvpTransfer['ignored']) : []
  }
}

export function parseTransfer(value: string | null): RsvpTransfer | null {
  if (!value) return null
  try {
    return JSON.parse(value) as RsvpTransfer
  } catch {
    return null
  }
}
