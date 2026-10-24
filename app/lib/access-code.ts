// app/lib/access-code.ts
import { safeEqual } from 'suite-kit'
import { createHmac, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { cookieOptions } from './auth'
import { prisma } from './prisma'

/**
 * Optionaler Zugangscode pro Abstimmung (Poll.accessCode, siehe schema.prisma). Wer ihn
 * einmal richtig eingegeben hat, bekommt ein Cookie nur für den Pfad dieser Abstimmung.
 * Es enthält nicht den Code selbst, sondern einen HMAC über Abstimmung und Code mit einem zufälligen Schlüssel der
 * Abstimmung (Poll.accessCookieKey) - ändert die Verwaltung den Code, verliert jedes alte Cookie von selbst seine
 * Wirkung. Ohne geheimen Schlüssel könnte man das Cookie für jeden geratenen Code selbst berechnen und so die
 * Drosselung der Code-Eingabe umgehen.
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

type AccessPoll = { id: string; accessCode: string | null; accessCookieKey: string | null }

function cookieValue(poll: { id: string }, code: string, key: string): string {
  return createHmac('sha256', key).update(`${poll.id}\u0000${normalizeAccessCode(code)}`).digest('base64url')
}

/** Darf diese Anfrage die Abstimmung sehen? Ohne gesetzten Code immer ja. */
export async function hasPollAccess(poll: AccessPoll): Promise<boolean> {
  if (!poll.accessCode) return true
  if (!poll.accessCookieKey) return false
  const value = (await cookies()).get(cookieName(poll.id))?.value
  return !!value && safeEqual(value, cookieValue(poll, poll.accessCode, poll.accessCookieKey))
}

/** Prüft einen eingegebenen Code (Konstantzeit) - die Drosselung übernimmt der Aufrufer. */
export function accessCodeMatches(poll: { accessCode: string | null }, input: string): boolean {
  if (!poll.accessCode) return true
  return safeEqual(normalizeAccessCode(input), normalizeAccessCode(poll.accessCode))
}

/** Nur aus Server Actions: merkt sich den richtig eingegebenen Code für diese Abstimmung. */
export async function grantPollAccess(poll: AccessPoll): Promise<void> {
  if (!poll.accessCode) return
  let key = poll.accessCookieKey
  if (!key) {
    // Erster richtiger Code: Schlüssel anlegen (bedingt - bei gleichzeitigen Anfragen gewinnt einer, alle nutzen ihn).
    await prisma.poll.updateMany({ where: { id: poll.id, accessCookieKey: null }, data: { accessCookieKey: randomBytes(32).toString('base64url') } })
    key = (await prisma.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { accessCookieKey: true } })).accessCookieKey!
  }
  ;(await cookies()).set(cookieName(poll.id), cookieValue(poll, poll.accessCode, key), {
    ...cookieOptions(ACCESS_DAYS * 24 * 60 * 60),
    path: `/${poll.id}`
  })
}
