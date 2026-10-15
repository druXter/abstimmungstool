// app/lib/rsvp-verification.ts
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Prüft von rsvp-app signierte Nachrichten für Abstimmungen mit
 * Poll.voterIdentity = RSVP. Die Token-AUSSTELLUNG passiert drüben in rsvp-app
 * (app/lib/poll-verification.ts) - hier wird nur geprüft, damit beide Seiten
 * unabhängig voneinander entwickelt/getestet werden können, solange sie sich an
 * dieses Format halten.
 *
 * Format: `${base64url(JSON-Payload)}.${base64url(HMAC-SHA256(payloadPart, secret))}`
 * - bewusst kein JWT-Library-Dependency, das Format ist absichtlich minimal und an
 * einer Stelle auditierbar.
 *
 * Zwei Nachrichtenarten teilen sich dieses Format:
 * - Klick-Token (`verifyRsvpToken`, an die Abstimmungsseite angehängt als `?verify=`):
 *   Payload `email`, `pollId`, `attending`, `exp`. Wird bei JEDEM Linkklick frisch
 *   ausgestellt und spiegelt daher immer den AKTUELLEN RSVP-Status wider - eine
 *   nachträglich erteilte Zusage schaltet sich damit von selbst frei.
 * - Webhook-Nachricht (`verifyRsvpWebhookPayload`, POST an /api/rsvp-webhook): Payload
 *   zusätzlich `eventId`. Aktiv von rsvp-app verschickt, sobald sich eine Zu-/Absage
 *   ändert - deckt den Fall ab, dass eine bereits abgegebene Stimme entfernt werden
 *   muss, obwohl die Person die Abstimmung selbst nie wieder aufruft.
 *
 * Gibt bei JEDEM Problem (fehlender Token, falsche Signatur, abgelaufen, falscher
 * Poll, fehlendes RSVP_VERIFICATION_SECRET) einfach `null` zurück statt zu werfen -
 * "keine verifizierte Identität" ist ein normaler, erwartbarer Zustand, kein Fehler.
 */

function base64urlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(input: string): Buffer {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function verifySignature(payloadPart: string, signaturePart: string, secret: string): boolean {
  const expectedSignature = base64urlEncode(createHmac('sha256', secret).update(payloadPart).digest())
  // Gleiche Länge zuerst prüfen: timingSafeEqual wirft sonst statt sicher zu vergleichen.
  const expectedBuf = Buffer.from(expectedSignature)
  const actualBuf = Buffer.from(signaturePart)
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf)
}

function sign(payload: object, secret: string): string {
  const payloadPart = base64urlEncode(JSON.stringify(payload))
  const signaturePart = base64urlEncode(createHmac('sha256', secret).update(payloadPart).digest())
  return `${payloadPart}.${signaturePart}`
}

export type VerifiedIdentity = { email: string; pollId: string; attending: boolean }

export function verifyRsvpToken(token: string | undefined | null, expectedPollId: string): VerifiedIdentity | null {
  const secret = process.env.RSVP_VERIFICATION_SECRET
  if (!secret || !token) return null

  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadPart, signaturePart] = parts
  if (!payloadPart || !signaturePart) return null
  if (!verifySignature(payloadPart, signaturePart, secret)) return null

  let payload: { email?: unknown; pollId?: unknown; attending?: unknown; exp?: unknown }
  try {
    payload = JSON.parse(base64urlDecode(payloadPart).toString('utf8'))
  } catch {
    return null
  }

  if (typeof payload.email !== 'string' || !payload.email) return null
  if (typeof payload.pollId !== 'string' || payload.pollId !== expectedPollId) return null
  if (typeof payload.attending !== 'boolean') return null
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null

  return { email: payload.email.toLowerCase(), pollId: payload.pollId, attending: payload.attending }
}

export type RsvpWebhookMessage = { email: string; pollId: string; eventId: string; attending: boolean }

export function verifyRsvpWebhookPayload(token: string | undefined | null): RsvpWebhookMessage | null {
  const secret = process.env.RSVP_VERIFICATION_SECRET
  if (!secret || !token) return null

  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadPart, signaturePart] = parts
  if (!payloadPart || !signaturePart) return null
  if (!verifySignature(payloadPart, signaturePart, secret)) return null

  let payload: { email?: unknown; pollId?: unknown; eventId?: unknown; attending?: unknown; exp?: unknown }
  try {
    payload = JSON.parse(base64urlDecode(payloadPart).toString('utf8'))
  } catch {
    return null
  }

  if (typeof payload.email !== 'string' || !payload.email) return null
  if (typeof payload.pollId !== 'string' || !payload.pollId) return null
  if (typeof payload.eventId !== 'string' || !payload.eventId) return null
  if (typeof payload.attending !== 'boolean') return null
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null

  return { email: payload.email.toLowerCase(), pollId: payload.pollId, eventId: payload.eventId, attending: payload.attending }
}

/** Pseudonym einer Zusage aus rsvp-app: base64url, wie es rsvp-app bildet (HMAC-SHA256, 43 Zeichen). */
const SURVEY_SUBJECT = /^[A-Za-z0-9_-]{16,128}$/
/** Länger gilt ein Fragebogen-Link aus rsvp-app nie, auch wenn er es selbst behauptet. */
const SURVEY_TOKEN_MAX_TTL_SECONDS = 24 * 60 * 60

/**
 * Link-Nachweis für einen Fragebogen im Modus RSVP (Survey.identity, Idee L8 Teil 2): rsvp-app stellt ihn bei
 * jedem Klick auf "Feedback geben" (Mail nach dem Event, Event-Seite) frisch aus und hängt ihn als `?verify=`
 * an. Payload `{ typ: 'survey-access', surveyId, sub, exp }` - `sub` ist ein Pseudonym der Zusage, das
 * rsvp-app je Fragebogen bildet (keine E-Mail, kein Name). Das Pflichtfeld `typ` und `surveyId` statt
 * `pollId` halten die Nachrichtenarten auseinander: Ein Abstimmungs-Token geht hier nie durch und dieser
 * nie bei verifyRsvpToken. Höchstens 24 Stunden gültig. null bei jedem Problem, wie oben.
 */
export function verifyRsvpSurveyToken(token: string | undefined | null, expectedSurveyId: string): { sub: string } | null {
  const secret = process.env.RSVP_VERIFICATION_SECRET
  if (!secret || !token) return null

  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadPart, signaturePart] = parts
  if (!payloadPart || !signaturePart) return null
  if (!verifySignature(payloadPart, signaturePart, secret)) return null

  let payload: { typ?: unknown; surveyId?: unknown; sub?: unknown; exp?: unknown }
  try {
    payload = JSON.parse(base64urlDecode(payloadPart).toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null

  if (payload.typ !== 'survey-access') return null
  if (typeof payload.surveyId !== 'string' || payload.surveyId !== expectedSurveyId) return null
  if (typeof payload.sub !== 'string' || !SURVEY_SUBJECT.test(payload.sub)) return null
  const now = Date.now() / 1000
  if (typeof payload.exp !== 'number' || payload.exp < now || payload.exp > now + SURVEY_TOKEN_MAX_TTL_SECONDS) return null

  return { sub: payload.sub }
}

/**
 * Signiert die Ergebnis-Meldung ans rsvp-app beim Schließen einer Abstimmung
 * (Gegenstück zu dessen `verifyResultWebhookPayload`) - siehe app/lib/rsvp-notify.ts
 * für den Aufrufer.
 */
export function signResultWebhookPayload(payload: { eventId: string; pollId: string; pollTitle: string; winners: { label: string; votes: number }[]; closedAt: string; quorumMet: boolean; unit: 'votes' | 'points' }): string | null {
  const secret = process.env.RSVP_VERIFICATION_SECRET
  if (!secret) return null
  return sign({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 }, secret)
}

/**
 * Nur für Tests/Diagnose gedacht (z.B. um in der Entwicklung ohne rsvp-app einen
 * gültigen Token zu erzeugen) - die echte Ausstellung gehört in rsvp-app, nicht
 * hierher. Bewusst nicht in einer Produktions-UI verlinkt.
 */
export function signRsvpTokenForTesting(email: string, pollId: string, attending = true, ttlSeconds = 600): string {
  const secret = process.env.RSVP_VERIFICATION_SECRET
  if (!secret) throw new Error('RSVP_VERIFICATION_SECRET nicht gesetzt (nur für rsvp-app-Testzwecke relevant)')
  return sign({ email, pollId, attending, exp: Math.floor(Date.now() / 1000) + ttlSeconds }, secret)
}

/**
 * Signiert eine Nachricht der Terminabstimmung an rsvp-app (Gegenstück zu dessen
 * verifyPollDateMessage) - gleiches Format und Secret, aber immer mit `typ`, damit sie drüben
 * nie mit einer anderen Nachrichtenart verwechselt werden kann. 5 Minuten gültig.
 */
export function signPollDateMessage(payload: { typ: 'poll-date-status' | 'poll-date-set' } & Record<string, unknown>): string | null {
  const secret = process.env.RSVP_VERIFICATION_SECRET
  if (!secret) return null
  return sign({ ...payload, exp: Math.floor(Date.now() / 1000) + 300 }, secret)
}

/**
 * Nachrichten mit Pflichtfeld `typ` (Sitzungen, docs/KONZEPT-SITZUNG.md): Signatur, `typ` und Ablauf prüfen und die
 * rohe Payload zurückgeben - die Felder prüft der Aufrufer (app/lib/assembly-coupling.ts). Höchstens `maxTtlSeconds`
 * in die Zukunft gültig, damit ein abgefangenes Exemplar nicht lange wiederverwendbar bleibt. null bei jedem Problem.
 */
export function verifyTypedRsvpMessage(token: string | undefined | null, typ: string, maxTtlSeconds: number): Record<string, unknown> | null {
  const secret = process.env.RSVP_VERIFICATION_SECRET
  if (!secret || !token) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  if (!verifySignature(parts[0], parts[1], secret)) return null
  let payload: unknown
  try {
    payload = JSON.parse(base64urlDecode(parts[0]).toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  const now = Date.now() / 1000
  if (record.typ !== typ) return null
  if (typeof record.exp !== 'number' || record.exp < now || record.exp > now + maxTtlSeconds) return null
  return record
}

/** Gegenstück: signiert eine Nachricht mit `typ` an rsvp-app, `ttlSeconds` gültig. null ohne Secret. */
export function signTypedRsvpMessage(payload: { typ: string } & Record<string, unknown>, ttlSeconds: number): string | null {
  const secret = process.env.RSVP_VERIFICATION_SECRET
  if (!secret) return null
  return sign({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }, secret)
}
