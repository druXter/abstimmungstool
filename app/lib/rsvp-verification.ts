// app/lib/rsvp-verification.ts
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Prüft einen von rsvp-app signierten Verifizierungs-Token für Abstimmungen mit
 * Poll.requireRsvpVerification. Die Token-AUSSTELLUNG passiert drüben in rsvp-app
 * (noch nicht umgesetzt, siehe README.md "Geplante Erweiterung") - hier wird nur
 * geprüft, damit beide Seiten unabhängig voneinander entwickelt/getestet werden
 * können, solange sie sich an dieses Format halten.
 *
 * Format: `${base64url(JSON-Payload)}.${base64url(HMAC-SHA256(payloadPart, secret))}`
 * - bewusst kein JWT-Library-Dependency, das Format ist absichtlich minimal und an
 * einer Stelle auditierbar. Payload-Felder: `email` (die verifizierte E-Mail aus
 * rsvp-app, z.B. GuestUser.email mit isVerified=true), `pollId` (bindet den Token an
 * GENAU DIESE Abstimmung - ein für Poll A ausgestellter Token darf nicht für Poll B
 * gelten), `exp` (Unix-Timestamp in Sekunden, kurze Gültigkeit von wenigen Minuten
 * empfohlen, damit ein weitergeleiteter Link nicht dauerhaft nutzbar bleibt).
 *
 * Gibt bei JEDEM Problem (fehlender Token, falsche Signatur, abgelaufen, falscher
 * Poll, fehlendes RSVP_VERIFICATION_SECRET) einfach `null` zurück statt zu werfen -
 * "keine verifizierte Identität" ist ein normaler, erwartbarer Zustand, kein Fehler.
 */

const RSVP_TOOL_NAME = 'rsvp-app'

function base64urlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(input: string): Buffer {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

export type VerifiedIdentity = { email: string; pollId: string }

export function verifyRsvpToken(token: string | undefined | null, expectedPollId: string): VerifiedIdentity | null {
  const secret = process.env.RSVP_VERIFICATION_SECRET
  if (!secret || !token) return null

  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadPart, signaturePart] = parts
  if (!payloadPart || !signaturePart) return null

  const expectedSignature = base64urlEncode(createHmac('sha256', secret).update(payloadPart).digest())

  // Gleiche Länge zuerst prüfen: timingSafeEqual wirft sonst statt sicher zu vergleichen.
  const expectedBuf = Buffer.from(expectedSignature)
  const actualBuf = Buffer.from(signaturePart)
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null

  let payload: { email?: unknown; pollId?: unknown; exp?: unknown }
  try {
    payload = JSON.parse(base64urlDecode(payloadPart).toString('utf8'))
  } catch {
    return null
  }

  if (typeof payload.email !== 'string' || !payload.email) return null
  if (typeof payload.pollId !== 'string' || payload.pollId !== expectedPollId) return null
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null

  return { email: payload.email.toLowerCase(), pollId: payload.pollId }
}

/**
 * Nur für Tests/Diagnose gedacht (z.B. um in der Entwicklung ohne rsvp-app einen
 * gültigen Token zu erzeugen) - die echte Ausstellung gehört in rsvp-app, nicht
 * hierher. Bewusst nicht in einer Produktions-UI verlinkt.
 */
export function signRsvpTokenForTesting(email: string, pollId: string, ttlSeconds = 600): string {
  const secret = process.env.RSVP_VERIFICATION_SECRET
  if (!secret) throw new Error(`RSVP_VERIFICATION_SECRET nicht gesetzt (nur für ${RSVP_TOOL_NAME}-Testzwecke relevant)`)

  const payload = JSON.stringify({ email, pollId, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  const payloadPart = base64urlEncode(payload)
  const signaturePart = base64urlEncode(createHmac('sha256', secret).update(payloadPart).digest())
  return `${payloadPart}.${signaturePart}`
}
