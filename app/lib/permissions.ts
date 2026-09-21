// app/lib/permissions.ts
import { timingSafeEqual } from 'node:crypto'
import { prisma } from './prisma'
import type { CurrentUser } from './auth'

export function canCreatePolls(user: CurrentUser): boolean {
  return user.role !== 'MODERATOR'
}

/** Konstantzeitvergleich für Tokens - `===` würde über die Antwortzeit verraten, wie viele Zeichen stimmen. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/**
 * owner:     alles (bearbeiten, schließen, löschen, teilen, Alt-Abstimmung übernehmen)
 * moderator: bearbeiten und schließen - nicht löschen, nicht weiter teilen
 */
export type PollLevel = 'owner' | 'moderator'

type PollRef = { id: string; ownerId: string | null; creatorToken: string }

/**
 * DIE zentrale Berechtigungsprüfung für eine Abstimmung - jede Seite und jede Server
 * Action zum Verwalten geht hierüber, damit "wer darf was" an genau einer Stelle steht.
 *
 * - Abstimmung MIT Besitzer-Konto: nur eingeloggte Konten (Owner, Admin oder per
 *   PollAccess geteilt). Der alte creatorToken wird hier bewusst IGNORIERT: Er wurde nie
 *   für diesen Zweck ausgegeben, und ein weiterhin gültiger Geheim-Link würde jede
 *   Rechteverwaltung (z.B. entzogene Freigaben) aushebeln.
 * - Alt-Abstimmung OHNE Besitzer: wie bisher per creatorToken (Besitz des Links ist die
 *   Berechtigung), zusätzlich für Admins.
 */
export async function getPollLevel(
  poll: PollRef,
  who: { user: CurrentUser | null; token?: string | null }
): Promise<PollLevel | null> {
  const { user, token } = who

  if (poll.ownerId) {
    if (!user) return null
    if (user.role === 'ADMIN' || user.id === poll.ownerId) return 'owner'
    const access = await prisma.pollAccess.findUnique({
      where: { pollId_userId: { pollId: poll.id, userId: user.id } },
      select: { id: true }
    })
    return access ? 'moderator' : null
  }

  if (user?.role === 'ADMIN') return 'owner'
  if (token && safeEqual(token, poll.creatorToken)) return 'owner'
  return null
}

export function isAtLeast(level: PollLevel | null, required: PollLevel): boolean {
  if (!level) return false
  return required === 'moderator' || level === 'owner'
}
