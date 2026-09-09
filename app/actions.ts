// app/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from './lib/prisma'
import { isCreateAllowed, unlockCreatePin } from './lib/create-pin'
import { getOrCreateVoterToken } from './lib/voter'
import { verifyRsvpToken } from './lib/rsvp-verification'
import { sendManagementLinkEmail } from './lib/mail'
import { baseUrl } from './lib/base-url'

const MAX_OPTIONS = 25 // Muss mit dem `max`-Default in app/erstellen/options-field-list.tsx übereinstimmen
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
  const allowMultipleChoices = formData.get('allowMultipleChoices') === 'on'
  const creatorEmail = (formData.get('creatorEmail') as string || '').trim().slice(0, MAX_TEXT_LENGTH) || null

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
      allowMultipleChoices,
      creatorEmail,
      options: {
        create: uniqueOptions.map((label, position) => ({ label, position }))
      }
    }
  })

  const managementLink = `${baseUrl()}/${poll.id}/verwalten?token=${poll.creatorToken}`
  if (creatorEmail) {
    await sendManagementLinkEmail(creatorEmail, poll.title, managementLink, `${baseUrl()}/${poll.id}`).catch(() => {})
  }

  redirect(`/${poll.id}/verwalten?token=${poll.creatorToken}&created=1`)
}

/**
 * Bearbeitet eine bestehende Abstimmung - nur mit dem privaten creatorToken möglich
 * (gleiches Prinzip wie überall sonst in diesem Projekt). Optionen mit bereits
 * abgegebenen Stimmen können umbenannt, aber NICHT gelöscht werden (ein entsprechender
 * Löschwunsch wird stillschweigend ignoriert) - das verhindert, versehentlich bereits
 * abgegebene Stimmen zu verwaisen/verlieren. Optionen ohne Stimmen dürfen frei entfernt
 * werden, neue können jederzeit ergänzt werden (bis MAX_OPTIONS insgesamt).
 */
export async function updatePoll(formData: FormData) {
  const pollId = formData.get('pollId') as string
  const token = formData.get('creatorToken') as string

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: { options: { include: { _count: { select: { votes: true } } } } }
  })
  if (!poll || poll.creatorToken !== token) return

  const title = (formData.get('title') as string || '').trim().slice(0, MAX_TEXT_LENGTH)
  if (title === '') return

  const description = (formData.get('description') as string || '').trim().slice(0, MAX_TEXT_LENGTH) || null
  const closesAtInput = formData.get('closesAt') as string
  const closesAt = closesAtInput ? new Date(closesAtInput) : null
  const requireRsvpVerification = formData.get('requireRsvpVerification') === 'on'
  const allowMultipleChoices = formData.get('allowMultipleChoices') === 'on'

  const existingIds = formData.getAll('existingOptionId') as string[]
  const existingLabels = formData.getAll('existingOptionLabel') as string[]
  const deleteIds = new Set(formData.getAll('deleteOptionId') as string[])

  const validExistingIds = new Set(poll.options.map(o => o.id))
  const optionsWithVotes = new Set(poll.options.filter(o => o._count.votes > 0).map(o => o.id))

  const keptOptions: { id: string; label: string }[] = []
  for (let i = 0; i < existingIds.length; i++) {
    const id = existingIds[i]
    if (!validExistingIds.has(id)) continue // gehört nicht zu diesem Poll - ignorieren
    if (deleteIds.has(id) && !optionsWithVotes.has(id)) continue // Löschen erlaubt, da keine Stimmen

    const label = (existingLabels[i] || '').trim().slice(0, MAX_TEXT_LENGTH)
    if (label === '') continue
    keptOptions.push({ id, label })
  }

  const newLabels = (formData.getAll('newOption') as string[])
    .map(o => o.trim().slice(0, MAX_TEXT_LENGTH))
    .filter(o => o !== '')
    .slice(0, MAX_OPTIONS - keptOptions.length)

  if (keptOptions.length + newLabels.length < 2) return

  await prisma.$transaction(async (tx) => {
    await tx.poll.update({
      where: { id: pollId },
      data: { title, description, closesAt, requireRsvpVerification, allowMultipleChoices }
    })

    const keptIds = new Set(keptOptions.map(o => o.id))
    const toDelete = poll.options.filter(o => !keptIds.has(o.id) && !optionsWithVotes.has(o.id))
    for (const opt of toDelete) {
      await tx.pollOption.delete({ where: { id: opt.id } })
    }

    for (let i = 0; i < keptOptions.length; i++) {
      await tx.pollOption.update({ where: { id: keptOptions[i].id }, data: { label: keptOptions[i].label, position: i } })
    }

    for (let i = 0; i < newLabels.length; i++) {
      await tx.pollOption.create({ data: { pollId, label: newLabels[i], position: keptOptions.length + i } })
    }
  })

  revalidatePath(`/${pollId}`)
  redirect(`/${pollId}/verwalten?token=${token}&saved=1`)
}

/**
 * Ersetzt die komplette Stimmen-Auswahl EINER Identität (voterToken ODER
 * verifiedEmail - immer genau eine der beiden, nie beide, siehe schema.prisma) für
 * einen Poll durch die übergebene Options-Liste: entfernt nicht mehr gewählte
 * Optionen, legt neu gewählte an, lässt unveränderte unangetastet (kein Duplikat).
 * Funktioniert identisch für Einzel- und Mehrfachauswahl-Abstimmungen - der einzige
 * Unterschied ist, wie viele Einträge `optionIds` hat.
 */
async function replaceVotes(pollId: string, voterToken: string | null, verifiedEmail: string | null, optionIds: string[]) {
  const identityWhere = voterToken ? { voterToken } : { verifiedEmail: verifiedEmail! }

  await prisma.vote.deleteMany({
    where: { pollId, ...identityWhere, optionId: { notIn: optionIds } }
  })

  for (const optionId of optionIds) {
    if (voterToken) {
      await prisma.vote.upsert({
        where: { pollId_voterToken_optionId: { pollId, voterToken, optionId } },
        update: {},
        create: { pollId, optionId, voterToken }
      })
    } else {
      await prisma.vote.upsert({
        where: { pollId_verifiedEmail_optionId: { pollId, verifiedEmail: verifiedEmail!, optionId } },
        update: {},
        create: { pollId, optionId, verifiedEmail: verifiedEmail! }
      })
    }
  }
}

/**
 * Gibt (oder ändert) die eigene Stimme ab - bei Poll.allowMultipleChoices können
 * mehrere Optionen gleichzeitig gewählt werden (das Formular schickt dann mehrere
 * `optionId`-Werte, siehe `formData.getAll`). Zwei Identitäts-Modi, je nach
 * Poll.requireRsvpVerification (siehe schema.prisma für die Begründung):
 * - Standard: anonymes voterToken-Cookie (siehe app/lib/voter.ts), kein Konto nötig.
 * - Bei requireRsvpVerification: verifizierte E-Mail aus einem von rsvp-app
 *   signierten Token (siehe app/lib/rsvp-verification.ts) - fehlt ein gültiger
 *   Token, wird die Stimme abgelehnt (fail-closed), es gibt bewusst KEINEN
 *   anonymen Fallback, sonst wäre die "eine Stimme pro Person"-Garantie wertlos.
 * Bewusst als reines Formular ohne Client-JS gebaut (kein onSubmit-Handler) - daher
 * `void` statt eines Rückgabewerts mit Fehlermeldung; ungültige/verspätete Anfragen
 * werden wie an anderen Stellen dieses Projekts stillschweigend ignoriert statt
 * einer Fehlermeldung, das UI bietet ohnehin nur gültige Optionen an.
 */
export async function castVote(formData: FormData): Promise<void> {
  const pollId = formData.get('pollId') as string
  const rawOptionIds = formData.getAll('optionId') as string[]
  if (!pollId || rawOptionIds.length === 0) return

  const poll = await prisma.poll.findUnique({ where: { id: pollId }, include: { options: true } })
  if (!poll) return

  const isClosed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < new Date())
  if (isClosed) return

  // Nur Optionen akzeptieren, die tatsächlich zu diesem Poll gehören - schützt gegen
  // manipulierte optionId-Werte aus einem fremden Poll.
  const validOptionIds = new Set(poll.options.map(o => o.id))
  let selectedOptionIds = [...new Set(rawOptionIds)].filter(id => validOptionIds.has(id))
  if (selectedOptionIds.length === 0) return

  // Bei einer Einzelauswahl-Abstimmung serverseitig auf höchstens eine Option kappen,
  // selbst wenn ein manipulierter Client mehrere optionId-Werte schickt.
  if (!poll.allowMultipleChoices) {
    selectedOptionIds = [selectedOptionIds[0]]
  }

  if (poll.requireRsvpVerification) {
    const verifyToken = formData.get('verifyToken') as string
    const identity = verifyRsvpToken(verifyToken, pollId)
    if (!identity) return // Kein gültiger Token -> keine Stimme, kein anonymer Fallback.

    await replaceVotes(pollId, null, identity.email, selectedOptionIds)
  } else {
    const voterToken = await getOrCreateVoterToken()
    await replaceVotes(pollId, voterToken, null, selectedOptionIds)
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
