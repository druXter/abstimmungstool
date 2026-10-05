'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Prisma, type LiveQuestionKind } from '@prisma/client'
import { prisma } from './lib/prisma'
import { getCurrentUser, requireUser } from './lib/auth'
import { canCreatePolls } from './lib/permissions'
import { formString, normalizeEmail } from './lib/form'
import { clientIp, liveJoinRule, livePinRule, refund, reserve } from './lib/throttle'
import { currentPlayer, issuePlayerToken } from './lib/live-player'
import { deleteUnusedImages, readImage } from './lib/live-images'
import {
  ANSWER_GRACE_MS, cleanNickname, cleanWord, controlLive, estimatePoints, freePin, getLiveLevel, isCorrectResponse, isQuiz,
  LIVE_QUESTION_KINDS, MAX_ANSWER_LENGTH, MAX_ANSWERS, MAX_PLAYERS, MAX_QUESTION_LENGTH, MAX_QUESTIONS, MIN_ANSWERS,
  nicknameKey, notifyLive, pointsFor, settleQuestion, TIME_LIMITS, type LiveControl, type LiveLevel
} from './lib/live'

const MAX_TITLE_LENGTH = 200
const MAX_UNIT_LENGTH = 20
/** Schätzwerte jenseits davon sind Tippfehler oder Unsinn. */
const MAX_ABS_NUMBER = 1e12

type QuestionInput = {
  text: string
  kind: LiveQuestionKind
  timeLimit: number | null
  answers: { label: string; isCorrect: boolean }[]
  target: number | null
  tolerance: number | null
  unit: string | null
  /** Bestehendes Bild behalten (ID aus dem Editor) oder neues hochgeladenes. */
  keepImageId: string | null
  /** Bild auf der Leinwand nach und nach aufdecken. */
  imageReveal: boolean
  newImage: { type: string; data: Uint8Array<ArrayBuffer> } | null
}

/** Zahl aus einem Formularfeld, Komma oder Punkt als Dezimaltrenner. Leer/ungültig -> null. */
function parseNumber(raw: string): number | null {
  const value = Number(raw.replace(/\s/g, '').replace(',', '.'))
  return raw.trim() !== '' && Number.isFinite(value) && Math.abs(value) <= MAX_ABS_NUMBER ? value : null
}

/**
 * Liest die Fragen aus dem Editor (app/live/questions-editor.tsx): q<i>_text, q<i>_kind, q<i>_time,
 * bei Auswahl q<i>_a<j>/q<i>_c<j>, bei Schätzfragen q<i>_target/q<i>_tolerance/q<i>_unit, dazu
 * q<i>_image (neues Bild), q<i>_imageId (bisheriges behalten) bzw. q<i>_noimage, q<i>_reveal (Bild
 * aufdecken). Unvollständige
 * Fragen fallen still weg, ebenso Häkchen an leeren Antworten.
 */
async function parseQuestions(formData: FormData): Promise<QuestionInput[]> {
  const questions: QuestionInput[] = []
  for (let i = 0; i < MAX_QUESTIONS; i++) {
    const text = formString(formData, `q${i}_text`, MAX_QUESTION_LENGTH)
    if (!text) continue
    const kind = LIVE_QUESTION_KINDS.find(k => k === formData.get(`q${i}_kind`)) ?? 'CHOICE'
    const answers: QuestionInput['answers'] = []
    if (kind === 'CHOICE' || kind === 'MULTI') {
      for (let j = 0; j < MAX_ANSWERS; j++) {
        const label = formString(formData, `q${i}_a${j}`, MAX_ANSWER_LENGTH)
        if (label) answers.push({ label, isCorrect: formData.get(`q${i}_c${j}`) === 'on' })
      }
      if (answers.length < MIN_ANSWERS) continue
    }
    const time = Number.parseInt(formString(formData, `q${i}_time`, 5), 10)
    const target = kind === 'ESTIMATE' ? parseNumber(formString(formData, `q${i}_target`, 30)) : null
    const tolerance = target !== null ? parseNumber(formString(formData, `q${i}_tolerance`, 30)) : null
    const noImage = formData.get(`q${i}_noimage`) === 'on'
    questions.push({
      text,
      kind,
      timeLimit: (TIME_LIMITS as readonly number[]).includes(time) ? time : null,
      answers,
      target,
      tolerance: tolerance !== null && tolerance > 0 ? tolerance : null,
      unit: kind === 'ESTIMATE' ? formString(formData, `q${i}_unit`, MAX_UNIT_LENGTH) || null : null,
      keepImageId: noImage ? null : formString(formData, `q${i}_imageId`, 50) || null,
      imageReveal: formData.get(`q${i}_reveal`) === 'on',
      newImage: noImage ? null : await readImage(formData.get(`q${i}_image`))
    })
  }
  return questions
}

/**
 * Legt die Fragen einer Runde an, samt neu hochgeladener Bilder. Ein "behaltenes" Bild muss zu
 * DIESER Runde gehören - eine fremde Bild-ID aus einem manipulierten Formular wird ignoriert.
 */
async function writeQuestions(tx: Prisma.TransactionClient, sessionId: string, questions: QuestionInput[]) {
  const own = new Set((await tx.liveImage.findMany({ where: { sessionId }, select: { id: true } })).map(i => i.id))
  for (const [position, q] of questions.entries()) {
    let imageId = q.keepImageId && own.has(q.keepImageId) ? q.keepImageId : null
    if (q.newImage) imageId = (await tx.liveImage.create({ data: { sessionId, type: q.newImage.type, data: q.newImage.data } })).id
    await tx.liveQuestion.create({
      data: {
        sessionId, position, text: q.text, kind: q.kind, timeLimit: q.timeLimit, target: q.target, tolerance: q.tolerance, unit: q.unit, imageId,
        imageReveal: q.imageReveal && imageId !== null,
        answers: { create: q.answers.map((a, index) => ({ position: index, label: a.label, isCorrect: a.isCorrect })) }
      }
    })
  }
}

/** Die Runde, wenn das eingeloggte Konto sie mindestens auf `required` verwalten darf, sonst null. */
async function manageableSession(sessionId: string, required: LiveLevel = 'moderator') {
  const session = await prisma.liveSession.findUnique({ where: { id: sessionId } })
  if (!session) return null
  const level = await getLiveLevel(await getCurrentUser(), session)
  if (!level || (required === 'owner' && level !== 'owner')) return null
  return session
}

export async function createLive(formData: FormData) {
  const user = await requireUser('/live/neu')
  if (!canCreatePolls(user)) return

  const title = formString(formData, 'title', MAX_TITLE_LENGTH)
  const questions = await parseQuestions(formData)
  if (!title || questions.length === 0) redirect('/live/neu?fehler=leer')

  const pin = await freePin()
  const session = await prisma.$transaction(async tx => {
    const created = await tx.liveSession.create({ data: { title, ownerId: user.id, pin } })
    await writeQuestions(tx, created.id, questions)
    return created
  }, { timeout: 20_000 })
  redirect(`/live/${session.id}/verwalten?angelegt=1`)
}

/** Bearbeiten nur, solange niemand geantwortet hat - sonst passten Antworten und Punkte nicht mehr zu den Fragen. */
export async function updateLive(formData: FormData) {
  const session = await manageableSession(formString(formData, 'sessionId', 50))
  if (!session) return

  const title = formString(formData, 'title', MAX_TITLE_LENGTH)
  const questions = await parseQuestions(formData)
  if (!title || questions.length === 0) redirect(`/live/${session.id}/bearbeiten?fehler=leer`)
  if (await prisma.liveResponse.count({ where: { question: { sessionId: session.id } } })) {
    redirect(`/live/${session.id}/verwalten?fehler=gespielt`)
  }

  await prisma.$transaction(async tx => {
    await tx.liveQuestion.deleteMany({ where: { sessionId: session.id } })
    await writeQuestions(tx, session.id, questions)
    await tx.liveSession.update({ where: { id: session.id }, data: { title, version: { increment: 1 } } })
  }, { timeout: 20_000 })
  await deleteUnusedImages(session.id)
  notifyLive(session.id)
  redirect(`/live/${session.id}/verwalten?gespeichert=1`)
}

/** Zurück in die Lobby: Teilnehmende und Antworten weg, neue PIN - für die nächste Runde mit denselben Fragen. */
export async function resetLive(formData: FormData) {
  const session = await manageableSession(formString(formData, 'sessionId', 50))
  if (!session) return

  await prisma.$transaction([
    prisma.livePlayer.deleteMany({ where: { sessionId: session.id } }),
    prisma.liveSession.update({
      where: { id: session.id },
      data: {
        phase: 'LOBBY', currentIndex: -1, pin: await freePin(), joinLocked: false, questionStartedAt: null,
        questionEndsAt: null, startedAt: null, finishedAt: null, version: { increment: 1 }
      }
    })
  ])
  notifyLive(session.id)
  redirect(`/live/${session.id}/verwalten?neu=1`)
}

/** Löschen nur für Owner und Admins (nicht für Konten, mit denen die Runde geteilt ist). */
export async function deleteLive(formData: FormData) {
  const session = await manageableSession(formString(formData, 'sessionId', 50), 'owner')
  if (!session) return
  await prisma.liveSession.delete({ where: { id: session.id } })
  notifyLive(session.id)
  redirect('/meine-abstimmungen')
}

/** Mit einem bestehenden Konto teilen (wie sharePoll). Nur Owner und Admins. */
export async function shareLive(formData: FormData) {
  const session = await manageableSession(formString(formData, 'sessionId', 50), 'owner')
  if (!session) return
  const email = normalizeEmail(formString(formData, 'email', 254))
  const target = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null
  if (!target) redirect(`/live/${session.id}/verwalten?teilenFehler=unbekannt`)
  if (target.id === session.ownerId) redirect(`/live/${session.id}/verwalten?teilenFehler=owner`)

  await prisma.liveAccess.upsert({
    where: { sessionId_userId: { sessionId: session.id, userId: target.id } },
    update: {},
    create: { sessionId: session.id, userId: target.id }
  })
  redirect(`/live/${session.id}/verwalten?geteilt=1`)
}

export async function unshareLive(formData: FormData) {
  const access = await prisma.liveAccess.findUnique({ where: { id: formString(formData, 'accessId', 50) } })
  if (!access) return
  const session = await manageableSession(access.sessionId, 'owner')
  if (!session) return
  await prisma.liveAccess.delete({ where: { id: access.id } })
  revalidatePath(`/live/${session.id}/verwalten`)
}

/** Leinwand: weiterschalten, beenden, Beitritt sperren/öffnen (siehe controlLive). */
export async function controlLiveAction(sessionId: string, op: LiveControl, version: number): Promise<boolean> {
  if (typeof sessionId !== 'string' || !['next', 'finish', 'lock', 'unlock', 'uncover'].includes(op) || !Number.isInteger(version)) return false
  const session = await manageableSession(sessionId)
  if (!session) return false
  return controlLive(session.id, op, version)
}

/** Leinwand: eine teilnehmende Person entfernen (samt ihren Antworten). */
export async function kickLivePlayer(sessionId: string, playerId: string): Promise<void> {
  if (typeof sessionId !== 'string' || typeof playerId !== 'string') return
  const session = await manageableSession(sessionId)
  if (!session) return
  await prisma.livePlayer.deleteMany({ where: { id: playerId, sessionId: session.id } })
  // 'state', damit auch das Gerät der entfernten Person es sofort merkt.
  notifyLive(session.id)
  await settleQuestion(session.id)
}

/**
 * Leinwand: ein Wort aus der Wortwolke ausblenden (alle Beiträge mit diesem Wort, unabhängig von
 * der Schreibweise) - für Unpassendes, das sonst groß an der Wand stünde.
 */
export async function hideLiveWord(sessionId: string, questionId: string, key: string): Promise<void> {
  if (typeof sessionId !== 'string' || typeof questionId !== 'string' || typeof key !== 'string') return
  const session = await manageableSession(sessionId)
  if (!session) return
  await prisma.liveResponse.updateMany({ where: { questionId, textKey: key, question: { sessionId: session.id } }, data: { hidden: true } })
  notifyLive(session.id)
}

/**
 * Beitritt per PIN und Spitzname. Wer in dieser Runde schon ein gültiges Cookie hat, landet
 * direkt wieder im Spiel (z.B. nach versehentlichem Schließen des Tabs).
 */
export async function joinLive(formData: FormData) {
  const pin = formString(formData, 'pin', 20).replace(/\D/g, '')
  const rawName = formString(formData, 'nickname', 100)
  const back = (error: string) => {
    const params = new URLSearchParams({ fehler: error })
    if (pin) params.set('pin', pin)
    if (rawName) params.set('name', rawName.slice(0, 40))
    return `/live?${params}`
  }

  const ip = await clientIp()
  const pinRule = livePinRule(ip)
  if (!(await reserve([pinRule]))) redirect(back('gesperrt'))

  const session = pin.length === 6 ? await prisma.liveSession.findUnique({ where: { pin } }) : null
  if (!session || session.phase === 'FINISHED') redirect(back('pin'))
  await refund(pinRule)

  if (await currentPlayer(session.id)) redirect(`/live/${session.id}`)
  if (session.joinLocked) redirect(back('zu'))

  const nickname = cleanNickname(rawName)
  if (!nickname) redirect(back('name'))
  if (ip !== 'unknown' && !(await reserve([liveJoinRule(ip, session.id)]))) redirect(back('viele'))
  if ((await prisma.livePlayer.count({ where: { sessionId: session.id } })) >= MAX_PLAYERS) redirect(back('voll'))

  let created = false
  try {
    await prisma.livePlayer.create({
      data: { sessionId: session.id, nickname, nicknameKey: nicknameKey(nickname), tokenHash: await issuePlayerToken(session.id) }
    })
    created = true
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error
  }
  if (!created) redirect(back('vergeben'))

  notifyLive(session.id, 'activity')
  redirect(`/live/${session.id}`)
}

export type AnswerResult = { ok: true } | { ok: false; reason: 'gone' | 'late' | 'invalid' }

/** Was das Handy je nach Frageart schickt. */
export type LiveAnswerInput = { answerId?: string; answerIds?: string[]; value?: number; text?: string }

/**
 * Antwort auf die aktuelle Frage. Die erste zählt (wie bei Kahoot); die Zeit misst der Server
 * ab Fragebeginn, die Punkte stehen damit sofort fest:
 * - CHOICE/MULTI: Schnelligkeit (pointsFor), MULTI nur bei genau der richtigen Kombination
 * - ESTIMATE: Nähe zum richtigen Wert (estimatePoints)
 * - WORDCLOUD: nie Punkte
 */
export async function answerLive(sessionId: string, index: number, input: LiveAnswerInput): Promise<AnswerResult> {
  if (typeof sessionId !== 'string' || !Number.isInteger(index) || typeof input !== 'object' || input === null) return { ok: false, reason: 'invalid' }
  const player = await currentPlayer(sessionId)
  if (!player) return { ok: false, reason: 'gone' }

  const session = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: { phase: true, currentIndex: true, questionStartedAt: true, questionEndsAt: true }
  })
  const now = Date.now()
  if (
    !session || session.phase !== 'QUESTION' || session.currentIndex !== index || !session.questionStartedAt ||
    (session.questionEndsAt && now > session.questionEndsAt.getTime() + ANSWER_GRACE_MS)
  ) return { ok: false, reason: 'late' }

  const question = await prisma.liveQuestion.findUnique({
    where: { sessionId_position: { sessionId, position: index } },
    include: { answers: { select: { id: true, isCorrect: true } } }
  })
  if (!question) return { ok: false, reason: 'invalid' }
  const elapsedMs = Math.max(now - session.questionStartedAt.getTime(), 0)

  let data: Omit<Prisma.LiveResponseUncheckedCreateInput, 'questionId' | 'playerId' | 'elapsedMs' | 'points'>
  switch (question.kind) {
    case 'CHOICE': {
      if (typeof input.answerId !== 'string' || !question.answers.some(a => a.id === input.answerId)) return { ok: false, reason: 'invalid' }
      data = { answerId: input.answerId }
      break
    }
    case 'MULTI': {
      const ids = Array.isArray(input.answerIds) ? [...new Set(input.answerIds.filter(id => typeof id === 'string'))] : []
      if (ids.length === 0 || !ids.every(id => question.answers.some(a => a.id === id))) return { ok: false, reason: 'invalid' }
      data = { choices: JSON.stringify(ids.sort()) }
      break
    }
    case 'ESTIMATE': {
      if (typeof input.value !== 'number' || !Number.isFinite(input.value) || Math.abs(input.value) > MAX_ABS_NUMBER) return { ok: false, reason: 'invalid' }
      data = { numberValue: input.value }
      break
    }
    case 'WORDCLOUD': {
      const word = typeof input.text === 'string' ? cleanWord(input.text) : null
      if (!word) return { ok: false, reason: 'invalid' }
      data = { text: word.text, textKey: word.key }
      break
    }
  }

  let points = 0
  if (isQuiz(question)) {
    if (question.kind === 'ESTIMATE') points = estimatePoints(data.numberValue as number, question.target!, question.tolerance)
    else points = pointsFor(isCorrectResponse(question, { answerId: data.answerId ?? null, choices: data.choices ?? null, numberValue: null }), elapsedMs, question.timeLimit)
  }

  try {
    await prisma.liveResponse.create({ data: { ...data, questionId: question.id, playerId: player.id, elapsedMs, points } })
  } catch (error) {
    // Schon geantwortet (Doppelklick, zweiter Tab) - die erste Antwort bleibt.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error
    return { ok: true }
  }

  notifyLive(sessionId, 'activity')
  await settleQuestion(sessionId)
  return { ok: true }
}
