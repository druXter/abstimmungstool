'use server'

import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { prisma } from './lib/prisma'
import { getCurrentUser, requireUser } from './lib/auth'
import { canCreatePolls } from './lib/permissions'
import { formString } from './lib/form'
import { clientIp, liveJoinRule, livePinRule, refund, reserve } from './lib/throttle'
import { currentPlayer, issuePlayerToken } from './lib/live-player'
import {
  ANSWER_GRACE_MS, canManageLive, cleanNickname, controlLive, freePin, isQuiz, MAX_ANSWER_LENGTH, MAX_ANSWERS,
  MAX_PLAYERS, MAX_QUESTION_LENGTH, MAX_QUESTIONS, MIN_ANSWERS, nicknameKey, notifyLive, pointsFor, settleQuestion,
  TIME_LIMITS, type LiveControl
} from './lib/live'

const MAX_TITLE_LENGTH = 200

type QuestionInput = { text: string; timeLimit: number | null; answers: { label: string; isCorrect: boolean }[] }

/**
 * Liest die Fragen aus dem Editor (app/live/questions-editor.tsx): q<i>_text, q<i>_time,
 * q<i>_a<j> und q<i>_c<j> (richtig). Fragen ohne Text oder mit weniger als zwei Antworten
 * fallen still weg, ebenso Häkchen an leeren Antworten.
 */
function parseQuestions(formData: FormData): QuestionInput[] {
  const questions: QuestionInput[] = []
  for (let i = 0; i < MAX_QUESTIONS; i++) {
    const text = formString(formData, `q${i}_text`, MAX_QUESTION_LENGTH)
    if (!text) continue
    const answers: QuestionInput['answers'] = []
    for (let j = 0; j < MAX_ANSWERS; j++) {
      const label = formString(formData, `q${i}_a${j}`, MAX_ANSWER_LENGTH)
      if (label) answers.push({ label, isCorrect: formData.get(`q${i}_c${j}`) === 'on' })
    }
    if (answers.length < MIN_ANSWERS) continue
    const time = Number.parseInt(formString(formData, `q${i}_time`, 5), 10)
    questions.push({ text, timeLimit: (TIME_LIMITS as readonly number[]).includes(time) ? time : null, answers })
  }
  return questions
}

function questionsCreate(questions: QuestionInput[]) {
  return questions.map((q, position) => ({
    position,
    text: q.text,
    timeLimit: q.timeLimit,
    answers: { create: q.answers.map((a, index) => ({ position: index, label: a.label, isCorrect: a.isCorrect })) }
  }))
}

/** Die Runde, wenn das eingeloggte Konto sie verwalten darf (Owner oder Admin), sonst null. */
async function manageableSession(sessionId: string) {
  const session = await prisma.liveSession.findUnique({ where: { id: sessionId } })
  if (!session || !canManageLive(await getCurrentUser(), session)) return null
  return session
}

export async function createLive(formData: FormData) {
  const user = await requireUser('/live/neu')
  if (!canCreatePolls(user)) return

  const title = formString(formData, 'title', MAX_TITLE_LENGTH)
  const questions = parseQuestions(formData)
  if (!title || questions.length === 0) redirect('/live/neu?fehler=leer')

  const session = await prisma.liveSession.create({
    data: { title, ownerId: user.id, pin: await freePin(), questions: { create: questionsCreate(questions) } }
  })
  redirect(`/live/${session.id}/verwalten?angelegt=1`)
}

/** Bearbeiten nur, solange niemand geantwortet hat - sonst passten Antworten und Punkte nicht mehr zu den Fragen. */
export async function updateLive(formData: FormData) {
  const session = await manageableSession(formString(formData, 'sessionId', 50))
  if (!session) return

  const title = formString(formData, 'title', MAX_TITLE_LENGTH)
  const questions = parseQuestions(formData)
  if (!title || questions.length === 0) redirect(`/live/${session.id}/bearbeiten?fehler=leer`)
  if (await prisma.liveResponse.count({ where: { question: { sessionId: session.id } } })) {
    redirect(`/live/${session.id}/verwalten?fehler=gespielt`)
  }

  await prisma.$transaction([
    prisma.liveQuestion.deleteMany({ where: { sessionId: session.id } }),
    prisma.liveSession.update({
      where: { id: session.id },
      data: { title, version: { increment: 1 }, questions: { create: questionsCreate(questions) } }
    })
  ])
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

export async function deleteLive(formData: FormData) {
  const session = await manageableSession(formString(formData, 'sessionId', 50))
  if (!session) return
  await prisma.liveSession.delete({ where: { id: session.id } })
  notifyLive(session.id)
  redirect('/meine-abstimmungen')
}

/** Leinwand: weiterschalten, beenden, Beitritt sperren/öffnen (siehe controlLive). */
export async function controlLiveAction(sessionId: string, op: LiveControl, version: number): Promise<boolean> {
  if (typeof sessionId !== 'string' || !['next', 'finish', 'lock', 'unlock'].includes(op) || !Number.isInteger(version)) return false
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

/**
 * Antwort auf die aktuelle Frage. Die erste zählt (wie bei Kahoot); die Zeit misst der Server
 * ab Fragebeginn, die Punkte stehen damit sofort fest (app/lib/live.ts pointsFor).
 */
export async function answerLive(sessionId: string, index: number, answerId: string): Promise<AnswerResult> {
  if (typeof sessionId !== 'string' || typeof answerId !== 'string' || !Number.isInteger(index)) return { ok: false, reason: 'invalid' }
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
  const answer = question?.answers.find(a => a.id === answerId)
  if (!question || !answer) return { ok: false, reason: 'invalid' }

  const elapsedMs = Math.max(now - session.questionStartedAt.getTime(), 0)
  try {
    await prisma.liveResponse.create({
      data: {
        questionId: question.id, playerId: player.id, answerId: answer.id, elapsedMs,
        points: isQuiz(question.answers) ? pointsFor(answer.isCorrect, elapsedMs, question.timeLimit) : 0
      }
    })
  } catch (error) {
    // Schon geantwortet (Doppelklick, zweiter Tab) - die erste Antwort bleibt.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error
    return { ok: true }
  }

  notifyLive(sessionId, 'activity')
  await settleQuestion(sessionId)
  return { ok: true }
}
