// app/lib/access-code.ts
import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { cookieOptions } from './auth'
import { safeEqual } from './permissions'

/**
 * Optionaler Zugangscode pro Abstimmung (Poll.accessCode, siehe schema.prisma). Wer ihn
 * einmal richtig eingegeben hat, bekommt ein Cookie nur für den Pfad dieser Abstimmung.
 * Es enthält nicht den Code selbst, sondern einen Hash aus Abstimmung und Code - ändert
 * die Verwaltung den Code, verliert jedes alte Cookie damit von selbst seine Wirkung.
 *
 * Hält Fremde ohne Code fern, ist aber KEIN Schutz vor Mehrfachabstimmung: Alle
 * Berechtigten kennen denselben Code. Das sagt auch die Oberfläche beim Einstellen.
 */

const ACCESS_DAYS = 30
export const MAX_ACCESS_CODE_LENGTH = 50

/** Groß-/Kleinschreibung und Leerzeichen am Rand zählen nicht - Codes werden abgetippt oder diktiert. */
export function normalizeAccessCode(input: string): string {
  return input.trim().toLowerCase().slice(0, MAX_ACCESS_CODE_LENGTH)
}

function cookieName(pollId: string): string {
  return `poll_access_${pollId}`
}

function cookieValue(pollId: string, code: string): string {
  return createHash('sha256').update(`${pollId}\u0000${normalizeAccessCode(code)}`).digest('base64url')
}

/** Darf diese Anfrage die Abstimmung sehen? Ohne gesetzten Code immer ja. */
export async function hasPollAccess(poll: { id: string; accessCode: string | null }): Promise<boolean> {
  if (!poll.accessCode) return true
  const value = (await cookies()).get(cookieName(poll.id))?.value
  return !!value && safeEqual(value, cookieValue(poll.id, poll.accessCode))
}

/** Prüft einen eingegebenen Code (Konstantzeit) - die Drosselung übernimmt der Aufrufer. */
export function accessCodeMatches(poll: { accessCode: string | null }, input: string): boolean {
  if (!poll.accessCode) return true
  return safeEqual(normalizeAccessCode(input), normalizeAccessCode(poll.accessCode))
}

/** Nur aus Server Actions: merkt sich den richtig eingegebenen Code für diese Abstimmung. */
export async function grantPollAccess(poll: { id: string; accessCode: string | null }): Promise<void> {
  if (!poll.accessCode) return
  ;(await cookies()).set(cookieName(poll.id), cookieValue(poll.id, poll.accessCode), {
    ...cookieOptions(ACCESS_DAYS * 24 * 60 * 60),
    path: `/${poll.id}`
  })
}
