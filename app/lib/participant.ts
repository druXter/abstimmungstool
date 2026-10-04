import { cache } from 'react'
import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { cookieOptions, generateToken, hashToken } from './auth'
import { getIdps, idpLabel } from './suite'

/**
 * Anmeldung mit einem Teilnehmendenkonto aus einem anderen Tool (suite-kit v0.2.0, siehe
 * schema.prisma Participant und README "Teilnehmendenkonten aus dem Verbund"). Strikt getrennt
 * von der Verwaltungs-Sitzung (app/lib/auth.ts): eigenes Cookie, eigene Tabelle - nichts hiervon
 * kann je eine Verwaltungsseite oder -aktion freischalten, es dient nur zum Abstimmen im Modus ACCOUNT.
 */

const isProduction = process.env.NODE_ENV === 'production'

/** `__Host-`-Präfix aus demselben Grund wie beim Session-Cookie (siehe app/lib/auth.ts). */
export const PARTICIPANT_COOKIE = isProduction ? '__Host-participant' : 'participant'
/** Bewusst kurz: Ein beim Anbieter gelöschtes Konto oder eine entzogene Freigabe wirkt so spätestens nach einem Tag. */
export const PARTICIPANT_SESSION_MS = 24 * 60 * 60 * 1000

/** Anbieter, deren Teilnehmendenkonten hier angenommen werden (`participants: true` in SUITE_IDPS). */
export function participantIdps() {
  return getIdps().filter(idp => idp.participants)
}

export type CurrentParticipant = { id: string; name: string; issuer: string; providerLabel: string }

/**
 * Die angemeldete teilnehmende Person dieses Browsers. Prüft bei JEDER Anfrage auch, ob ihr
 * Anbieter noch Teilnehmende liefern darf - wird `participants` in SUITE_IDPS abgeschaltet,
 * gelten bestehende Sitzungen sofort nicht mehr.
 */
export const getCurrentParticipant = cache(async (): Promise<CurrentParticipant | null> => {
  const token = (await cookies()).get(PARTICIPANT_COOKIE)?.value
  if (!token) return null
  const session = await prisma.participantSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, participant: { select: { id: true, name: true, issuer: true } } }
  })
  if (!session || session.expiresAt < new Date()) return null
  const idp = participantIdps().find(i => i.issuer === session.participant.issuer)
  if (!idp) return null
  return { ...session.participant, providerLabel: idpLabel(idp) }
})

/** Legt eine Sitzung an (der Aufrufer setzt das Cookie an seiner Antwort) und gibt Token und Cookie-Optionen zurück. */
export async function issueParticipantSession(participantId: string) {
  await prisma.participantSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  const token = generateToken()
  await prisma.participantSession.create({
    data: { tokenHash: hashToken(token), participantId, expiresAt: new Date(Date.now() + PARTICIPANT_SESSION_MS) }
  })
  return { name: PARTICIPANT_COOKIE, value: token, options: cookieOptions(PARTICIPANT_SESSION_MS / 1000) }
}

/** Abmelden: Sitzung löschen und Cookie entfernen (nur aus Server Actions). */
export async function destroyParticipantSession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(PARTICIPANT_COOKIE)?.value
  if (token) await prisma.participantSession.deleteMany({ where: { tokenHash: hashToken(token) } })
  cookieStore.set(PARTICIPANT_COOKIE, '', { ...cookieOptions(0), maxAge: 0 })
}
