import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { reserve } from './throttle'

/**
 * Einmal-Token im Formular eines Fragebogens (docs/KONZEPT-FRAGEBOGEN.md, "Schutz vor Manipulation"): signiert
 * (SURVEY_FORM_SECRET), nur EINMAL verwendbar und frühestens MIN_FILL_MS nach dem Laden der Seite gültig. Ein Skript
 * kann so nicht beliebig viele Abgaben aus einem einmal geladenen Formular abfeuern, sondern muss für jede Abgabe die
 * Seite neu laden und warten - zusammen mit der Drosselung je IP (bzw. IPv6-/64-Netz) bremst das Massen-Ausfüllen.
 * Gegen entschlossene Angreifer mit vielen Adressen hilft das nicht vollständig; dafür gibt es in der Verwaltung das
 * Löschen einzelner und identischer Abgaben.
 *
 * Token: "<ausgestellt ms>.<nonce>.<hmac>", der HMAC deckt Fragebogen, Zeit und Nonce ab. Verbrauchte Nonces stehen
 * (nur als Hash) in LoginThrottle und verfallen dort nach 24 h - deshalb gilt ein Token höchstens MAX_AGE_MS < 24 h.
 */

const MAX_AGE_MS = 20 * 60 * 60 * 1000
const NONCE_WINDOW_MS = 24 * 60 * 60 * 1000
/** Mindestzeit zwischen Laden und Absenden. In den E2E-Tests 0 (SURVEY_MIN_FILL_MS), sonst 3 Sekunden. */
function minFillMs(): number {
  const value = Number.parseInt(process.env.SURVEY_MIN_FILL_MS ?? '', 10)
  return Number.isInteger(value) && value >= 0 ? value : 3000
}

// Ohne SURVEY_FORM_SECRET ein zufälliger Schlüssel je Prozess: funktioniert, aber nach einem Neustart sind offene
// Formulare ungültig (die Seite bittet dann ums Neuladen).
let fallbackSecret: Buffer | null = null
function secret(): Buffer {
  const configured = process.env.SURVEY_FORM_SECRET
  if (configured && configured.length >= 32) return Buffer.from(configured)
  if (!fallbackSecret) {
    fallbackSecret = randomBytes(32)
    console.warn('[fragebogen] SURVEY_FORM_SECRET fehlt oder ist zu kurz - zufälliger Schlüssel bis zum nächsten Neustart')
  }
  return fallbackSecret
}

function sign(surveyId: string, issuedAt: string, nonce: string): string {
  return createHmac('sha256', secret()).update(`survey-form\u0000${surveyId}\u0000${issuedAt}\u0000${nonce}`).digest('base64url')
}

export function issueFormToken(surveyId: string): string {
  const issuedAt = String(Date.now())
  const nonce = randomBytes(16).toString('base64url')
  return `${issuedAt}.${nonce}.${sign(surveyId, issuedAt, nonce)}`
}

export type TokenCheck = { ok: true; nonce: string } | { ok: false; reason: 'ungueltig' | 'zu-schnell' }

/** Prüft Signatur und Alter (verbraucht das Token NICHT, siehe consumeFormToken). */
export function checkFormToken(surveyId: string, token: unknown, now = Date.now()): TokenCheck {
  if (typeof token !== 'string' || token.length > 200) return { ok: false, reason: 'ungueltig' }
  const [issuedAt, nonce, mac] = token.split('.')
  if (!issuedAt || !nonce || !mac || !/^\d{1,15}$/.test(issuedAt)) return { ok: false, reason: 'ungueltig' }
  const expected = Buffer.from(sign(surveyId, issuedAt, nonce))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'ungueltig' }
  const age = now - Number(issuedAt)
  if (age < 0 || age > MAX_AGE_MS) return { ok: false, reason: 'ungueltig' }
  if (age < minFillMs()) return { ok: false, reason: 'zu-schnell' }
  return { ok: true, nonce }
}

/** Verbraucht die Nonce atomar (reserve mit Grenze 1). false = schon einmal benutzt. */
export async function consumeFormToken(nonce: string): Promise<boolean> {
  return reserve([{ scope: 'survey:nonce', identifier: nonce, limit: 1, windowMs: NONCE_WINDOW_MS }])
}

/** Name des versteckten Lockfelds: Menschen sehen es nicht, einfache Bots füllen jedes Feld aus. */
export const HONEYPOT_FIELD = 'website'
