// app/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from './lib/prisma'
import { isCreateAllowed, unlockCreatePin } from './lib/create-pin'
import { getOrCreateVoterToken, getVoterToken } from './lib/voter'

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
      options: {
        create: uniqueOptions.map((label, position) => ({ label, position }))
      }
    }
  })

  redirect(`/${poll.id}/verwalten?token=${poll.creatorToken}&created=1`)
}

/**
 * Gibt (oder ändert) die eigene Stimme ab - identifiziert ausschließlich über das
 * anonyme voterToken-Cookie (siehe app/lib/voter.ts), kein Konto nötig. Ein Upsert
 * statt Insert erlaubt das Ändern der eigenen Wahl, solange die Abstimmung offen ist.
 * Bewusst als reines Formular ohne Client-JS gebaut (kein onSubmit-Handler) - daher
 * `void` statt eines Rückgabewerts mit Fehlermeldung; ungültige/verspätete Anfragen
 * (Poll inzwischen geschlossen o.ä.) werden wie an anderen Stellen dieses Projekts
 * stillschweigend ignoriert statt einer Fehlermeldung, das UI bietet ohnehin nur
 * gültige Optionen einer offenen Abstimmung zur Auswahl an.
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

  const voterToken = await getOrCreateVoterToken()

  await prisma.vote.upsert({
    where: { pollId_voterToken: { pollId, voterToken } },
    update: { optionId },
    create: { pollId, optionId, voterToken }
  })

  revalidatePath(`/${pollId}`)
}

/**
 * Liefert die optionId, für die dieser Browser (voterToken) bereits gestimmt hat -
 * oder null, wenn noch keine Stimme abgegeben wurde. Liest das Cookie nur, legt
 * keins an (siehe getVoterToken vs. getOrCreateVoterToken).
 */
export async function getMyVote(pollId: string): Promise<string | null> {
  const voterToken = await getVoterToken()
  if (!voterToken) return null

  const vote = await prisma.vote.findUnique({ where: { pollId_voterToken: { pollId, voterToken } } })
  return vote?.optionId ?? null
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
