// app/lib/manage.ts
import { prisma } from './prisma'
import { getCurrentUser } from './auth'
import { getPollLevel, isAtLeast, type PollLevel } from './permissions'
import { formString } from './form'
import type { IdentityParams } from './voter-identity'

// Bewusst KEINE 'use server'-Datei: Alles, was eine solche exportiert, ist von außen als
// Server Action aufrufbar - diese Helfer dürfen nur von Server Actions benutzt werden.

/**
 * Zurück auf die Abstimmungsseite, optional mit einem Hinweis (siehe NOTICES in
 * app/[pollId]/page.tsx). Identitäts-Nachweise aus der URL (rsvp-Klick-Token, persönlicher
 * Stimmlink) werden mitgenommen, sonst verlöre die Seite die Identität.
 */
export function pollUrl(pollId: string, identity: IdentityParams, notice?: string): string {
  const params = new URLSearchParams()
  if (identity.verifyToken) params.set('verify', identity.verifyToken)
  if (identity.linkToken) params.set('k', identity.linkToken)
  if (notice) params.set('hinweis', notice)
  const query = params.toString()
  return `/${pollId}${query ? `?${query}` : ''}`
}

/** Liest die Identitäts-Nachweise aus den versteckten Feldern eines Abstimm-/Code-Formulars. */
export function identityFromForm(formData: FormData): IdentityParams {
  return { verifyToken: formString(formData, 'verifyToken', 4000), linkToken: formString(formData, 'linkToken', 100) }
}

/**
 * Adresse der Verwaltungsseite. Bei Alt-Abstimmungen ohne Besitzer-Konto hängt daran
 * weiterhin der creatorToken (das ist dort die Berechtigung), bei Abstimmungen mit Konto
 * bewusst nicht - die Berechtigung kommt dort aus der Sitzung, nie aus der URL.
 */
export function manageUrl(pollId: string, token: string, flag?: string): string {
  const params = new URLSearchParams()
  if (token) params.set('token', token)
  if (flag) params.set(flag, '1')
  const query = params.toString()
  return `/${pollId}/verwalten${query ? `?${query}` : ''}`
}

/**
 * Lädt eine Abstimmung und prüft serverseitig, ob die aktuelle Anfrage sie mindestens auf
 * der geforderten Stufe verwalten darf (siehe app/lib/permissions.ts). Gibt null zurück,
 * wenn nicht - die Aufrufer ignorieren die Anfrage dann stillschweigend, wie im ganzen
 * Projekt. Jede verwaltende Server Action MUSS hierüber laufen: Eine Prüfung nur auf der
 * Seite schützt nicht vor einem direkt abgeschickten Formular.
 */
export async function loadManageablePoll(formData: FormData, required: PollLevel) {
  const pollId = formString(formData, 'pollId', 50)
  const token = formString(formData, 'creatorToken', 100)
  if (!pollId) return null

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: { options: { include: { _count: { select: { votes: true } } } } }
  })
  if (!poll) return null

  const level = await getPollLevel(poll, { user: await getCurrentUser(), token })
  if (!isAtLeast(level, required)) return null

  // Nur bei Alt-Abstimmungen wird der Token weitergereicht (siehe manageUrl).
  return { poll, token: poll.ownerId ? '' : token }
}

