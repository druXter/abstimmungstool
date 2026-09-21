// app/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { prisma } from './lib/prisma'
import { getOrCreateVoterToken } from './lib/voter'
import { verifyRsvpToken } from './lib/rsvp-verification'
import { notifyRsvpAppOfResult } from './lib/rsvp-notify'
import { getCurrentUser, requireUser } from './lib/auth'
import { canCreatePolls, getPollLevel, isAtLeast, safeEqual, type PollLevel } from './lib/permissions'
import { formString, normalizeEmail } from './lib/form'

const MAX_OPTIONS = 25 // Muss mit dem `max`-Default in app/erstellen/options-field-list.tsx übereinstimmen
const MAX_TEXT_LENGTH = 200

/**
 * Adresse der Verwaltungsseite. Bei Alt-Abstimmungen ohne Besitzer-Konto hängt daran
 * weiterhin der creatorToken (das ist dort die Berechtigung), bei Abstimmungen mit Konto
 * bewusst nicht - die Berechtigung kommt dort aus der Sitzung, nie aus der URL.
 */
function manageUrl(pollId: string, token: string, flag?: string): string {
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
async function loadManageablePoll(formData: FormData, required: PollLevel) {
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

/**
 * Legt eine neue Abstimmung an - nur für eingeloggte Konten mit Creator- oder Admin-
 * Rolle. Die Prüfung passiert hier auf dem Server; ein direkter POST ohne gültige
 * Sitzung darf niemals etwas anlegen (die Seite /erstellen blendet das Formular nur aus).
 */
export async function createPoll(formData: FormData) {
  const user = await requireUser('/erstellen')
  if (!canCreatePolls(user)) return

  const title = (formData.get('title') as string || '').trim().slice(0, MAX_TEXT_LENGTH)
  const description = (formData.get('description') as string || '').trim().slice(0, MAX_TEXT_LENGTH) || null
  const closesAtInput = formData.get('closesAt') as string
  const closesAt = closesAtInput ? new Date(closesAtInput) : null
  const requireRsvpVerification = formData.get('requireRsvpVerification') === 'on'
  const showVoterNames = formData.get('showVoterNames') === 'on'
  const allowMultipleChoices = formData.get('allowMultipleChoices') === 'on'

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
      showVoterNames,
      allowMultipleChoices,
      ownerId: user.id,
      options: {
        create: uniqueOptions.map((label, position) => ({ label, position }))
      }
    }
  })

  redirect(manageUrl(poll.id, '', 'created'))
}

/**
 * Bearbeitet eine bestehende Abstimmung - für Owner, Admin und per Freigabe hinzugefügte
 * Moderator:innen (bei Alt-Abstimmungen weiterhin mit dem privaten creatorToken).
 * Optionen mit bereits
 * abgegebenen Stimmen können umbenannt, aber NICHT gelöscht werden (ein entsprechender
 * Löschwunsch wird stillschweigend ignoriert) - das verhindert, versehentlich bereits
 * abgegebene Stimmen zu verwaisen/verlieren. Optionen ohne Stimmen dürfen frei entfernt
 * werden, neue können jederzeit ergänzt werden (bis MAX_OPTIONS insgesamt).
 */
export async function updatePoll(formData: FormData) {
  const ctx = await loadManageablePoll(formData, 'moderator')
  if (!ctx) return
  const { poll, token } = ctx
  const pollId = poll.id

  const title = (formData.get('title') as string || '').trim().slice(0, MAX_TEXT_LENGTH)
  if (title === '') return

  const description = (formData.get('description') as string || '').trim().slice(0, MAX_TEXT_LENGTH) || null
  const closesAtInput = formData.get('closesAt') as string
  const closesAt = closesAtInput ? new Date(closesAtInput) : null
  const requireRsvpVerification = formData.get('requireRsvpVerification') === 'on'
  const showVoterNames = formData.get('showVoterNames') === 'on'
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
      data: { title, description, closesAt, requireRsvpVerification, showVoterNames, allowMultipleChoices }
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
  redirect(manageUrl(pollId, token, 'saved'))
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
    if (!identity.attending) return // Aktuell abgesagt -> keine Stimme, siehe [pollId]/page.tsx für die UI-Meldung.

    await replaceVotes(pollId, null, identity.email, selectedOptionIds)
  } else {
    const voterToken = await getOrCreateVoterToken()
    await replaceVotes(pollId, voterToken, null, selectedOptionIds)
  }

  revalidatePath(`/${pollId}`)
}

/**
 * Schließt eine Abstimmung vorzeitig - für Owner, Admin und Moderator:innen mit Freigabe
 * (bei Alt-Abstimmungen mit dem creatorToken).
 */
export async function closePoll(formData: FormData) {
  const ctx = await loadManageablePoll(formData, 'moderator')
  if (!ctx) return
  const { poll, token } = ctx

  await prisma.poll.update({ where: { id: poll.id }, data: { closedAt: new Date() } })
  await notifyRsvpAppOfResult(poll.id).catch(() => {})
  revalidatePath(`/${poll.id}`)
  redirect(manageUrl(poll.id, token))
}

/**
 * Löscht eine Abstimmung unwiderruflich inkl. aller Stimmen und Optionen - nur Owner und
 * Admin (bei Alt-Abstimmungen mit dem creatorToken), NICHT Moderator:innen mit Freigabe.
 * Manuelle Löschreihenfolge wegen Fremdschlüsseln (Vote → PollOption → Poll), gleiche
 * Konvention wie in rsvp-app; Freigaben verschwinden per Cascade mit der Abstimmung.
 */
export async function deletePoll(formData: FormData) {
  const ctx = await loadManageablePoll(formData, 'owner')
  if (!ctx) return
  const pollId = ctx.poll.id

  await prisma.vote.deleteMany({ where: { pollId } })
  await prisma.pollOption.deleteMany({ where: { pollId } })
  await prisma.poll.delete({ where: { id: pollId } })

  redirect('/meine-abstimmungen')
}

/**
 * Gibt einer Abstimmung ein weiteres BESTEHENDES Konto (per E-Mail) zum gemeinsamen
 * Moderieren frei. Nur Owner und Admin. Legt nie ein Konto an - wer noch keins hat, muss
 * erst eingeladen werden oder sich einmal über ein verbundenes Tool anmelden. Die
 * Fehlermeldung "nicht gefunden" verrät nur eingeloggten Owner:innen, ob eine Adresse
 * ein Konto hat - das ist beabsichtigt, sonst wäre Teilen kaum bedienbar.
 */
export async function sharePoll(formData: FormData) {
  const ctx = await loadManageablePoll(formData, 'owner')
  // Alt-Abstimmungen ohne Besitzer-Konto lassen sich nicht teilen - erst mit einem Konto übernehmen.
  if (!ctx || !ctx.poll.ownerId) return
  const { poll } = ctx

  const email = normalizeEmail(formString(formData, 'email', 254))
  const target = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null
  if (!target) redirect(`${manageUrl(poll.id, '')}?shareError=notfound`)
  if (target.id === poll.ownerId) redirect(`${manageUrl(poll.id, '')}?shareError=owner`)

  await prisma.pollAccess.upsert({
    where: { pollId_userId: { pollId: poll.id, userId: target.id } },
    update: {},
    create: { pollId: poll.id, userId: target.id }
  })

  revalidatePath(`/${poll.id}/verwalten`)
  redirect(manageUrl(poll.id, '', 'shared'))
}

/** Nimmt eine Freigabe wieder zurück. Nur Owner und Admin der betroffenen Abstimmung. */
export async function unsharePoll(formData: FormData) {
  const access = await prisma.pollAccess.findUnique({
    where: { id: formString(formData, 'accessId', 50) },
    include: { poll: true }
  })
  if (!access) return

  const level = await getPollLevel(access.poll, { user: await getCurrentUser() })
  if (!isAtLeast(level, 'owner')) return

  await prisma.pollAccess.delete({ where: { id: access.id } })
  revalidatePath(`/${access.pollId}/verwalten`)
}

/**
 * Ordnet eine Alt-Abstimmung (angelegt vor Einführung der Konten, nur per creatorToken
 * verwaltbar) dem eingeloggten Konto zu. Der Token wird dabei ERNEUERT, damit jeder
 * früher weitergegebene oder per Mail verschickte Verwaltungs-Link wertlos wird - ab
 * jetzt gilt allein die Kontoberechtigung. Nur Konten, die Abstimmungen besitzen dürfen.
 */
export async function claimPoll(formData: FormData) {
  const pollId = formString(formData, 'pollId', 50)
  const token = formString(formData, 'creatorToken', 100)
  const user = await requireUser(`/${pollId}/verwalten?token=${encodeURIComponent(token)}`)
  if (!canCreatePolls(user)) return

  const poll = await prisma.poll.findUnique({ where: { id: pollId } })
  if (!poll || poll.ownerId || !safeEqual(token, poll.creatorToken)) return

  // Bedingung im WHERE: zwei gleichzeitige Übernahmen dürfen nicht beide "gewinnen".
  const claimed = await prisma.poll.updateMany({
    where: { id: pollId, ownerId: null },
    data: { ownerId: user.id, creatorToken: randomUUID(), creatorEmail: null }
  })
  if (claimed.count === 0) return

  redirect(manageUrl(pollId, '', 'claimed'))
}
