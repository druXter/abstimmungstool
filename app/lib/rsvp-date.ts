// app/lib/rsvp-date.ts
import { createHash } from 'node:crypto'
import { prisma } from './prisma'
import { signPollDateMessage } from './rsvp-verification'

/**
 * Übergabe des festgelegten Termins an rsvp-app (Gegenstück dort: app/lib/poll-date.ts,
 * POST /api/poll-date). Voraussetzung: RSVP_APP_BASE_URL und RSVP_VERIFICATION_SECRET.
 *
 * - Events in rsvp-app, deren Abstimmungslink auf GENAU diese Abstimmung zeigt und deren Datum
 *   dort noch offen ist, übernehmen den Termin; rsvp-app benachrichtigt deren Zusagende selbst.
 * - Gibt es keins, kann rsvp-app ein neues Event anlegen - nur für den Owner der Abstimmung und
 *   nur, wenn dessen Konto mit einem rsvp-app-Konto verknüpft ist (Suite-Verbund). Wir schicken
 *   dafür unsere Konto-ID und, falls hier bekannt, seine rsvp-app-Konto-ID mit.
 * - Doppelte Benachrichtigungen: rsvp-app bekommt SHA-256-Hashes der Adressen, die wir selbst
 *   benachrichtigen, und lässt diese Gäste aus (emailHash).
 */

export type RsvpEventInfo = { id: string; title: string; datePending: boolean }
export type RsvpDateStatus =
  | { state: 'off' }
  | { state: 'unreachable' }
  | { state: 'ok'; events: RsvpEventInfo[]; canCreate: boolean }

export type RsvpTransfer = {
  create: boolean
  error?: 'unreachable'
  updated?: { id: string; title: string; url: string }[]
  created?: { id: string; title: string; url: string; adminUrl: string } | null
  unchanged?: { id: string; title: string }[]
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
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) return null
    const json = await response.json()
    return json && typeof json === 'object' && json.ok === true ? json : null
  } catch {
    return null
  }
}

/** Was rsvp-app zu dieser Abstimmung weiß - für die Anzeige vor dem Festlegen. */
export async function rsvpDateStatus(poll: { id: string; ownerId: string | null }): Promise<RsvpDateStatus> {
  const owner = await ownerFor(poll.ownerId)
  if (!isRsvpDateConfigured() || !owner) return { state: 'off' }
  const json = await post({ typ: 'poll-date-status', pollId: poll.id, owner })
  if (!json || !Array.isArray(json.events)) return { state: 'unreachable' }
  return {
    state: 'ok',
    events: (json.events as RsvpEventInfo[]).map(e => ({ id: String(e.id), title: String(e.title), datePending: !!e.datePending })),
    canCreate: json.canCreate === true
  }
}

/** Den festgelegten Termin an rsvp-app übergeben. Gibt null zurück, wenn nicht eingerichtet. */
export async function transferFinalDate(
  poll: { id: string; title: string; ownerId: string | null },
  startsAt: Date,
  { create, skipEmailHashes }: { create: boolean; skipEmailHashes: string[] }
): Promise<RsvpTransfer | null> {
  const owner = await ownerFor(poll.ownerId)
  if (!isRsvpDateConfigured() || !owner) return null
  const json = await post({
    typ: 'poll-date-set', pollId: poll.id, pollTitle: poll.title, startsAt: startsAt.toISOString(),
    owner, create, skipEmailHashes
  })
  if (!json) return { create, error: 'unreachable' }
  return {
    create,
    updated: Array.isArray(json.updated) ? (json.updated as RsvpTransfer['updated']) : [],
    created: (json.created as RsvpTransfer['created']) ?? null,
    unchanged: Array.isArray(json.unchanged) ? (json.unchanged as RsvpTransfer['unchanged']) : []
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
