'use server'

// Sitzungen (Idee L7, docs/KONZEPT-SITZUNG.md): anlegen, Einstellungen, schnelle Abstimmungen, Rednerliste,
// Anwesenheit (Sitzungsleitung und selbst), Zeitplan und Tafel, Verknüpfung mit rsvp-app lösen, teilen, löschen. Jede
// verwaltende Action prüft die Rechte über getAssemblyLevel.
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from './lib/prisma'
import { generateToken, getCurrentUser, requireUser } from './lib/auth'
import { canCreatePolls } from './lib/permissions'
import { formString, normalizeEmail } from './lib/form'
import { changePresence, fetchRoster, forgetRoster } from './lib/assembly-coupling'
import {
  bumpAssembly, checkPresence, currentMember, getAssemblyLevel, MAX_ASSEMBLY_TITLE, MAX_QUORUM, quorumState, YES_NO_ABSTAIN, type AssemblyLevel
} from './lib/assembly'
import { parseTimelineLiveUrl, parseTimelineUrl } from './lib/timeline'

const MAX_POLL_TITLE = 200
const MAX_OPTIONS = 25
const MAX_OPTION_LENGTH = 200

const manageUrl = (id: string, flag?: string) => `/sitzung/${id}/verwalten${flag ? `?${flag}` : ''}`

async function manageableAssembly(id: string, required: AssemblyLevel) {
  if (!id) return null
  const assembly = await prisma.assembly.findUnique({ where: { id } })
  if (!assembly) return null
  const level = await getAssemblyLevel(await getCurrentUser(), assembly)
  if (!level || (required === 'owner' && level !== 'owner')) return null
  return assembly
}

function readQuorum(formData: FormData): number | null {
  const value = Number(formString(formData, 'quorum', 10))
  return Number.isInteger(value) && value >= 1 && value <= MAX_QUORUM ? value : null
}

function readSettings(formData: FormData) {
  return {
    presenceRequired: formData.get('presenceRequired') === 'on',
    quorum: readQuorum(formData),
    speakerList: formData.get('speakerList') === 'on',
    secretDefault: formData.get('secretDefault') === 'on',
    selfCheckin: formData.get('selfCheckin') === 'on'
  }
}

export async function createAssembly(formData: FormData) {
  const user = await requireUser('/sitzung/neu')
  if (!canCreatePolls(user)) return
  const title = formString(formData, 'title', MAX_ASSEMBLY_TITLE)
  if (!title) redirect('/sitzung/neu?fehler=titel')
  const assembly = await prisma.assembly.create({ data: { title, ownerId: user.id, ...readSettings(formData) } })
  redirect(manageUrl(assembly.id, 'neu=1'))
}

export async function updateAssembly(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'moderator')
  if (!assembly) return
  const title = formString(formData, 'title', MAX_ASSEMBLY_TITLE) || assembly.title
  await prisma.assembly.update({ where: { id: assembly.id }, data: { title, ...readSettings(formData), version: { increment: 1 } } })
  revalidatePath(`/sitzung/${assembly.id}`)
  redirect(manageUrl(assembly.id, 'gespeichert=1'))
}

/**
 * Neue Abstimmung der Sitzung, sofort offen: Ja/Nein/Enthaltung oder eine Wahl mit eigenen Optionen (eine pro
 * Zeile, wahlweise mehrere wählbar). Geheim oder namentlich, Ergebnis erst nach dem Schließen öffentlich.
 */
export async function createAssemblyPoll(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'moderator')
  if (!assembly || assembly.closedAt) return
  const title = formString(formData, 'title', MAX_POLL_TITLE)
  if (!title) redirect(manageUrl(assembly.id, 'fehler=titel#neue-abstimmung'))
  const kind = formString(formData, 'kind', 10) === 'choice' ? 'choice' : 'yesno'
  const labels = kind === 'yesno'
    ? YES_NO_ABSTAIN
    : [...new Set(formString(formData, 'options', 10_000).split('\n').map(l => l.trim().slice(0, MAX_OPTION_LENGTH)).filter(Boolean))]
  if (labels.length < 2 || labels.length > MAX_OPTIONS) redirect(manageUrl(assembly.id, 'fehler=optionen#neue-abstimmung'))
  const secret = formData.get('secret') === 'on'
  const multiple = kind === 'choice' && formData.get('multiple') === 'on'

  await prisma.poll.create({
    data: {
      title, ownerId: assembly.ownerId, assemblyId: assembly.id, voterIdentity: 'ASSEMBLY', secretBallot: secret, showVoterNames: !secret,
      allowMultipleChoices: multiple, resultsVisibility: 'AFTER_CLOSE',
      options: { create: labels.map((label, position) => ({ label, position })) }
    }
  })
  await bumpAssembly(assembly.id)
  revalidatePath(`/sitzung/${assembly.id}`)
  redirect(manageUrl(assembly.id, 'abstimmung=1'))
}

/** Schließt eine Abstimmung der Sitzung und hält fest, wie viele anwesend waren und ob die Sitzung beschlussfähig war. */
async function closeWithSnapshot(assembly: { id: string; rsvpEventId: string | null; quorum: number | null }, pollIds: string[]) {
  if (pollIds.length === 0) return
  const state = quorumState(assembly, await fetchRoster(assembly, { fresh: true }))
  await prisma.poll.updateMany({
    where: { id: { in: pollIds }, assemblyId: assembly.id, closedAt: null },
    data: { closedAt: new Date(), assemblyPresent: state.present, assemblyQuorumMet: state.met }
  })
}

export async function closeAssemblyPoll(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'moderator')
  if (!assembly) return
  await closeWithSnapshot(assembly, [formString(formData, 'pollId', 50)])
  await bumpAssembly(assembly.id)
  revalidatePath(`/sitzung/${assembly.id}`)
  redirect(manageUrl(assembly.id))
}

export async function deleteAssemblyPoll(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'moderator')
  if (!assembly) return
  const poll = await prisma.poll.findFirst({ where: { id: formString(formData, 'pollId', 50), assemblyId: assembly.id }, select: { id: true } })
  if (!poll) return
  await prisma.$transaction([
    prisma.vote.deleteMany({ where: { pollId: poll.id } }),
    prisma.pollOption.deleteMany({ where: { pollId: poll.id } }),
    prisma.poll.delete({ where: { id: poll.id } })
  ])
  await bumpAssembly(assembly.id)
  revalidatePath(`/sitzung/${assembly.id}`)
  redirect(manageUrl(assembly.id))
}

/** Sitzung beenden (schließt offene Abstimmungen mit, Rednerliste wird geleert) bzw. wieder öffnen. */
export async function closeAssembly(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'moderator')
  if (!assembly) return
  if (formString(formData, 'intent', 10) === 'reopen') {
    await prisma.assembly.update({ where: { id: assembly.id }, data: { closedAt: null, version: { increment: 1 } } })
  } else {
    const open = await prisma.poll.findMany({ where: { assemblyId: assembly.id, closedAt: null }, select: { id: true } })
    await closeWithSnapshot(assembly, open.map(p => p.id))
    const now = new Date()
    await prisma.assemblySpeaker.updateMany({ where: { assemblyId: assembly.id, doneAt: null }, data: { doneAt: now } })
    await prisma.assembly.update({ where: { id: assembly.id }, data: { closedAt: now, version: { increment: 1 } } })
  }
  revalidatePath(`/sitzung/${assembly.id}`)
  redirect(manageUrl(assembly.id))
}

/** Verknüpfung mit dem Termin in rsvp-app lösen: Mitglieder und Rednerliste verschwinden, Abstimmungen bleiben. */
export async function unlinkAssembly(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'owner')
  if (!assembly) return
  await prisma.$transaction([
    prisma.assemblyMember.deleteMany({ where: { assemblyId: assembly.id } }),
    prisma.assembly.update({ where: { id: assembly.id }, data: { rsvpEventId: null, rsvpEventTitle: null, version: { increment: 1 } } })
  ])
  forgetRoster(assembly.id)
  revalidatePath(`/sitzung/${assembly.id}`)
  redirect(manageUrl(assembly.id, 'geloest=1'))
}

export async function deleteAssembly(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'owner')
  if (!assembly) return
  const polls = (await prisma.poll.findMany({ where: { assemblyId: assembly.id }, select: { id: true } })).map(p => p.id)
  await prisma.$transaction([
    prisma.vote.deleteMany({ where: { pollId: { in: polls } } }),
    prisma.pollOption.deleteMany({ where: { pollId: { in: polls } } }),
    prisma.poll.deleteMany({ where: { id: { in: polls } } }),
    prisma.assembly.delete({ where: { id: assembly.id } })
  ])
  forgetRoster(assembly.id)
  redirect('/meine-abstimmungen')
}

export async function shareAssembly(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'owner')
  if (!assembly) return
  const email = normalizeEmail(formString(formData, 'email', 254))
  const target = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null
  if (!target) redirect(manageUrl(assembly.id, 'teilenFehler=unbekannt#teilen'))
  if (target.id === assembly.ownerId) redirect(manageUrl(assembly.id, 'teilenFehler=owner#teilen'))
  await prisma.assemblyAccess.upsert({
    where: { assemblyId_userId: { assemblyId: assembly.id, userId: target.id } },
    update: {},
    create: { assemblyId: assembly.id, userId: target.id }
  })
  redirect(manageUrl(assembly.id, 'geteilt=1#teilen'))
}

export async function unshareAssembly(formData: FormData) {
  const access = await prisma.assemblyAccess.findUnique({ where: { id: formString(formData, 'accessId', 50) } })
  if (!access) return
  const assembly = await manageableAssembly(access.assemblyId, 'owner')
  if (!assembly) return
  await prisma.assemblyAccess.delete({ where: { id: access.id } })
  revalidatePath(manageUrl(assembly.id))
}

// --- Rednerliste --------------------------------------------------------------------------------------------------

/**
 * Mitglied meldet sich zu Wort (SPEAK) oder mit einem GO-Antrag (GO). Nur mit Rednerliste, in einer laufenden Sitzung
 * und - mit "Nur Anwesende" - nur Anwesende. Eine offene Meldung pro Art und Mitglied.
 */
export async function requestToSpeak(formData: FormData) {
  const assemblyId = formString(formData, 'assemblyId', 50)
  const assembly = await prisma.assembly.findUnique({ where: { id: assemblyId } })
  const member = assembly ? await currentMember(assembly.id) : null
  if (!assembly || !member || !assembly.speakerList || assembly.closedAt) return
  const kind = formString(formData, 'kind', 10) === 'GO' ? 'GO' : 'SPEAK'
  if ((await checkPresence(assembly, member, { fresh: true })) !== 'ok') redirect(`/sitzung/${assembly.id}?hinweis=assembly-absent#rednerliste`)
  const open = await prisma.assemblySpeaker.findFirst({ where: { assemblyId: assembly.id, memberId: member.id, kind, doneAt: null } })
  if (!open) {
    await prisma.assemblySpeaker.create({ data: { assemblyId: assembly.id, memberId: member.id, kind } })
    await bumpAssembly(assembly.id)
  }
  revalidatePath(`/sitzung/${assembly.id}`)
  redirect(`/sitzung/${assembly.id}#rednerliste`)
}

/** Eigene Meldung zurückziehen. */
export async function withdrawSpeak(formData: FormData) {
  const speaker = await prisma.assemblySpeaker.findUnique({ where: { id: formString(formData, 'speakerId', 50) } })
  const member = speaker ? await currentMember(speaker.assemblyId) : null
  if (!speaker || !member || speaker.memberId !== member.id || speaker.doneAt) return
  await prisma.assemblySpeaker.update({ where: { id: speaker.id }, data: { doneAt: new Date() } })
  await bumpAssembly(speaker.assemblyId)
  revalidatePath(`/sitzung/${speaker.assemblyId}`)
  redirect(`/sitzung/${speaker.assemblyId}#rednerliste`)
}

/**
 * Sitzungsleitung: aufrufen (intent=call, wer gerade dran war, ist damit fertig), erledigt (done) oder alle offenen
 * Meldungen schließen (clear).
 */
export async function manageSpeaker(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'moderator')
  if (!assembly) return
  const intent = formString(formData, 'intent', 10)
  const now = new Date()
  if (intent === 'clear') {
    await prisma.assemblySpeaker.updateMany({ where: { assemblyId: assembly.id, doneAt: null }, data: { doneAt: now } })
  } else {
    const speaker = await prisma.assemblySpeaker.findFirst({ where: { id: formString(formData, 'speakerId', 50), assemblyId: assembly.id, doneAt: null } })
    if (!speaker) redirect(`${manageUrl(assembly.id)}#rednerliste`)
    if (intent === 'call') {
      await prisma.$transaction([
        prisma.assemblySpeaker.updateMany({ where: { assemblyId: assembly.id, doneAt: null, calledAt: { not: null }, id: { not: speaker.id } }, data: { doneAt: now } }),
        prisma.assemblySpeaker.update({ where: { id: speaker.id }, data: { calledAt: now } })
      ])
    } else {
      await prisma.assemblySpeaker.update({ where: { id: speaker.id }, data: { doneAt: now } })
    }
  }
  await bumpAssembly(assembly.id)
  revalidatePath(`/sitzung/${assembly.id}`)
  redirect(`${manageUrl(assembly.id)}#rednerliste`)
}

// --- Anwesenheit -----------------------------------------------------------------------------------------------------

const SUB_LENGTH = 128

/**
 * Sitzungsleitung checkt jemanden ein oder aus, ohne Scan (über rsvp-app, `assembly-presence`). `present` = '1' oder
 * '0' ist der Zielzustand. Erfolg ohne Weiterleitung (die Liste bleibt, wie sie ist, samt Suche); bei Fehlern eine
 * Meldung über der Anwesenheit.
 */
export async function chairPresence(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'moderator')
  if (!assembly) return
  const result = await changePresence(assembly, formString(formData, 'sub', SUB_LENGTH), formString(formData, 'present', 1) === '1')
  if (result !== 'ok') redirect(manageUrl(assembly.id, `anwesenheit=${result}#anwesenheit`))
  await bumpAssembly(assembly.id)
  revalidatePath(`/sitzung/${assembly.id}`)
  revalidatePath(manageUrl(assembly.id))
}

/** Mitglied checkt sich selbst ein oder aus - nur, wenn die Sitzung das erlaubt und sie läuft. */
export async function selfPresence(formData: FormData) {
  const assembly = await prisma.assembly.findUnique({ where: { id: formString(formData, 'assemblyId', 50) } })
  const member = assembly ? await currentMember(assembly.id) : null
  if (!assembly || !member || !assembly.selfCheckin || assembly.closedAt) return
  const result = await changePresence(assembly, member.sub, formString(formData, 'present', 1) === '1')
  await bumpAssembly(assembly.id)
  revalidatePath(`/sitzung/${assembly.id}`)
  redirect(`/sitzung/${assembly.id}${result === 'ok' ? '' : `?hinweis=presence-${result}`}#anwesenheit`)
}

// --- Zeitplan und Tafel ----------------------------------------------------------------------------------------------

/** Links aus dem Zeitplan: Gästeansicht bzw. Tafel (Tagesordnung) und Live-Steuerung (eingebettet). Leer = keiner. */
export async function updateAssemblyTimeline(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'moderator')
  if (!assembly) return
  const timeline = parseTimelineUrl(formString(formData, 'timelineUrl', 1000))
  const live = parseTimelineLiveUrl(formString(formData, 'timelineLiveUrl', 1000))
  const error = 'error' in timeline ? timeline.error : 'error' in live ? live.error : null
  if (error) redirect(manageUrl(assembly.id, `fehler=${error}#zeitplan`))
  await prisma.assembly.update({
    where: { id: assembly.id },
    data: { timelineUrl: 'value' in timeline ? timeline.value : null, timelineLiveUrl: 'value' in live ? live.value : null, version: { increment: 1 } }
  })
  revalidatePath(`/sitzung/${assembly.id}`)
  redirect(manageUrl(assembly.id, 'zeitplan=1#zeitplan'))
}

/** Tafel-Link erzeugen, neu erzeugen (der alte gilt sofort nicht mehr) oder abschalten. */
export async function updateAssemblyBoard(formData: FormData) {
  const assembly = await manageableAssembly(formString(formData, 'assemblyId', 50), 'moderator')
  if (!assembly) return
  const off = formString(formData, 'intent', 10) === 'off'
  await prisma.assembly.update({ where: { id: assembly.id }, data: { boardKey: off ? null : generateToken() } })
  redirect(manageUrl(assembly.id, `${off ? 'tafelAus' : 'tafel'}=1#tafel`))
}

