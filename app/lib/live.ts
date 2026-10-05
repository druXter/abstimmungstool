import { createHash, randomInt } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { LivePhase, LiveQuestionKind } from '@prisma/client'
import { prisma } from './prisma'
import type { CurrentUser } from './auth'

/**
 * Live-Runden wie bei Kahoot (siehe schema.prisma LiveSession und README "Live-Runden"):
 * Zustandsautomat, Punkte, Ansichten für Leinwand und Teilnehmende und das Signal, mit dem
 * das Long-Polling (app/api/live/[id]/route.ts) sofort von einer Änderung erfährt.
 */

export const MAX_QUESTIONS = 50
export const MIN_ANSWERS = 2
export const MAX_ANSWERS = 6
export const MAX_QUESTION_LENGTH = 200
export const MAX_ANSWER_LENGTH = 100
/** Wortwolke: so lang darf ein Beitrag sein. */
export const MAX_WORD_LENGTH = 40
export const LIVE_QUESTION_KINDS: readonly LiveQuestionKind[] = ['CHOICE', 'MULTI', 'ESTIMATE', 'WORDCLOUD']
export const MAX_NICKNAME_LENGTH = 24
export const MAX_PLAYERS = 500
/** Auswahl beim Anlegen, in Sekunden. 0 = ohne Zeitlimit. */
export const TIME_LIMITS = [5, 10, 20, 30, 60, 90, 120, 240] as const
export const DEFAULT_TIME_LIMIT = 20
/** Antworten, die kurz nach Ablauf eintreffen (Netzlaufzeit), zählen noch. */
export const ANSWER_GRACE_MS = 1000

/**
 * owner:     alles (präsentieren, bearbeiten, neu starten, exportieren, löschen, teilen)
 * moderator: per LiveAccess geteilt - alles außer löschen und weiter teilen (wie bei Abstimmungen)
 */
export type LiveLevel = 'owner' | 'moderator'

/** DIE Berechtigungsprüfung für Live-Runden - jede Seite, jede Action und das Long-Polling gehen hierüber. */
export async function getLiveLevel(user: CurrentUser | null, session: { id: string; ownerId: string }): Promise<LiveLevel | null> {
  if (!user) return null
  if (user.role === 'ADMIN' || user.id === session.ownerId) return 'owner'
  const access = await prisma.liveAccess.findUnique({ where: { sessionId_userId: { sessionId: session.id, userId: user.id } }, select: { id: true } })
  return access ? 'moderator' : null
}

/** Was eine Frage für die Auswertung braucht. */
export type QuestionLike = { kind: LiveQuestionKind; target: number | null; answers: { isCorrect: boolean }[] }

/** Quizfrage = es gibt eine richtige Lösung und damit Punkte (Wortwolken nie). */
export function isQuiz(q: QuestionLike): boolean {
  if (q.kind === 'WORDCLOUD') return false
  if (q.kind === 'ESTIMATE') return q.target !== null
  return q.answers.some(a => a.isCorrect)
}

/** Toleranz einer Schätzfrage: eingestellt, sonst 10 % des richtigen Werts (bei 0: 1). */
export function estimateTolerance(target: number, tolerance: number | null): number {
  if (tolerance !== null && tolerance > 0) return tolerance
  return target === 0 ? 1 : Math.abs(target) * 0.1
}

/**
 * Schätzfrage: genau getroffen = 1000, am Rand der Toleranz 500, außerhalb 0 - dieselbe Spanne wie
 * bei den anderen Quizfragen, aber nach Nähe statt Schnelligkeit.
 */
export function estimatePoints(value: number, target: number, tolerance: number | null): number {
  const tol = estimateTolerance(target, tolerance)
  const distance = Math.abs(value - target)
  if (distance > tol) return 0
  return Math.round(1000 * (1 - distance / tol / 2))
}

// Bild aufdecken: Kacheln und Reihenfolge rechnet ./live-reveal (auch im Browser gebraucht).

/**
 * Ob Teilnehmende das Bild einer Frage schon sehen dürfen: Aufdeck-Bilder erst ab der Auflösung
 * (sonst ließe es sich auf dem Handy oder über die Bild-Adresse vorab ganz ansehen).
 */
export function imageVisibleToPlayers(
  question: { position: number; imageReveal: boolean },
  session: { phase: LivePhase; currentIndex: number }
): boolean {
  if (!question.imageReveal || session.phase === 'FINISHED') return true
  if (question.position !== session.currentIndex) return question.position < session.currentIndex
  return session.phase === 'REVEAL' || session.phase === 'LEADERBOARD'
}

/** Wortwolke: Beitrag bereinigen wie einen Spitznamen; Schlüssel zum Zählen/Ausblenden ist klein geschrieben. */
export function cleanWord(input: string): { text: string; key: string } | null {
  const text = input.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_WORD_LENGTH)
  return text ? { text, key: text.toLocaleLowerCase('de-DE') } : null
}

/** Kahoot-Formel: richtig = 1000 bei sofortiger Antwort, linear bis 500 bei Zeitablauf; ohne Zeitlimit 1000. */
export function pointsFor(correct: boolean, elapsedMs: number, timeLimit: number | null): number {
  if (!correct) return 0
  if (!timeLimit) return 1000
  const share = Math.min(Math.max(elapsedMs / (timeLimit * 1000), 0), 1)
  return Math.round(1000 * (1 - share / 2))
}

export function nicknameKey(nickname: string): string {
  return nickname.toLocaleLowerCase('de-DE')
}

/** Spitzname bereinigen: Steuerzeichen raus, Leerraum zusammenfassen, Länge begrenzen. Leer -> null. */
export function cleanNickname(input: string): string | null {
  const name = input.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, '').replace(/\s+/g, ' ').trim()
  return name === '' ? null : name.slice(0, MAX_NICKNAME_LENGTH)
}

// ---------------------------------------------------------------------------------------
// Signal für das Long-Polling. Liegt an globalThis, weil Next.js Route Handler und Server
// Actions in getrennte Bundles packt - ein Modul-Singleton gäbe es sonst mehrfach. Wirkt nur
// innerhalb eines Prozesses (so läuft das Tool, siehe Dockerfile); bei mehreren Prozessen
// prüft das Long-Polling ohnehin regelmäßig selbst nach (POLL_FALLBACK_MS im Route Handler).

const SIGNAL_KEY = Symbol.for('abstimmungstool.live-signal')
const globalWithSignal = globalThis as typeof globalThis & { [SIGNAL_KEY]?: EventEmitter }
const signal = (globalWithSignal[SIGNAL_KEY] ??= new EventEmitter().setMaxListeners(0))

/**
 * 'state': Zustandswechsel (neue Frage, Auflösung, entfernt …) - weckt alle Ansichten.
 * 'activity': jemand ist beigetreten oder hat geantwortet - weckt nur die Leinwand. Sonst würde
 * jede einzelne Antwort alle Handys im Raum neu abfragen lassen.
 */
export function notifyLive(sessionId: string, kind: 'state' | 'activity' = 'state'): void {
  signal.emit(kind === 'state' ? sessionId : `${sessionId}:activity`)
}

/** Wartet, bis sich an der Runde etwas tut, höchstens `ms` (oder bis die Anfrage abbricht). */
export function waitForLive(sessionId: string, ms: number, opts: { activity: boolean; abort?: AbortSignal }): Promise<void> {
  const events = opts.activity ? [sessionId, `${sessionId}:activity`] : [sessionId]
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer)
      for (const event of events) signal.off(event, done)
      opts.abort?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, Math.max(ms, 0))
    for (const event of events) signal.on(event, done)
    opts.abort?.addEventListener('abort', done)
  })
}

// ---------------------------------------------------------------------------------------
// PIN

/** Neue, freie 6-stellige PIN (ohne führende Null, damit sie sich gut vorlesen lässt). */
export async function freePin(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const pin = String(randomInt(100_000, 1_000_000))
    if (!(await prisma.liveSession.findUnique({ where: { pin }, select: { id: true } }))) return pin
  }
  throw new Error('Keine freie PIN gefunden')
}

/** Laufende Runden ohne PIN (nach "Neu starten" oder vom Cleanup freigegeben) bekommen eine neue. */
export async function ensurePin(session: { id: string; pin: string | null; phase: LivePhase }): Promise<string | null> {
  if (session.pin || session.phase === 'FINISHED') return session.pin
  const pin = await freePin()
  await prisma.liveSession.updateMany({ where: { id: session.id, pin: null }, data: { pin, version: { increment: 1 } } })
  return (await prisma.liveSession.findUnique({ where: { id: session.id }, select: { pin: true } }))?.pin ?? null
}

// ---------------------------------------------------------------------------------------
// Zustandsautomat

/**
 * Schließt die aktuelle Frage, wenn ihre Zeit um ist oder alle geantwortet haben (QUESTION ->
 * REVEAL). Bedingtes Update: Gleichzeitige Aufrufe (Long-Polling vieler Geräte, die letzte
 * Antwort) lösen nur einmal aus.
 */
export async function settleQuestion(sessionId: string): Promise<void> {
  const session = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: { phase: true, version: true, currentIndex: true, questionEndsAt: true }
  })
  if (!session || session.phase !== 'QUESTION') return

  let due = session.questionEndsAt !== null && Date.now() > session.questionEndsAt.getTime() + ANSWER_GRACE_MS
  if (!due) {
    const [players, answered] = await Promise.all([
      prisma.livePlayer.count({ where: { sessionId } }),
      prisma.liveResponse.count({ where: { question: { sessionId, position: session.currentIndex } } })
    ])
    due = players > 0 && answered >= players
  }
  if (!due) return

  const { count } = await prisma.liveSession.updateMany({
    where: { id: sessionId, phase: 'QUESTION', version: session.version },
    data: { phase: 'REVEAL', version: { increment: 1 } }
  })
  if (count > 0) notifyLive(sessionId)
}

export type LiveControl = 'next' | 'finish' | 'lock' | 'unlock' | 'uncover'

/**
 * Schaltet die Runde weiter (nur Verwaltung, Berechtigung prüft der Aufrufer). `version` ist der
 * Stand, den die Leinwand gesehen hat - ein doppelter Klick oder zwei Leinwände schalten so nicht
 * zweimal weiter. Gibt false zurück, wenn sich inzwischen etwas geändert hat.
 *
 * 'uncover' deckt bei einer Frage mit Aufdeck-Bild ein weiteres Stück auf.
 *
 * LOBBY -> Frage 1 -> (Zeitablauf/alle/Knopf) REVEAL -> [LEADERBOARD nach Quizfragen] -> Frage 2 … -> FINISHED
 */
export async function controlLive(sessionId: string, op: LiveControl, version: number): Promise<boolean> {
  const session = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    include: { questions: { orderBy: { position: 'asc' }, include: { answers: { select: { isCorrect: true } } } } }
  })
  if (!session || session.version !== version) return false
  // Nach Quizfragen kommt die Rangliste, nach Umfragen und Wortwolken direkt die nächste Frage.

  const now = new Date()
  const guard = { id: sessionId, version }
  const finish = { phase: 'FINISHED' as const, pin: null, finishedAt: now, questionEndsAt: null }
  let data: Parameters<typeof prisma.liveSession.updateMany>[0]['data']

  if (op === 'lock' || op === 'unlock') {
    data = { joinLocked: op === 'lock' }
  } else if (op === 'uncover') {
    // Bild aufdecken: ein Stück mehr, nur während einer Frage mit Aufdeck-Bild.
    const current = session.questions[session.currentIndex]
    if (session.phase !== 'QUESTION' || !current?.imageReveal || !current.imageId) return false
    data = { revealSteps: { increment: 1 } }
  } else if (op === 'finish') {
    if (session.phase === 'FINISHED') return false
    data = finish
  } else {
    const startQuestion = (index: number) => {
      const question = session.questions[index]
      if (!question) return finish
      return {
        phase: 'QUESTION' as const,
        currentIndex: index,
        questionStartedAt: now,
        questionEndsAt: question.timeLimit ? new Date(now.getTime() + question.timeLimit * 1000) : null,
        revealSteps: 0,
        ...(session.startedAt ? {} : { startedAt: now })
      }
    }
    const current = session.questions[session.currentIndex]
    switch (session.phase) {
      case 'LOBBY':
        if (session.questions.length === 0) return false
        data = startQuestion(0)
        break
      case 'QUESTION':
        data = { phase: 'REVEAL' }
        break
      case 'REVEAL':
        data = current && isQuiz(current) ? { phase: 'LEADERBOARD' } : startQuestion(session.currentIndex + 1)
        break
      case 'LEADERBOARD':
        data = startQuestion(session.currentIndex + 1)
        break
      default:
        return false
    }
  }

  const { count } = await prisma.liveSession.updateMany({ where: guard, data: { ...data, version: { increment: 1 } } })
  if (count > 0) notifyLive(sessionId)
  return count > 0
}

// ---------------------------------------------------------------------------------------
// Punktestand

export type Standing = { playerId: string; nickname: string; score: number; rank: number }

/** Alle Teilnehmenden nach Punkten, gleiche Punkte = gleicher Platz (1, 1, 3). */
export async function standings(sessionId: string): Promise<Standing[]> {
  const [players, sums] = await Promise.all([
    prisma.livePlayer.findMany({ where: { sessionId }, select: { id: true, nickname: true }, orderBy: { createdAt: 'asc' } }),
    prisma.liveResponse.groupBy({ by: ['playerId'], where: { player: { sessionId } }, _sum: { points: true } })
  ])
  const score = new Map(sums.map(s => [s.playerId, s._sum.points ?? 0]))
  const sorted = players
    .map(p => ({ playerId: p.id, nickname: p.nickname, score: score.get(p.id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
  return sorted.map(row => ({ ...row, rank: sorted.findIndex(other => other.score === row.score) + 1 }))
}

// ---------------------------------------------------------------------------------------
// Antworten auswerten (gemeinsam für Ansicht, Verwaltungsseite und CSV-Export)

export type ResponseLike = {
  playerId: string
  answerId: string | null
  choices: string | null
  numberValue: number | null
  text: string | null
  textKey: string | null
  hidden: boolean
  points: number
}

/** Die gewählten Antwort-IDs einer Antwort (CHOICE: eine, MULTI: mehrere). */
export function chosenIds(r: Pick<ResponseLike, 'answerId' | 'choices'>): string[] {
  if (r.answerId) return [r.answerId]
  if (!r.choices) return []
  try {
    const ids: unknown = JSON.parse(r.choices)
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Wie oft jede Antwort gewählt wurde (bei Mehrfachauswahl zählt jede gewählte Antwort). */
export function answerCounts(responses: Pick<ResponseLike, 'answerId' | 'choices'>[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const r of responses) for (const id of chosenIds(r)) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

export type EstimateStats = { count: number; min: number; max: number; median: number; mean: number }

export function estimateStats(values: number[]): EstimateStats | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length
  return { count: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], median, mean }
}

export type WordCount = { key: string; text: string; count: number }

/** Wortwolke: Beiträge nach Schlüssel zusammengefasst (Schreibweise des ersten Beitrags), häufigste zuerst. */
export function wordCounts(responses: Pick<ResponseLike, 'text' | 'textKey' | 'hidden'>[], limit = 100): WordCount[] {
  const words = new Map<string, WordCount>()
  for (const r of responses) {
    if (!r.text || !r.textKey || r.hidden) continue
    const entry = words.get(r.textKey)
    if (entry) entry.count++
    else words.set(r.textKey, { key: r.textKey, text: r.text, count: 1 })
  }
  return [...words.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'de')).slice(0, limit)
}

/** Zahlen deutsch formatiert (Schätzfragen), höchstens zwei Nachkommastellen. */
export function formatNumber(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

/** Eine Antwort lesbar (Handy, Verwaltung, CSV). */
export function describeResponse(
  q: { kind: LiveQuestionKind; unit: string | null; answers: { id: string; label: string }[] },
  r: Pick<ResponseLike, 'answerId' | 'choices' | 'numberValue' | 'text'>
): string {
  switch (q.kind) {
    case 'ESTIMATE':
      return r.numberValue === null ? '' : `${formatNumber(r.numberValue)}${q.unit ? ` ${q.unit}` : ''}`
    case 'WORDCLOUD':
      return r.text ?? ''
    default: {
      const ids = chosenIds(r)
      return q.answers.filter(a => ids.includes(a.id)).map(a => a.label).join(', ')
    }
  }
}

/**
 * Ob eine Antwort richtig ist (nur Quizfragen). CHOICE: die gewählte Antwort ist eine der richtigen
 * (mehrere markierte = jede zählt), MULTI: genau die richtige Kombination, ESTIMATE: in der Toleranz.
 */
export function isCorrectResponse(
  q: { kind: LiveQuestionKind; target: number | null; tolerance: number | null; answers: { id: string; isCorrect: boolean }[] },
  r: Pick<ResponseLike, 'answerId' | 'choices' | 'numberValue'>
): boolean {
  if (!isQuiz(q)) return false
  if (q.kind === 'ESTIMATE') return r.numberValue !== null && estimatePoints(r.numberValue, q.target!, q.tolerance) > 0
  const ids = chosenIds(r)
  const correct = q.answers.filter(a => a.isCorrect).map(a => a.id)
  if (q.kind === 'CHOICE') return ids.length === 1 && correct.includes(ids[0])
  return ids.length === correct.length && correct.every(id => ids.includes(id))
}

// ---------------------------------------------------------------------------------------
// Ansichten (JSON für Leinwand und Teilnehmende, siehe app/live/use-live-view.ts)

export type LiveAnswerView = {
  id: string
  label: string
  /** Erst ab der Auflösung - vorher verrät die Antwort nichts. */
  correct?: boolean
  count?: number
}

export type LiveView = {
  /** Fingerabdruck des Inhalts - das Long-Polling antwortet, sobald er sich ändert. */
  sig: string
  /** Serverzeit (ms), damit der Countdown auch bei falsch gehender Geräteuhr stimmt. */
  now: number
  title: string
  phase: LivePhase
  version: number
  pin: string | null
  joinLocked: boolean
  questionCount: number
  /** Nummer der aktuellen Frage (0-basiert), -1 in der Lobby. */
  index: number
  playerCount: number
  hasQuiz: boolean
  question: null | {
    id: string
    kind: LiveQuestionKind
    text: string
    timeLimit: number | null
    endsAt: number | null
    quiz: boolean
    /** Bild zur Frage (app/api/live/bild/[imageId]). Aufdeck-Bilder auf den Handys erst ab der Auflösung. */
    imageId: string | null
    /**
     * Nur Leinwand, nur während einer Frage mit Aufdeck-Bild: Stand des Aufdeckens (Fragebeginn in
     * Serverzeit, von Hand aufgedeckte Stücke) - die Stücke selbst rechnet revealedTiles aus.
     */
    reveal?: { startedAt: number; steps: number }
    /** Teilnehmende: Das Bild wird gerade auf der Leinwand aufgedeckt (imageId ist dann null). */
    imageOnScreen?: boolean
    unit: string | null
    /** Nur CHOICE/MULTI. */
    answers: LiveAnswerView[]
    answeredCount: number
    /** Nur ESTIMATE, ab der Auflösung: richtiger Wert, Kennzahlen, für die Leinwand alle Werte. */
    estimate?: { target: number | null; stats: EstimateStats | null; values?: number[] }
    /** Nur WORDCLOUD: Leinwand schon während der Frage (live), Handys ab der Auflösung. */
    words?: WordCount[]
  }
  /** Nur Leinwand: alle Teilnehmenden (Lobby, zum Entfernen). */
  players?: { id: string; nickname: string }[]
  /** Rangliste (Leinwand: Top 5 bzw. Top 10 am Ende). */
  leaderboard?: Standing[]
  /** Nur Teilnehmende: eigener Stand (score/rank nur ab der Auflösung, sonst 0). */
  me?: {
    nickname: string
    score: number
    rank: number
    answered: boolean
    /** CHOICE/MULTI: gewählte Antworten (für die Formen auf dem Handy). */
    answerIds: string[]
    /** Die eigene Antwort lesbar ("8 m", "Pizza, Sushi", Wortbeitrag). */
    answerText: string | null
    points: number | null
    correct: boolean | null
  }
}

/**
 * Baut die Ansicht für die Leinwand (`playerId` null) oder eine teilnehmende Person. Richtige
 * Antworten und die Verteilung stehen erst ab der Auflösung darin - auch für die Leinwand,
 * deren Daten im Browser einsehbar wären. Ausnahme Wortwolke: Sie hat nichts zu verraten und
 * wächst auf der Leinwand live mit.
 */
export async function loadView(sessionId: string, playerId: string | null): Promise<LiveView | null> {
  const session = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    include: { questions: { orderBy: { position: 'asc' }, include: { answers: { orderBy: { position: 'asc' } } } } }
  })
  if (!session) return null

  const host = playerId === null
  const revealed = session.phase === 'REVEAL' || session.phase === 'LEADERBOARD' || session.phase === 'FINISHED'
  const current = session.questions[session.currentIndex] ?? null
  const showQuestion = current && session.phase !== 'FINISHED'
  // Der Punktestand kostet eine Abfrage über alle - nur laden, wo er angezeigt wird.
  const needsStandings = host ? session.phase === 'LEADERBOARD' || session.phase === 'FINISHED' : revealed

  const [players, playerCount, responses, table] = await Promise.all([
    host
      ? prisma.livePlayer.findMany({ where: { sessionId }, select: { id: true, nickname: true }, orderBy: { createdAt: 'asc' } })
      : prisma.livePlayer.findMany({ where: { id: playerId, sessionId }, select: { id: true, nickname: true } }),
    prisma.livePlayer.count({ where: { sessionId } }),
    current
      ? prisma.liveResponse.findMany({
          where: { questionId: current.id },
          select: { playerId: true, answerId: true, choices: true, numberValue: true, text: true, textKey: true, hidden: true, points: true }
        })
      : [],
    needsStandings ? standings(sessionId) : Promise.resolve([] as Standing[])
  ])
  if (!host && players.length === 0) return null

  const counts = answerCounts(responses)
  const quizNow = current ? isQuiz(current) : false

  let question: LiveView['question'] = null
  if (showQuestion) {
    question = {
      id: current.id,
      kind: current.kind,
      text: current.text,
      timeLimit: current.timeLimit,
      endsAt: session.phase === 'QUESTION' && session.questionEndsAt ? session.questionEndsAt.getTime() : null,
      quiz: quizNow,
      imageId: host || imageVisibleToPlayers(current, session) ? current.imageId : null,
      unit: current.unit,
      answers: current.kind === 'CHOICE' || current.kind === 'MULTI'
        ? current.answers.map(a => ({ id: a.id, label: a.label, ...(revealed ? { correct: a.isCorrect, count: counts.get(a.id) ?? 0 } : {}) }))
        : [],
      answeredCount: responses.length
    }
    if (current.imageReveal && current.imageId && session.phase === 'QUESTION') {
      if (host) question.reveal = { startedAt: session.questionStartedAt?.getTime() ?? 0, steps: session.revealSteps }
      else question.imageOnScreen = true
    }
    if (current.kind === 'ESTIMATE' && revealed) {
      const values = responses.map(r => r.numberValue).filter((v): v is number => v !== null)
      question.estimate = { target: current.target, stats: estimateStats(values), ...(host ? { values: values.slice(0, 500) } : {}) }
    }
    if (current.kind === 'WORDCLOUD' && (host || revealed)) question.words = wordCounts(responses)
  }

  const view: Omit<LiveView, 'sig' | 'now'> = {
    title: session.title,
    phase: session.phase,
    version: session.version,
    pin: session.pin,
    joinLocked: session.joinLocked,
    questionCount: session.questions.length,
    index: session.currentIndex,
    playerCount,
    hasQuiz: session.questions.some(isQuiz),
    question
  }

  if (host) {
    view.players = players
    if (session.phase === 'LEADERBOARD') view.leaderboard = table.slice(0, 5)
    if (session.phase === 'FINISHED') view.leaderboard = table.slice(0, 10)
  } else {
    const mine = table.find(row => row.playerId === playerId)
    const response = responses.find(r => r.playerId === playerId) ?? null
    view.me = {
      nickname: players[0].nickname,
      score: mine?.score ?? 0,
      rank: mine?.rank ?? 0,
      answered: !!response,
      answerIds: response ? chosenIds(response) : [],
      answerText: response && current ? describeResponse(current, response) : null,
      points: revealed && response ? response.points : null,
      correct: revealed && current && quizNow ? !!response && isCorrectResponse(current, response) : null
    }
    // Teilnehmende sehen am Ende nur das Treppchen, nicht die Liste aller anderen.
    if (session.phase === 'FINISHED') view.leaderboard = table.slice(0, 3)
  }

  const sig = createHash('sha1').update(JSON.stringify(view)).digest('base64url')
  return { ...view, sig, now: Date.now() }
}

// ---------------------------------------------------------------------------------------
// Ergebnisse für Verwaltungsseite und CSV-Export

export async function loadLiveResults(sessionId: string) {
  const [questions, table] = await Promise.all([
    prisma.liveQuestion.findMany({
      where: { sessionId },
      orderBy: { position: 'asc' },
      include: {
        answers: { orderBy: { position: 'asc' } },
        responses: {
          select: {
            playerId: true, answerId: true, choices: true, numberValue: true, text: true, textKey: true, hidden: true,
            points: true, elapsedMs: true, player: { select: { nickname: true } }
          }
        }
      }
    }),
    standings(sessionId)
  ])
  return {
    standings: table,
    questions: questions.map(q => {
      const values = q.responses.map(r => r.numberValue).filter((v): v is number => v !== null)
      return {
        ...q,
        quiz: isQuiz(q),
        counts: answerCounts(q.responses),
        estimate: q.kind === 'ESTIMATE' ? estimateStats(values) : null,
        words: q.kind === 'WORDCLOUD' ? wordCounts(q.responses, 1000) : []
      }
    })
  }
}
