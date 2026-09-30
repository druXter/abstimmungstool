// app/actions.ts
'use server'

import { redirect } from 'next/navigation'
import type { OptionKind, ResultsVisibility } from '@prisma/client'
import { parseDateOption, parseOptionKind } from './lib/date-options'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { prisma } from './lib/prisma'
import { parseVoterIdentity, resolveVoter, type Voter } from './lib/voter-identity'
import { accessCodeMatches, grantPollAccess, hasPollAccess, MAX_ACCESS_CODE_LENGTH } from './lib/access-code'
import { accessCodeRule, clientIp, newVoterRule, reserve, suggestionRule, voteEmailRules } from './lib/throttle'
import { confirmEmailVoter, CONFIRM_LINK_HOURS, createEmailConfirmation, findPendingConfirmation, forgetConfirmedEmail, isEmailAllowed, normalizeAllowedEmails } from './lib/email-voters'
import { isMailConfigured, sendVoteConfirmationEmail } from './lib/mail'
import { afterPollClosed } from './lib/poll-closed'
import { choiceLimits } from './lib/results'
import { getCurrentUser, requireUser } from './lib/auth'
import { canCreatePolls, getPollLevel, isAtLeast, safeEqual } from './lib/permissions'
import { identityFromForm, loadManageablePoll, manageUrl, pollUrl } from './lib/manage'
import { formString, normalizeEmail } from './lib/form'

const MAX_OPTIONS = 25 // Muss mit dem `max`-Default in app/erstellen/options-field-list.tsx übereinstimmen
const MAX_TEXT_LENGTH = 200
const MAX_VOTER_NAME_LENGTH = 60
const MAX_VOTERS_LIMIT = 10_000
const RESULTS_VISIBILITIES: readonly ResultsVisibility[] = ['ALWAYS', 'AFTER_VOTE', 'AFTER_CLOSE', 'MANAGERS']

/**
 * Die Einstellungen, die Anlegen und Bearbeiten gemeinsam haben (alles außer Titel,
 * Beschreibung, Optionen und Stimmmodus). Ungültiges fällt still auf "aus" zurück.
 */
function parsePollSettings(formData: FormData) {
  const closesAtInput = formString(formData, 'closesAt', 30)
  const closesAt = closesAtInput ? new Date(closesAtInput) : null
  const maxVoters = Number.parseInt(formString(formData, 'maxVoters', 10), 10)
  const quorum = Number.parseInt(formString(formData, 'quorum', 10), 10)
  const allowMultipleChoices = formData.get('allowMultipleChoices') === 'on'
  // Grenzen nur bei Mehrfachauswahl, und nur wenn sie zusammenpassen (min <= max).
  const minChoices = Number.parseInt(formString(formData, 'minChoices', 3), 10)
  const maxChoices = Number.parseInt(formString(formData, 'maxChoices', 3), 10)
  const min = allowMultipleChoices && Number.isInteger(minChoices) && minChoices >= 1 ? Math.min(minChoices, MAX_OPTIONS) : null
  const max = allowMultipleChoices && Number.isInteger(maxChoices) && maxChoices >= 1 ? Math.min(maxChoices, MAX_OPTIONS) : null
  const visibility = RESULTS_VISIBILITIES.find(v => v === formData.get('resultsVisibility')) ?? 'ALWAYS'
  return {
    closesAt: closesAt && !Number.isNaN(closesAt.getTime()) ? closesAt : null,
    showVoterNames: formData.get('showVoterNames') === 'on',
    allowMultipleChoices,
    minChoices: min !== null && max !== null && min > max ? null : min,
    maxChoices: max,
    resultsVisibility: visibility,
    allowVoterOptions: formData.get('allowVoterOptions') === 'on',
    voterOptionsNeedApproval: formData.get('voterOptionsNeedApproval') === 'on',
    requireVoterName: formData.get('requireVoterName') === 'on',
    maxVoters: Number.isInteger(maxVoters) && maxVoters >= 1 ? Math.min(maxVoters, MAX_VOTERS_LIMIT) : null,
    accessCode: formString(formData, 'accessCode', MAX_ACCESS_CODE_LENGTH) || null,
    allowedEmails: normalizeAllowedEmails(formString(formData, 'allowedEmails', 20_000)),
    quorum: Number.isInteger(quorum) && quorum >= 1 ? Math.min(quorum, MAX_VOTERS_LIMIT) : null,
    // Ohne Mailversand fehlt das Feld im Formular - dann die bisherige Einstellung nicht überschreiben.
    notifyOwnerOnClose: isMailConfigured() ? formData.get('notifyOwnerOnClose') === 'on' : undefined
  }
}

type OptionInput = { label: string; startsAt: Date | null }

/**
 * Liest eine Option aus dem Formular - Freitext oder (bei Terminabstimmungen) ein Datum,
 * aus dem das Label formatiert wird (app/lib/date-options.ts). Leer/ungültig -> null.
 */
function readOption(raw: FormDataEntryValue | undefined, kind: OptionKind): OptionInput | null {
  const value = typeof raw === 'string' ? raw.trim().slice(0, MAX_TEXT_LENGTH) : ''
  if (value === '') return null
  if (kind === 'TEXT') return { label: value, startsAt: null }
  return parseDateOption(value, kind)
}

/** Termine chronologisch, Freitext in der eingegebenen Reihenfolge. */
function inDisplayOrder<T extends OptionInput>(options: T[]): T[] {
  return options.every(o => o.startsAt)
    ? [...options].sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime())
    : options
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
  const optionKind = parseOptionKind(formData.get('optionKind'))

  const options = formData.getAll('option')
    .map(raw => readOption(raw, optionKind))
    .filter((o): o is OptionInput => o !== null)
    .slice(0, MAX_OPTIONS)

  // Doppelte Optionen entfernen (z.B. versehentlich zweimal "Pizza" oder derselbe Termin) -
  // sonst könnten Stimmen für augenscheinlich dieselbe Option auf zwei Zeilen verteilt werden.
  const uniqueOptions = inDisplayOrder(options.filter((o, i) => options.findIndex(other => other.label === o.label) === i))

  if (title === '' || uniqueOptions.length < 2) return

  const poll = await prisma.poll.create({
    data: {
      title,
      description,
      voterIdentity,
      secretBallot,
      optionKind,
      ...settings,
      ownerId: user.id,
      options: {
        create: uniqueOptions.map((option, position) => ({ ...option, position }))
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

  // Offene Vorschläge (approved = false) fasst Bearbeiten nicht an - sie stehen nicht im
  // Formular und würden sonst als "entfernt" gelöscht.
  const approvedOptions = poll.options.filter(o => o.approved)
  const validExistingIds = new Set(approvedOptions.map(o => o.id))
  const optionsWithVotes = new Set(approvedOptions.filter(o => o._count.votes > 0).map(o => o.id))
  // Der Stimmmodus ist gesperrt, sobald jemand abgestimmt hat - sonst stünden Stimmen
  // verschiedener Identitätsarten nebeneinander, und die bisherigen könnte niemand mehr ändern.
  const locked = optionsWithVotes.size > 0
  const voterIdentity = locked ? poll.voterIdentity : parseVoterIdentity(formData.get('voterIdentity'))
  // Geheime Wahl ebenso: Ein Umschalten würde bestehende Stimmen unauffindbar bzw. zuordenbar machen.
  const secretBallot = locked ? poll.secretBallot : voterIdentity === 'LINK' && formData.get('secretBallot') === 'on'

  // Die Optionsart steht seit dem Anlegen fest (sonst passten Labels und startsAt nicht zusammen).
  const keptOptions: (OptionInput & { id: string })[] = []
  for (let i = 0; i < existingIds.length; i++) {
    const id = existingIds[i]
    if (!validExistingIds.has(id)) continue // gehört nicht zu diesem Poll - ignorieren
    if (deleteIds.has(id) && !optionsWithVotes.has(id)) continue // Löschen erlaubt, da keine Stimmen

    const option = readOption(existingLabels[i], poll.optionKind)
    if (!option) continue
    keptOptions.push({ id, ...option })
  }

  const newOptions = formData.getAll('newOption')
    .map(raw => readOption(raw, poll.optionKind))
    .filter((o): o is OptionInput => o !== null)
    .slice(0, MAX_OPTIONS - keptOptions.length - (poll.options.length - approvedOptions.length))

  if (keptOptions.length + newOptions.length < 2) return
  const ordered: (OptionInput & { id?: string })[] = inDisplayOrder([...keptOptions, ...newOptions])

  await prisma.$transaction(async (tx) => {
    await tx.poll.update({
      where: { id: pollId },
      data: { title, description, voterIdentity, secretBallot, ...settings }
    })

    const keptIds = new Set(keptOptions.map(o => o.id))
    const toDelete = approvedOptions.filter(o => !keptIds.has(o.id) && !optionsWithVotes.has(o.id))
    for (const opt of toDelete) {
      await tx.pollOption.delete({ where: { id: opt.id } })
    }

    for (const [position, { id, label, startsAt }] of ordered.entries()) {
      if (id) await tx.pollOption.update({ where: { id }, data: { label, startsAt, position } })
      else await tx.pollOption.create({ data: { pollId, label, startsAt, position } })
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

  // Nur freigegebene Optionen - ein noch offener Vorschlag ist keine wählbare Option.
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, include: { options: { where: { approved: true } } } })
  if (!poll) return

  const isClosed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < new Date())
  if (isClosed) return
  if (!(await hasPollAccess(poll))) return

  // Nur Optionen akzeptieren, die tatsächlich zu diesem Poll gehören - schützt gegen
  // manipulierte optionId-Werte aus einem fremden Poll.
  const validOptionIds = new Set(poll.options.map(o => o.id))
  let selectedOptionIds = [...new Set(rawOptionIds)].filter(id => validOptionIds.has(id))
  if (selectedOptionIds.length === 0) return

  const identity = identityFromForm(formData)

  // Bei einer Einzelauswahl-Abstimmung serverseitig auf höchstens eine Option kappen,
  // selbst wenn ein manipulierter Client mehrere optionId-Werte schickt. Bei Mehrfachauswahl
  // die Grenzen prüfen (ohne JavaScript kann die Seite sie nicht erzwingen, daher ein Hinweis).
  if (!poll.allowMultipleChoices) {
    selectedOptionIds = [selectedOptionIds[0]]
  } else {
    const { min, max } = choiceLimits(poll)
    if (selectedOptionIds.length < min || selectedOptionIds.length > max) redirect(pollUrl(pollId, identity, 'auswahl'))
  }

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
  // Auf die Seite ohne ?hinweis= - sonst stünde eine frühere Ablehnung (z.B. falsche Anzahl)
  // auch nach der erfolgreichen Stimme noch da. Identitäts-Parameter bleiben erhalten.
  redirect(pollUrl(pollId, identity))
}

/** Termine nach dem Hinzufügen neuer Optionen wieder chronologisch durchnummerieren. */
async function renumberDateOptions(pollId: string) {
  const options = await prisma.pollOption.findMany({ where: { pollId }, orderBy: [{ startsAt: 'asc' }, { position: 'asc' }], select: { id: true } })
  await prisma.$transaction(options.map((o, position) => prisma.pollOption.update({ where: { id: o.id }, data: { position } })))
}

/**
 * Teilnehmende schlagen eine Option vor (Poll.allowVoterOptions). Wer vorschlägt, muss
 * abstimmen dürfen (gleiche Identitätsprüfung wie castVote); gedrosselt pro IP und
 * Abstimmung. Mit voterOptionsNeedApproval landet der Vorschlag erst bei der Verwaltung
 * (approved = false), sonst sofort in der Liste. Wer vorgeschlagen hat, wird nicht gespeichert.
 */
export async function suggestOption(formData: FormData): Promise<void> {
  const pollId = formString(formData, 'pollId', 50)
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, include: { options: { select: { label: true } } } })
  if (!poll || !poll.allowVoterOptions) return
  const isClosed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < new Date())
  if (isClosed || !(await hasPollAccess(poll))) return

  const identity = identityFromForm(formData)
  const { block } = await resolveVoter(poll, identity, { create: false })
  if (block) return

  const option = readOption(formData.get('suggestion') ?? undefined, poll.optionKind)
  if (!option) redirect(pollUrl(pollId, identity, 'vorschlag-ungueltig'))
  if (poll.options.some(o => o.label === option.label)) redirect(pollUrl(pollId, identity, 'vorschlag-doppelt'))
  if (poll.options.length >= MAX_OPTIONS) redirect(pollUrl(pollId, identity, 'vorschlag-voll'))
  if (!(await reserve([suggestionRule(await clientIp(), pollId)]))) redirect(pollUrl(pollId, identity, 'vorschlag-gedrosselt'))

  await prisma.pollOption.create({
    data: { pollId, ...option, position: poll.options.length, approved: !poll.voterOptionsNeedApproval }
  })
  if (poll.optionKind !== 'TEXT') await renumberDateOptions(pollId)
  revalidatePath(`/${pollId}`)
  revalidatePath(`/${pollId}/verwalten`)
  redirect(pollUrl(pollId, identity, poll.voterOptionsNeedApproval ? 'vorschlag-wartet' : 'vorschlag-da'))
}

/** Verwaltung: einen offenen Vorschlag freigeben (intent=approve) oder ablehnen (intent=reject). */
export async function reviewSuggestion(formData: FormData): Promise<void> {
  const ctx = await loadManageablePoll(formData, 'moderator')
  if (!ctx) return
  const option = ctx.poll.options.find(o => o.id === formString(formData, 'optionId', 50) && !o.approved)
  if (!option) return

  if (formString(formData, 'intent', 10) === 'approve') {
    await prisma.pollOption.update({ where: { id: option.id }, data: { approved: true } })
  } else {
    // Ein offener Vorschlag kann keine Stimmen haben (castVote nimmt nur freigegebene Optionen).
    await prisma.pollOption.delete({ where: { id: option.id } })
  }
  revalidatePath(`/${ctx.poll.id}`)
  redirect(manageUrl(ctx.poll.id, ctx.token))
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
 * Modus EMAIL, Schritt 1: Bestätigungslink an die eingegebene Adresse schicken (siehe
 * app/lib/email-voters.ts). Gedrosselt pro IP und pro Adresse+Abstimmung, sonst wäre das
 * Formular eine Mailschleuder für fremde Postfächer. Die Rückmeldung verrät bewusst nicht,
 * ob die Adresse schon bestätigt ist.
 */
export async function requestVoteEmail(formData: FormData): Promise<void> {
  const pollId = formString(formData, 'pollId', 50)
  const poll = await prisma.poll.findUnique({ where: { id: pollId } })
  if (!poll || poll.voterIdentity !== 'EMAIL') return
  const isClosed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < new Date())
  if (isClosed || !(await hasPollAccess(poll))) return

  const email = normalizeEmail(formString(formData, 'email', 254))
  if (!email) redirect(pollUrl(pollId, {}, 'mail-ungueltig'))
  if (!isEmailAllowed(email, poll.allowedEmails)) redirect(pollUrl(pollId, {}, 'mail-nicht-zugelassen'))
  if (!(await reserve(voteEmailRules(await clientIp(), email, pollId)))) redirect(pollUrl(pollId, {}, 'mail-gedrosselt'))

  const link = await createEmailConfirmation(pollId, email)
  const sent = await sendVoteConfirmationEmail(email, poll.title, link, CONFIRM_LINK_HOURS)
  redirect(pollUrl(pollId, {}, sent ? 'mail-gesendet' : 'mail-fehler'))
}

/** Modus EMAIL, Schritt 2: Knopfdruck auf /[pollId]/bestaetigen löst den Einmal-Link ein. */
export async function confirmVoteEmail(formData: FormData): Promise<void> {
  const pollId = formString(formData, 'pollId', 50)
  const row = await findPendingConfirmation(pollId, formString(formData, 'token', 100))
  if (!row) redirect(`/${pollId}/bestaetigen`)
  if (!(await confirmEmailVoter(row))) redirect(`/${pollId}/bestaetigen`)
  redirect(pollUrl(pollId, {}, 'mail-bestaetigt'))
}

/** Modus EMAIL: "andere Adresse verwenden" - die bisherige Stimme bleibt der alten Adresse zugeordnet. */
export async function forgetVoteEmail(formData: FormData): Promise<void> {
  const pollId = formString(formData, 'pollId', 50)
  await forgetConfirmedEmail(pollId)
  redirect(`/${pollId}`)
}

/**
 * Schließt eine Abstimmung vorzeitig - für Owner, Admin und Moderator:innen mit Freigabe
 * (bei Alt-Abstimmungen mit dem creatorToken).
 */
export async function closePoll(formData: FormData) {
  const ctx = await loadManageablePoll(formData, 'moderator')
  if (!ctx) return
  const { poll, token } = ctx

  // Bedingung im WHERE: Nur wer die Abstimmung tatsächlich schließt, löst Meldung und Mail aus -
  // ein doppelt abgeschicktes Formular oder der gleichzeitige Cron nicht noch einmal.
  const closed = await prisma.poll.updateMany({ where: { id: poll.id, closedAt: null }, data: { closedAt: new Date() } })
  if (closed.count > 0) await afterPollClosed(poll.id)
  revalidatePath(`/${poll.id}`)
  redirect(manageUrl(poll.id, token))
}

/**
 * Legt eine Kopie als neue Abstimmung des eingeloggten Kontos an (wiederkehrende Runden):
 * Titel, Beschreibung, Optionen und Einstellungen - ohne Stimmen, Stimmlinks, bestätigte
 * Adressen, Freigaben und ohne Schließdatum (das alte läge meist in der Vergangenheit). Wer
 * die Vorlage mindestens moderieren darf und selbst Abstimmungen anlegen darf.
 */
export async function duplicatePoll(formData: FormData) {
  const ctx = await loadManageablePoll(formData, 'moderator')
  if (!ctx) return
  const user = await getCurrentUser()
  if (!user || !canCreatePolls(user)) return
  const source = ctx.poll

  const copy = await prisma.poll.create({
    data: {
      title: `${source.title} (Kopie)`.slice(0, MAX_TEXT_LENGTH),
      description: source.description,
      ownerId: user.id,
      voterIdentity: source.voterIdentity,
      secretBallot: source.secretBallot,
      showVoterNames: source.showVoterNames,
      allowMultipleChoices: source.allowMultipleChoices,
      requireVoterName: source.requireVoterName,
      maxVoters: source.maxVoters,
      accessCode: source.accessCode,
      allowedEmails: source.allowedEmails,
      quorum: source.quorum,
      notifyOwnerOnClose: source.notifyOwnerOnClose,
      resultsVisibility: source.resultsVisibility,
      allowVoterOptions: source.allowVoterOptions,
      voterOptionsNeedApproval: source.voterOptionsNeedApproval,
      minChoices: source.minChoices,
      maxChoices: source.maxChoices,
      optionKind: source.optionKind,
      options: {
        create: source.options.filter(o => o.approved).sort((a, b) => a.position - b.position).map((o, position) => ({ label: o.label, startsAt: o.startsAt, position }))
      }
    }
  })
  redirect(manageUrl(copy.id, '', 'duplicated'))
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
  await prisma.emailVoter.deleteMany({ where: { pollId } })
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
