// app/lib/rsvp-verification.ts
import { signLinkMessage, verifyLinkMessage } from 'suite-kit'
import { baseUrl } from './base-url'

/**
 * Kopplung mit rsvp-app: alle Nachrichten im gemeinsamen Format der Suite (suite-kit signLinkMessage,
 * docs/KONVENTIONEN.md „Anbindungen“): `base64url(JSON).base64url(HMAC-SHA256)` mit RSVP_VERIFICATION_SECRET (dort
 * POLL_VERIFICATION_SECRET), Nutzlast `{ typ, aud, ...felder, iat, exp }`. `typ` hält die Arten auseinander, `aud` ist
 * der Origin des Empfängers, die Gültigkeit ist begrenzt. Gegenstück: app/lib/poll-verification.ts in rsvp-app. Feste
 * Prüfnachrichten auf beiden Seiten (tests/unit/rsvp-verification.test.ts hier).
 *
 * Von rsvp-app:
 * - `poll-access` (Klick-Token, an die Abstimmungsseite angehängt als `?verify=`): `email`, `pollId`, `attending`.
 *   Wird bei JEDEM Linkklick frisch ausgestellt und spiegelt daher immer den AKTUELLEN RSVP-Status wider - eine
 *   nachträglich erteilte Zusage schaltet sich damit von selbst frei.
 * - `poll-attendance` (POST an /api/rsvp-webhook): zusätzlich `eventId`. Aktiv von rsvp-app verschickt, sobald sich
 *   eine Zu-/Absage ändert - deckt den Fall ab, dass eine bereits abgegebene Stimme entfernt werden muss, obwohl die
 *   Person die Abstimmung selbst nie wieder aufruft.
 * - `survey-access`, `assembly-*` (Fragebogen, Sitzungen).
 * An rsvp-app: `poll-result`, `poll-date-status`, `poll-date-set`, `assembly-*`.
 *
 * Gibt bei JEDEM Problem (fehlender Token, falsche Signatur, Art oder Empfänger, abgelaufen, falscher Poll, fehlendes
 * RSVP_VERIFICATION_SECRET) einfach `null` zurück statt zu werfen - "keine verifizierte Identität" ist ein normaler,
 * erwartbarer Zustand, kein Fehler.
 */

function secret(): string | null {
  return process.env.RSVP_VERIFICATION_SECRET || null
}

function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Empfänger unserer Nachrichten: rsvp-app (RSVP_APP_BASE_URL). */
function rsvpOrigin(): string | null {
  return originOf(process.env.RSVP_APP_BASE_URL)
}

/** Nachricht von rsvp-app prüfen: Signatur, Art, Empfänger (wir), höchstens `maxTtlSeconds` gültig. */
function verifyFromRsvp(token: unknown, typ: string, maxTtlSeconds: number): Record<string, unknown> | null {
  const key = secret()
  const audience = originOf(baseUrl())
  if (!key || !audience) return null
  return verifyLinkMessage(token, { typ, audience, secret: key, maxTtlSeconds })
}

/** Nachricht an rsvp-app signieren. null ohne Secret oder ohne RSVP_APP_BASE_URL. */
function signForRsvp(typ: string, fields: Record<string, unknown>, ttlSeconds: number): string | null {
  const key = secret()
  const audience = rsvpOrigin()
  if (!key || !audience) return null
  return signLinkMessage(typ, audience, fields, key, { ttlSeconds })
}

/** Klick- und Webhook-Nachrichten stellt rsvp-app für 10 Minuten aus. */
const RSVP_MESSAGE_MAX_TTL_SECONDS = 15 * 60

export type VerifiedIdentity = { email: string; pollId: string; attending: boolean }

export function verifyRsvpToken(token: string | undefined | null, expectedPollId: string): VerifiedIdentity | null {
  const payload = verifyFromRsvp(token, 'poll-access', RSVP_MESSAGE_MAX_TTL_SECONDS)
  if (!payload) return null
  if (typeof payload.email !== 'string' || !payload.email) return null
  if (typeof payload.pollId !== 'string' || payload.pollId !== expectedPollId) return null
  if (typeof payload.attending !== 'boolean') return null
  return { email: payload.email.toLowerCase(), pollId: payload.pollId, attending: payload.attending }
}

export type RsvpWebhookMessage = { email: string; pollId: string; eventId: string; attending: boolean }

export function verifyRsvpWebhookPayload(token: string | undefined | null): RsvpWebhookMessage | null {
  const payload = verifyFromRsvp(token, 'poll-attendance', RSVP_MESSAGE_MAX_TTL_SECONDS)
  if (!payload) return null
  if (typeof payload.email !== 'string' || !payload.email) return null
  if (typeof payload.pollId !== 'string' || !payload.pollId) return null
  if (typeof payload.eventId !== 'string' || !payload.eventId) return null
  if (typeof payload.attending !== 'boolean') return null
  return { email: payload.email.toLowerCase(), pollId: payload.pollId, eventId: payload.eventId, attending: payload.attending }
}

/** Pseudonym einer Zusage aus rsvp-app: base64url, wie es rsvp-app bildet (HMAC-SHA256, 43 Zeichen). */
const SURVEY_SUBJECT = /^[A-Za-z0-9_-]{16,128}$/
/** Länger gilt ein Fragebogen-Link aus rsvp-app nie, auch wenn er es selbst behauptet. */
const SURVEY_TOKEN_MAX_TTL_SECONDS = 24 * 60 * 60

/**
 * Link-Nachweis für einen Fragebogen im Modus RSVP (Survey.identity, Idee L8 Teil 2): rsvp-app stellt ihn bei
 * jedem Klick auf "Feedback geben" (Mail nach dem Event, Event-Seite) frisch aus und hängt ihn als `?verify=`
 * an. Nachricht `survey-access` mit `surveyId` und `sub` - `sub` ist ein Pseudonym der Zusage, das rsvp-app je
 * Fragebogen bildet (keine E-Mail, kein Name). Als einzige Nachricht länger als eine Stunde gültig (höchstens 24
 * Stunden), weil sie das Ausfüllen überdauern muss. null bei jedem Problem, wie oben.
 */
export function verifyRsvpSurveyToken(token: string | undefined | null, expectedSurveyId: string): { sub: string } | null {
  const payload = verifyFromRsvp(token, 'survey-access', SURVEY_TOKEN_MAX_TTL_SECONDS)
  if (!payload) return null
  if (typeof payload.surveyId !== 'string' || payload.surveyId !== expectedSurveyId) return null
  if (typeof payload.sub !== 'string' || !SURVEY_SUBJECT.test(payload.sub)) return null
  return { sub: payload.sub }
}

/**
 * Signiert die Ergebnis-Meldung ans rsvp-app beim Schließen einer Abstimmung (`poll-result`, Gegenstück zu dessen
 * `verifyResultWebhookPayload`) - siehe app/lib/rsvp-notify.ts für den Aufrufer.
 */
export function signResultWebhookPayload(payload: { eventId: string; pollId: string; pollTitle: string; winners: { label: string; votes: number }[]; closedAt: string; quorumMet: boolean; unit: 'votes' | 'points' }): string | null {
  return signForRsvp('poll-result', payload, 600)
}

/**
 * Nur für Tests/Diagnose gedacht (z.B. um in der Entwicklung ohne rsvp-app einen
 * gültigen Token zu erzeugen) - die echte Ausstellung gehört in rsvp-app, nicht
 * hierher. Bewusst nicht in einer Produktions-UI verlinkt.
 */
export function signRsvpTokenForTesting(email: string, pollId: string, attending = true, ttlSeconds = 600): string {
  const key = secret()
  if (!key) throw new Error('RSVP_VERIFICATION_SECRET nicht gesetzt (nur für rsvp-app-Testzwecke relevant)')
  return signLinkMessage('poll-access', originOf(baseUrl())!, { email, pollId, attending }, key, { ttlSeconds })
}

/**
 * Signiert eine Nachricht der Terminabstimmung an rsvp-app (Gegenstück zu dessen verifyPollDateMessage),
 * 5 Minuten gültig.
 */
export function signPollDateMessage(payload: { typ: 'poll-date-status' | 'poll-date-set' } & Record<string, unknown>): string | null {
  const { typ, ...fields } = payload
  return signForRsvp(typ, fields, 300)
}

/**
 * Nachrichten der Sitzungen (docs/KONZEPT-SITZUNG.md): Signatur, Art, Empfänger und Ablauf prüfen und die rohe
 * Payload zurückgeben - die Felder prüft der Aufrufer (app/lib/assembly-coupling.ts). Höchstens `maxTtlSeconds` in
 * die Zukunft gültig, damit ein abgefangenes Exemplar nicht lange wiederverwendbar bleibt. null bei jedem Problem.
 */
export function verifyTypedRsvpMessage(token: string | undefined | null, typ: string, maxTtlSeconds: number): Record<string, unknown> | null {
  return verifyFromRsvp(token, typ, maxTtlSeconds)
}

/** Gegenstück: signiert eine Nachricht mit `typ` an rsvp-app, `ttlSeconds` gültig. null ohne Secret. */
export function signTypedRsvpMessage(payload: { typ: string } & Record<string, unknown>, ttlSeconds: number): string | null {
  const { typ, ...fields } = payload
  return signForRsvp(typ, fields, ttlSeconds)
}
