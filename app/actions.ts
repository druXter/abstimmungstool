// app/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { prisma } from './lib/prisma'
import { parseVoterIdentity, resolveVoter, type Voter } from './lib/voter-identity'
import { accessCodeMatches, grantPollAccess, hasPollAccess, MAX_ACCESS_CODE_LENGTH } from './lib/access-code'
import { accessCodeRule, clientIp, newVoterRule, reserve } from './lib/throttle'
import { notifyRsvpAppOfResult } from './lib/rsvp-notify'
import { getCurrentUser, requireUser } from './lib/auth'
import { canCreatePolls, getPollLevel, isAtLeast, safeEqual } from './lib/permissions'
import { identityFromForm, loadManageablePoll, manageUrl, pollUrl } from './lib/manage'
import { formString, normalizeEmail } from './lib/form'

const MAX_OPTIONS = 25 // Muss mit dem `max`-Default in app/erstellen/options-field-list.tsx übereinstimmen
const MAX_TEXT_LENGTH = 200
const MAX_VOTER_NAME_LENGTH = 60
const MAX_VOTERS_LIMIT = 10_000

/**
 * Die Einstellungen, die Anlegen und Bearbeiten gemeinsam haben (alles außer Titel,
 * Beschreibung, Optionen und Stimmmodus). Ungültiges fällt still auf "aus" zurück.
 */
function parsePollSettings(formData: FormData) {
  const closesAtInput = formString(formData, 'closesAt', 30)
  const closesAt = closesAtInput ? new Date(closesAtInput) : null
  const maxVoters = Number.parseInt(formString(formData, 'maxVoters', 10), 10)
  return {
    closesAt: closesAt && !Number.isNaN(closesAt.getTime()) ? closesAt : null,
    showVoterNames: formData.get('showVoterNames') === 'on',
    allowMultipleChoices: formData.get('allowMultipleChoices') === 'on',
    requireVoterName: formData.get('requireVoterName') === 'on',
    maxVoters: Number.isInteger(maxVoters) && maxVoters >= 1 ? Math.min(maxVoters, MAX_VOTERS_LIMIT) : null,
    accessCode: formString(formData, 'accessCode', MAX_ACCESS_CODE_LENGTH) || null
  }
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
  const voterIdentity = parseVoterIdentity(formData.get('voterIdentity'))
  const secretBallot = voterIdentity === 'LINK' && formData.get('secretBallot') === 'on'
  const settings = parsePollSettings(formData)

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
      voterIdentity,
      secretBallot,
      ...settings,
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
  const settings = parsePollSettings(formData)

  const existingIds = formData.getAll('existingOptionId') as string[]
  const existingLabels = formData.getAll('existingOptionLabel') as string[]
  const deleteIds = new Set(formData.getAll('deleteOptionId') as string[])

  const validExistingIds = new Set(poll.options.map(o => o.id))
  const optionsWithVotes = new Set(poll.options.filter(o => o._count.votes > 0).map(o => o.id))
  // Der Stimmmodus ist gesperrt, sobald jemand abgestimmt hat - sonst stünden Stimmen
  // verschiedener Identitätsarten nebeneinander, und die bisherigen könnte niemand mehr ändern.
  const locked = optionsWithVotes.size > 0
  const voterIdentity = locked ? poll.voterIdentity : parseVoterIdentity(formData.get('voterIdentity'))
  // Geheime Wahl ebenso: Ein Umschalten würde bestehende Stimmen unauffindbar bzw. zuordenbar machen.
  const secretBallot = locked ? poll.secretBallot : voterIdentity === 'LINK' && formData.get('secretBallot') === 'on'

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
      data: { title, description, voterIdentity, secretBallot, ...settings }
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
 * Ersetzt die komplette Stimmen-Auswahl EINER Identität für einen Poll durch die
 * übergebene Options-Liste: entfernt nicht mehr gewählte Optionen, legt neu gewählte an,
 * lässt unveränderte unangetastet (kein Duplikat, siehe Vote.@@unique). Funktioniert
 * identisch für Einzel- und Mehrfachauswahl-Abstimmungen - der einzige Unterschied ist,
 * wie viele Einträge `optionIds` hat.
 *
 * In einer Transaktion: Zwei gleichzeitige Abgaben derselben Person hinterlassen nie eine
 * Mischung beider Auswahlen, und die Höchstzahl (Poll.maxVoters) wird in derselben
 * Transaktion geprüft, in der die neue Person dazukommt. Gibt false zurück, wenn sie voll ist.
 */
async function replaceVotes(pollId: string, voter: Voter, optionIds: string[], maxVoters: number | null): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    if (maxVoters !== null && (await tx.vote.count({ where: { pollId, voterKey: voter.key } })) === 0) {
      const voters = await tx.vote.groupBy({ by: ['voterKey'], where: { pollId } })
      if (voters.length >= maxVoters) return false
    }

    await tx.vote.deleteMany({
      where: { pollId, voterKey: voter.key, optionId: { notIn: optionIds } }
    })
    for (const optionId of optionIds) {
      await tx.vote.upsert({
        where: { pollId_voterKey_optionId: { pollId, voterKey: voter.key, optionId } },
        update: { voterName: voter.name },
        create: {
          pollId, optionId, identityKind: voter.kind, voterKey: voter.key, voterName: voter.name,
          // Geheime Wahl: weder Zeitstempel noch zeitlich sortierbare cuid, sonst ließe sich die
          // Stimme über den Zeitpunkt doch wieder einem Link zuordnen (siehe app/lib/voter-links.ts).
          ...(voter.secret ? { id: randomUUID(), createdAt: new Date(0) } : {})
        }
      })
    }
    if (voter.linkId) {
      await tx.voterLink.updateMany({ where: { id: voter.linkId, hasVoted: false }, data: { hasVoted: true } })
    }
    return true
  })
}

/**
 * Gibt (oder ändert) die eigene Stimme ab - bei Poll.allowMultipleChoices können
 * mehrere Optionen gleichzeitig gewählt werden (das Formular schickt dann mehrere
 * `optionId`-Werte, siehe `formData.getAll`). Wer abstimmt, entscheidet allein
 * resolveVoter (app/lib/voter-identity.ts) anhand von Poll.voterIdentity - blockiert es
 * (z.B. Modus RSVP ohne gültigen Token), wird die Stimme abgelehnt (fail-closed), es gibt
 * bewusst KEINEN anonymen Fallback, sonst wäre die "eine Stimme pro Person"-Garantie wertlos.
 *
 * Reihenfolge der Prüfungen: offen -> Zugangscode -> gültige Optionen -> Identität ->
 * ggf. Pflichtname -> für NEUE Personen Drosselung (nur Cookie-Modus) und Höchstzahl.
 * Was die Oberfläche ohnehin verhindert (geschlossen, kein Code, falsche Option), wird
 * still ignoriert; Drosselung und Höchstzahl kann man nicht vorher sehen, daher dort ein
 * Hinweis per Weiterleitung. Bewusst als reines Formular ohne Client-JS gebaut.
 */
export async function castVote(formData: FormData): Promise<void> {
  const pollId = formString(formData, 'pollId', 50)
  const rawOptionIds = formData.getAll('optionId').filter((v): v is string => typeof v === 'string')
  if (!pollId || rawOptionIds.length === 0) return

  const poll = await prisma.poll.findUnique({ where: { id: pollId }, include: { options: true } })
  if (!poll) return

  const isClosed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < new Date())
  if (isClosed) return
  if (!(await hasPollAccess(poll))) return

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

  const identity = identityFromForm(formData)
  const { voter, block } = await resolveVoter(poll, identity, { create: true })
  if (block || !voter) return

  if (poll.voterIdentity === 'COOKIE' && poll.requireVoterName) {
    const name = formString(formData, 'voterName', MAX_VOTER_NAME_LENGTH)
    if (!name) return
    voter.name = name
  }

  const isNewVoter = (await prisma.vote.count({ where: { pollId, voterKey: voter.key } })) === 0
  if (isNewVoter && poll.voterIdentity === 'COOKIE') {
    // Ohne erkennbare IP (kein Proxy-Header) wird nicht gedrosselt - sonst teilten sich alle
    // Besucher EINEN Zähler. Wer den Proxy umgehen kann, könnte den Header ohnehin selbst setzen.
    const ip = await clientIp()
    if (ip !== 'unknown' && !(await reserve([newVoterRule(ip, pollId)]))) {
      redirect(pollUrl(pollId, identity, 'gedrosselt'))
    }
  }

  if (!(await replaceVotes(pollId, voter, selectedOptionIds, poll.maxVoters))) {
    redirect(pollUrl(pollId, identity, 'voll'))
  }
  revalidatePath(`/${pollId}`)
}

/**
 * Zugangscode einer Abstimmung eingeben (siehe app/lib/access-code.ts). Gedrosselt pro IP
 * und Abstimmung, damit sich kurze Codes nicht durchprobieren lassen.
 */
export async function unlockPoll(formData: FormData): Promise<void> {
  const pollId = formString(formData, 'pollId', 50)
  const identity = identityFromForm(formData)
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, select: { id: true, accessCode: true } })
  if (!poll) return

  if (!(await reserve([accessCodeRule(await clientIp(), poll.id)]))) redirect(pollUrl(poll.id, identity, 'code-gesperrt'))
  if (!accessCodeMatches(poll, formString(formData, 'accessCode', MAX_ACCESS_CODE_LENGTH))) {
    redirect(pollUrl(poll.id, identity, 'code-falsch'))
  }

  await grantPollAccess(poll)
  redirect(pollUrl(poll.id, identity))
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
  await prisma.voterLink.deleteMany({ where: { pollId } })
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
