// app/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from './lib/prisma'
import { isCreateAllowed, unlockCreatePin } from './lib/create-pin'
import { getOrCreateVoterToken } from './lib/voter'
import { verifyRsvpToken } from './lib/rsvp-verification'

const MAX_OPTIONS = 20
const MAX_TEXT_LENGTH = 200

/**
 * Prüft die gemeinsame Anlege-PIN und setzt bei Erfolg das Freischalt-Cookie
 * (siehe app/lib/create-pin.ts). Server-seitig entscheidend - die Client-Anzeige
 * des Formulars ist nur UX, kein Sicherheitsmechanismus.
 */
export async function verifyCreatePin(formData: FormData) {
  const pin = formData.get('pin') as string
  const ok = await unlockCreatePin(pin)
  if (!ok) {
    redirect('/erstellen?error=1')
  }
  redirect('/erstellen')
}

/**
 * Legt eine neue Abstimmung an. Prüft die Anlege-Berechtigung server-seitig erneut
 * (siehe isCreateAllowed) statt sich auf die Formular-Sichtbarkeit zu verlassen -
 * ein direkter POST ohne gültiges Cookie darf niemals etwas anlegen.
 */
export async function createPoll(formData: FormData) {
  if (!(await isCreateAllowed())) return

  const title = (formData.get('title') as string || '').trim().slice(0, MAX_TEXT_LENGTH)
  const description = (formData.get('description') as string || '').trim().slice(0, MAX_TEXT_LENGTH) || null
  const closesAtInput = formData.get('closesAt') as string
  const closesAt = closesAtInput ? new Date(closesAtInput) : null
  const requireRsvpVerification = formData.get('requireRsvpVerification') === 'on'

  const rawOptions = formData.getAll('option') as string[]
  const options = rawOptions
    .map(o => o.trim().slice(0, MAX_TEXT_LENGTH))
    .filter(o => o !== '')
    .slice(0, MAX_OPTIONS)

  // Doppelte Optionen entfernen (z.B. versehentlich zweimal "Pizza") - sonst könnten
  // Stimmen für augenscheinlich dieselbe Option auf zwei Zeilen verteilt werden.
  const uniqueOptions = [...new Set(options)]

  if (title === '' || uniqueOptions.length < 2) return

  const poll = await prisma.poll.create({
    data: {
      title,
      description,
      closesAt,
      requireRsvpVerification,
      options: {
        create: uniqueOptions.map((label, position) => ({ label, position }))
      }
    }
  })

  redirect(`/${poll.id}/verwalten?token=${poll.creatorToken}&created=1`)
}

/**
 * Gibt (oder ändert) die eigene Stimme ab. Zwei Identitäts-Modi, je nach
 * Poll.requireRsvpVerification (siehe schema.prisma für die Begründung):
 * - Standard: anonymes voterToken-Cookie (siehe app/lib/voter.ts), kein Konto nötig.
 * - Bei requireRsvpVerification: verifizierte E-Mail aus einem von rsvp-app
 *   signierten Token (siehe app/lib/rsvp-verification.ts) - fehlt ein gültiger
 *   Token, wird die Stimme abgelehnt (fail-closed), es gibt bewusst KEINEN
 *   anonymen Fallback, sonst wäre die "eine Stimme pro Person"-Garantie wertlos.
 * Ein Upsert statt Insert erlaubt in beiden Modi das Ändern der eigenen Wahl,
 * solange die Abstimmung offen ist.
 * Bewusst als reines Formular ohne Client-JS gebaut (kein onSubmit-Handler) - daher
 * `void` statt eines Rückgabewerts mit Fehlermeldung; ungültige/verspätete Anfragen
 * werden wie an anderen Stellen dieses Projekts stillschweigend ignoriert statt
 * einer Fehlermeldung, das UI bietet ohnehin nur gültige Optionen an.
 */
export async function castVote(formData: FormData): Promise<void> {
  const pollId = formData.get('pollId') as string
  const optionId = formData.get('optionId') as string
  if (!pollId || !optionId) return

  const poll = await prisma.poll.findUnique({ where: { id: pollId } })
  if (!poll) return

  const isClosed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < new Date())
  if (isClosed) return

  const option = await prisma.pollOption.findUnique({ where: { id: optionId } })
  if (!option || option.pollId !== pollId) return

  if (poll.requireRsvpVerification) {
    const verifyToken = formData.get('verifyToken') as string
    const identity = verifyRsvpToken(verifyToken, pollId)
    if (!identity) return // Kein gültiger Token -> keine Stimme, kein anonymer Fallback.

    await prisma.vote.upsert({
      where: { pollId_verifiedEmail: { pollId, verifiedEmail: identity.email } },
      update: { optionId },
      create: { pollId, optionId, verifiedEmail: identity.email }
    })
  } else {
    const voterToken = await getOrCreateVoterToken()

    await prisma.vote.upsert({
      where: { pollId_voterToken: { pollId, voterToken } },
      update: { optionId },
      create: { pollId, optionId, voterToken }
    })
  }

  revalidatePath(`/${pollId}`)
}

/**
 * Schließt eine Abstimmung vorzeitig - nur mit dem privaten creatorToken möglich
 * (gleiches Prinzip wie Participant.editToken in rsvp-app: Besitz des Tokens ist
 * die einzige Berechtigung).
 */
export async function closePoll(formData: FormData) {
  const pollId = formData.get('pollId') as string
  const token = formData.get('creatorToken') as string

  const poll = await prisma.poll.findUnique({ where: { id: pollId } })
  if (!poll || poll.creatorToken !== token) return

  await prisma.poll.update({ where: { id: pollId }, data: { closedAt: new Date() } })
  revalidatePath(`/${pollId}`)
  redirect(`/${pollId}/verwalten?token=${token}`)
}

/**
 * Löscht eine Abstimmung unwiderruflich inkl. aller Stimmen und Optionen - nur mit
 * dem privaten creatorToken. Manuelle Löschreihenfolge wegen Fremdschlüsseln
 * (Vote → PollOption → Poll), gleiche Konvention wie in rsvp-app.
 */
export async function deletePoll(formData: FormData) {
  const pollId = formData.get('pollId') as string
  const token = formData.get('creatorToken') as string

  const poll = await prisma.poll.findUnique({ where: { id: pollId } })
  if (!poll || poll.creatorToken !== token) return

  await prisma.vote.deleteMany({ where: { pollId } })
  await prisma.pollOption.deleteMany({ where: { pollId } })
  await prisma.poll.delete({ where: { id: pollId } })

  redirect('/')
}
