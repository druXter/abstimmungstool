// app/lib/email-voters.ts
import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { cookieOptions, generateToken, hashToken } from './auth'
import { baseUrl } from './base-url'
import { normalizeEmail } from './form'

/**
 * Abstimmen mit bestätigter E-Mail-Adresse (Modus EMAIL, siehe EmailVoter in schema.prisma):
 *
 * 1. Auf der Abstimmungsseite die eigene Adresse eingeben (requestVoteEmail in
 *    app/actions.ts, gedrosselt - sonst wäre das Formular eine Mailschleuder).
 * 2. Der Einmal-Link führt auf /[pollId]/bestaetigen - dort bestätigt ein Knopfdruck
 *    (confirmVoteEmail). Ein bloßer Aufruf genügt bewusst nicht: Mail-Scanner öffnen Links
 *    vorab und würden ihn sonst verbrauchen.
 * 3. Danach hält der Browser ein Cookie nur für diese Abstimmung; die Stimme hängt an
 *    voterKey = email:<Adresse> - dieselbe Adresse von einem anderen Gerät ist also dieselbe
 *    Person.
 */

export const CONFIRM_LINK_HOURS = 24
const SESSION_DAYS = 30

function sessionCookie(pollId: string): string {
  return `poll_email_${pollId}`
}

/** Die Zeilen von Poll.allowedEmails: "@domain" oder einzelne Adressen, normalisiert. */
export function parseAllowedEmails(text: string | null): string[] {
  if (!text) return []
  return text
    .split(/[\r\n,;]+/)
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry !== '')
}

/** Darf diese (normalisierte) Adresse an der Abstimmung teilnehmen? Ohne Liste: jede. */
export function isEmailAllowed(email: string, allowedEmails: string | null): boolean {
  const entries = parseAllowedEmails(allowedEmails)
  if (entries.length === 0) return true
  const domain = email.slice(email.lastIndexOf('@'))
  return entries.some(entry => (entry.startsWith('@') ? entry === domain : entry === email))
}

/** Bereinigt die Eingabe der Verwaltung: eine Angabe pro Zeile, Ungültiges fällt weg. */
export function normalizeAllowedEmails(input: string): string | null {
  const entries = parseAllowedEmails(input).filter(entry =>
    entry.startsWith('@') ? /^@[^\s@]+\.[^\s@]+$/.test(entry) : normalizeEmail(entry) !== null
  )
  return entries.length > 0 ? [...new Set(entries)].slice(0, 500).join('\n') : null
}

/** Legt eine Bestätigungsanfrage an und gibt den Link für die Mail zurück. */
export async function createEmailConfirmation(pollId: string, email: string): Promise<string> {
  const token = generateToken()
  await prisma.emailVoter.create({
    data: { pollId, email, tokenHash: hashToken(token), tokenExpiresAt: new Date(Date.now() + CONFIRM_LINK_HOURS * 60 * 60 * 1000) }
  })
  return `${baseUrl()}/${pollId}/bestaetigen?t=${encodeURIComponent(token)}`
}

/** Eine noch gültige, unbenutzte Bestätigungsanfrage zu einem Link - nur für genau diese Abstimmung. */
export async function findPendingConfirmation(pollId: string, token: string | null | undefined) {
  if (!token || token.length > 100) return null
  const row = await prisma.emailVoter.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!row || row.pollId !== pollId || row.tokenExpiresAt < new Date()) return null
  return row
}

/** Nur aus Server Actions: löst den Einmal-Link ein und merkt sich die Adresse im Browser. */
export async function confirmEmailVoter(row: { id: string; pollId: string }): Promise<boolean> {
  const session = generateToken()
  // Bedingung im WHERE: Zwei gleichzeitige Klicks dürfen den Link nicht zweimal einlösen.
  const updated = await prisma.emailVoter.updateMany({
    where: { id: row.id, tokenHash: { not: null } },
    data: { tokenHash: null, sessionHash: hashToken(session), confirmedAt: new Date() }
  })
  if (updated.count === 0) return false
  ;(await cookies()).set(sessionCookie(row.pollId), session, { ...cookieOptions(SESSION_DAYS * 24 * 60 * 60), path: `/${row.pollId}` })
  return true
}

/** Die bestätigte Adresse dieses Browsers für eine Abstimmung, sonst null. */
export async function getConfirmedEmail(pollId: string): Promise<string | null> {
  const session = (await cookies()).get(sessionCookie(pollId))?.value
  if (!session) return null
  const row = await prisma.emailVoter.findUnique({ where: { sessionHash: hashToken(session) }, select: { pollId: true, email: true } })
  return row && row.pollId === pollId ? row.email : null
}

/** Nur aus Server Actions: "andere Adresse verwenden" - vergisst die Bestätigung in diesem Browser. */
export async function forgetConfirmedEmail(pollId: string): Promise<void> {
  const cookieStore = await cookies()
  const session = cookieStore.get(sessionCookie(pollId))?.value
  if (session) await prisma.emailVoter.updateMany({ where: { sessionHash: hashToken(session) }, data: { sessionHash: null } })
  cookieStore.set(sessionCookie(pollId), '', { ...cookieOptions(0), path: `/${pollId}` })
}
