import type { SurveyIdentity, SurveyQuestionKind } from '@prisma/client'
import { prisma } from './prisma'
import type { CurrentUser } from './auth'
import { formString } from './form'

/**
 * Fragebogen (docs/KONZEPT-FRAGEBOGEN.md, schema.prisma Survey): Berechtigung, Grenzen, Einlesen
 * einer Abgabe und Auswertung. Die Seiten und app/survey-actions.ts gehen alle hierüber.
 */

export const MAX_QUESTIONS = 50
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 20
/** Raster: Zeilen (Aussagen) und Spalten (Antwortmöglichkeiten) - mehr Spalten passen auch am Handy nicht mehr sinnvoll. */
export const MAX_GRID_ROWS = 20
export const MAX_GRID_COLUMNS = 10
export const MAX_TITLE_LENGTH = 200
/** Einstellbare Grenze "Abgaben pro Stunde und Netz" (Survey.submitLimit). */
export const MIN_SUBMIT_LIMIT = 10
export const MAX_SUBMIT_LIMIT = 5000
export const MAX_DESCRIPTION_LENGTH = 2000
export const MAX_THANKS_LENGTH = 1000
export const MAX_QUESTION_LENGTH = 300
export const MAX_HINT_LENGTH = 300
/** Text eines Überschrift/Text-Blocks (INFO) - darf länger sein als ein Hinweis unter einer Frage. */
export const MAX_INFO_TEXT_LENGTH = 2000
export const MAX_OPTION_LENGTH = 150
export const MAX_SCALE_LABEL_LENGTH = 40
/** Formularwert der Ausweich-Antwort eines Skalen-Rasters (statt einer Zahl). */
export const OPT_OUT_VALUE = 'x'
/** Freitext: einzeilig bzw. mehrzeilig. */
export const MAX_SHORT_TEXT = 300
export const MAX_LONG_TEXT = 2000
/** Lineare Skala: Anfang 0 oder 1, Ende 2 bis 10 (wie bei Google Forms). */
export const SCALE_MINS = [0, 1] as const
export const SCALE_MAX_MIN = 2
export const SCALE_MAX_MAX = 10
export const DEFAULT_SCALE = { min: 1, max: 5 }

export const SURVEY_QUESTION_KINDS: readonly SurveyQuestionKind[] = ['SINGLE', 'MULTI', 'TEXT', 'SCALE', 'GRID_SINGLE', 'GRID_MULTI', 'SCALE_GRID', 'INFO']
export const SURVEY_IDENTITIES: readonly SurveyIdentity[] = ['ANONYMOUS', 'COOKIE']

export const KIND_LABELS: Record<SurveyQuestionKind, string> = {
  SINGLE: 'Einfachauswahl',
  MULTI: 'Mehrfachauswahl',
  TEXT: 'Freitext',
  SCALE: 'Lineare Skala',
  GRID_SINGLE: 'Raster, eine Antwort pro Zeile',
  GRID_MULTI: 'Raster, mehrere Antworten pro Zeile',
  SCALE_GRID: 'Skalen-Raster',
  INFO: 'Überschrift / Text'
}

/** Überschrift/Text-Blöcke sind keine Fragen: keine Antwort, keine Nummer, nicht in der Auswertung. */
export function isQuestion(kind: SurveyQuestionKind): boolean {
  return kind !== 'INFO'
}

// Nummern (auch Überschriften als Titel einer Gruppe) - eigene Datei, weil auch der Editor im Browser sie braucht.
export { questionNumbers } from './survey-numbers'

/** Mitte einer Skala - zentrierte Werte (Mittelwert minus Mitte, bei 1-7 also -3 bis +3) wie in der UEQ-Auswertung. */
export function scaleCenter(range: { min: number; max: number }): number {
  return (range.min + range.max) / 2
}

export function isGrid(kind: SurveyQuestionKind): kind is 'GRID_SINGLE' | 'GRID_MULTI' {
  return kind === 'GRID_SINGLE' || kind === 'GRID_MULTI'
}

export const IDENTITY_LABELS: Record<SurveyIdentity, { title: string; short: string; hint: string }> = {
  ANONYMOUS: {
    title: 'Anonym',
    short: 'anonym',
    hint: 'Jede Abgabe zählt als neue Antwort, im Browser wird nichts gespeichert. Funktioniert auch eingebettet in jeder App. Mehrfaches Ausfüllen lässt sich nicht verhindern, nur bremsen.'
  },
  COOKIE: {
    title: 'Einmal pro Gerät',
    short: 'einmal pro Gerät',
    hint: 'Eine Antwort pro Browser (Cookie wie bei Abstimmungen), änderbar bis zum Ende. Eingebettet nur in Apps unter derselben Domain - in anderen Apps (z.B. der Campus-App) blockieren Browser das Cookie, dort öffnet sich der Fragebogen dann in einem neuen Tab.'
  }
}

/**
 * owner:     alles (bearbeiten, schließen, exportieren, Antworten löschen, löschen, teilen)
 * moderator: per SurveyAccess geteilt - alles außer löschen und weiter teilen (wie bei Live-Runden)
 */
export type SurveyLevel = 'owner' | 'moderator'

/** DIE Berechtigungsprüfung für Fragebögen - jede Verwaltungsseite und jede Action geht hierüber. */
export async function getSurveyLevel(user: CurrentUser | null, survey: { id: string; ownerId: string }): Promise<SurveyLevel | null> {
  if (!user) return null
  if (user.role === 'ADMIN' || user.id === survey.ownerId) return 'owner'
  const access = await prisma.surveyAccess.findUnique({ where: { surveyId_userId: { surveyId: survey.id, userId: user.id } }, select: { id: true } })
  return access ? 'moderator' : null
}

export function isSurveyOpen(survey: { closedAt: Date | null; closesAt: Date | null }, now = new Date()): boolean {
  return !survey.closedAt && (survey.closesAt === null || survey.closesAt > now)
}

/** Ein Fragebogen ist "zu Ende" am Schließzeitpunkt, sonst am Schließdatum, falls das schon vorbei ist. */
export function surveyEndedAt(survey: { closedAt: Date | null; closesAt: Date | null }, now = new Date()): Date | null {
  return survey.closedAt ?? (survey.closesAt && survey.closesAt <= now ? survey.closesAt : null)
}

export function surveyVoterKey(token: string): string {
  return `cookie:${token}`
}

/** Das Feld einer Frage im Formular zum Ausfüllen - beim Raster eins je Zeile. */
export function answerField(questionId: string, rowId?: string): string {
  return rowId ? `q_${questionId}_${rowId}` : `q_${questionId}`
}

/** Textfeld einer Antwortmöglichkeit mit allowText ("Sonstiges: ___"). */
export function otherTextField(questionId: string, optionId: string): string {
  return `q_${questionId}_text_${optionId}`
}

/** Teilt die Optionen einer Frage in Spalten bzw. Antwortmöglichkeiten (columns) und Rasterzeilen (rows). */
export function splitOptions<T extends { isRow: boolean }>(options: T[]): { columns: T[]; rows: T[] } {
  return { columns: options.filter(o => !o.isRow), rows: options.filter(o => o.isRow) }
}

export type QuestionForForm = {
  id: string
  kind: SurveyQuestionKind
  required: boolean
  maxChoices: number | null
  multiline: boolean
  scaleMin: number | null
  scaleMax: number | null
  optOutLabel?: string | null
  options: { id: string; isRow: boolean; allowText?: boolean }[]
}

export function scaleRange(q: Pick<QuestionForForm, 'scaleMin' | 'scaleMax'>): { min: number; max: number } {
  return { min: q.scaleMin ?? DEFAULT_SCALE.min, max: q.scaleMax ?? DEFAULT_SCALE.max }
}

export type AnswerRow = { questionId: string; optionId: string | null; rowId?: string | null; text: string | null; number: number | null; optOut?: boolean }

/** Fehler beim Einlesen, als ?hinweis= an die Seite (feste Texte dort). */
export type SubmitError = 'pflicht' | 'auswahl'

/**
 * Liest eine Abgabe (Felder q_<Frage-ID>, beim Raster q_<Frage-ID>_<Zeilen-ID>, siehe survey-view.tsx). Nur
 * Optionen der jeweiligen Frage, Einfachauswahl und Skala genau ein Wert, Texte gekürzt. Pflichtfragen ohne
 * Antwort (beim Raster: eine Zeile ohne Antwort) und zu viele Kreuze bei Mehrfachauswahl lehnen ab - die Seite prüft das schon im Browser, ohne JavaScript
 * landet es hier.
 */
export function parseSurveyAnswers(questions: QuestionForForm[], formData: FormData): { ok: true; rows: AnswerRow[] } | { ok: false; error: SubmitError } {
  const rows: AnswerRow[] = []
  for (const q of questions) {
    const name = answerField(q.id)
    const given: AnswerRow[] = []
    if (q.kind === 'INFO') continue
    // Eine Skalenangabe aus dem Formular: leer = keine Antwort, sonst eine ganze Zahl im Bereich.
    const scaleValue = (raw: string): number | null | 'invalid' => {
      if (raw === '') return null
      const value = Number.parseInt(raw, 10)
      const { min, max } = scaleRange(q)
      return /^\d+$/.test(raw) && value >= min && value <= max ? value : 'invalid'
    }
    if (q.kind === 'SCALE_GRID') {
      for (const row of splitOptions(q.options).rows) {
        const raw = formString(formData, answerField(q.id, row.id), 5)
        // Ausweich-Antwort ("nicht genutzt"): beantwortet, aber ohne Wert - nur, wenn die Frage eine hat.
        if (raw === OPT_OUT_VALUE && q.optOutLabel) {
          given.push({ questionId: q.id, optionId: null, rowId: row.id, text: null, number: null, optOut: true })
          continue
        }
        const value = scaleValue(raw)
        if (value === 'invalid') return { ok: false, error: 'auswahl' }
        if (value === null && q.required) return { ok: false, error: 'pflicht' }
        if (value !== null) given.push({ questionId: q.id, optionId: null, rowId: row.id, text: null, number: value })
      }
    } else if (isGrid(q.kind)) {
      const { columns, rows: gridRows } = splitOptions(q.options)
      const ids = new Set(columns.map(o => o.id))
      for (const row of gridRows) {
        const chosen = [...new Set(formData.getAll(answerField(q.id, row.id)).filter((v): v is string => typeof v === 'string' && ids.has(v)))]
        if (q.kind === 'GRID_SINGLE' && chosen.length > 1) return { ok: false, error: 'auswahl' }
        if (q.required && chosen.length === 0) return { ok: false, error: 'pflicht' }
        for (const optionId of chosen) given.push({ questionId: q.id, optionId, rowId: row.id, text: null, number: null })
      }
    } else if (q.kind === 'SINGLE' || q.kind === 'MULTI') {
      const columns = q.options.filter(o => !o.isRow)
      const ids = new Set(columns.map(o => o.id))
      const chosen = [...new Set(formData.getAll(name).filter((v): v is string => typeof v === 'string' && ids.has(v)))]
      if (q.kind === 'SINGLE' && chosen.length > 1) return { ok: false, error: 'auswahl' }
      if (q.kind === 'MULTI' && q.maxChoices !== null && chosen.length > q.maxChoices) return { ok: false, error: 'auswahl' }
      // Text nur zu einer GEWÄHLTEN Option mit Textfeld - ein Text ohne Kreuz zählt nicht (der Browser kreuzt beim Tippen selbst an).
      for (const optionId of chosen) {
        const withText = columns.find(o => o.id === optionId)?.allowText
        given.push({ questionId: q.id, optionId, text: withText ? formString(formData, otherTextField(q.id, optionId), MAX_SHORT_TEXT) || null : null, number: null })
      }
    } else if (q.kind === 'TEXT') {
      const text = formString(formData, name, q.multiline ? MAX_LONG_TEXT : MAX_SHORT_TEXT)
      if (text) given.push({ questionId: q.id, optionId: null, text, number: null })
    } else {
      const value = scaleValue(formString(formData, name, 5))
      if (value === 'invalid') return { ok: false, error: 'auswahl' }
      if (value !== null) given.push({ questionId: q.id, optionId: null, text: null, number: value })
    }
    if (q.required && given.length === 0) return { ok: false, error: 'pflicht' }
    rows.push(...given)
  }
  return { ok: true, rows }
}

export type ScaleStats = { count: number; mean: number; median: number; distribution: { value: number; count: number }[] }

export function scaleStats(values: number[], min: number, max: number): ScaleStats | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const distribution = Array.from({ length: max - min + 1 }, (_, i) => ({ value: min + i, count: sorted.filter(v => v === min + i).length }))
  return { count: values.length, mean: sorted.reduce((s, v) => s + v, 0) / sorted.length, median, distribution }
}

export function formatDecimal(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 1 })
}

/**
 * Alles für Übersicht und CSV-Export: Fragen mit Auswertung (answered = Zahl der Antwortenden
 * dieser Frage, Auswahl als Anteil davon) und die einzelnen Abgaben.
 */
export async function loadSurveyResults(surveyId: string) {
  const [questions, responses] = await Promise.all([
    prisma.surveyQuestion.findMany({
      where: { surveyId },
      orderBy: { position: 'asc' },
      include: { options: { orderBy: { position: 'asc' } } }
    }),
    prisma.surveyResponse.findMany({
      where: { surveyId },
      orderBy: { createdAt: 'asc' },
      include: { answers: { select: { questionId: true, optionId: true, rowId: true, text: true, number: true, optOut: true } } }
    })
  ])

  const results = questions.map(q => {
    const answers = responses.flatMap(r => r.answers.filter(a => a.questionId === q.id).map(a => ({ ...a, at: r.updatedAt })))
    const answered = new Set(responses.filter(r => r.answers.some(a => a.questionId === q.id)).map(r => r.id)).size
    // counts: je Option bzw. beim Raster je Feld (gridKey); rowAnswered: Antwortende je Rasterzeile.
    const counts = new Map<string, number>()
    const rowAnswered = new Map<string, number>()
    // Texte zu Antwortmöglichkeiten mit Textfeld ("Sonstiges: ___"), neueste zuerst.
    const optionTexts = new Map<string, string[]>()
    for (const a of [...answers].reverse()) {
      if (a.optionId && !a.rowId && a.text) optionTexts.set(a.optionId, [...(optionTexts.get(a.optionId) ?? []), a.text])
    }
    for (const a of answers) {
      if (!a.optionId) continue
      const key = a.rowId ? gridKey(a.rowId, a.optionId) : a.optionId
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    if (isGrid(q.kind)) {
      for (const r of responses) {
        for (const rowId of new Set(r.answers.filter(a => a.questionId === q.id && a.rowId).map(a => a.rowId!))) rowAnswered.set(rowId, (rowAnswered.get(rowId) ?? 0) + 1)
      }
    }
    const { min, max } = scaleRange(q)
    const numbers = (list: typeof answers) => list.flatMap(a => (a.number !== null ? [a.number] : []))
    // Skalen-Raster: Statistik je Zeile, scale über alle Zeilen (z.B. der Skalenwert "pragmatische Qualität" im UEQ-S).
    // Ausweich-Antworten zählen getrennt (rowOptOut), nie im Mittelwert - numbers() nimmt nur echte Werte.
    const rowScale = new Map<string, ScaleStats | null>()
    const rowOptOut = new Map<string, number>()
    if (q.kind === 'SCALE_GRID') {
      for (const row of q.options.filter(o => o.isRow)) {
        rowScale.set(row.id, scaleStats(numbers(answers.filter(a => a.rowId === row.id)), min, max))
        rowOptOut.set(row.id, answers.filter(a => a.rowId === row.id && a.optOut).length)
      }
    }
    return {
      ...q,
      ...splitOptions(q.options),
      answered,
      counts,
      rowAnswered,
      optionTexts,
      rowScale,
      rowOptOut,
      scale: q.kind === 'SCALE' || q.kind === 'SCALE_GRID' ? scaleStats(numbers(answers), min, max) : null,
      // Neueste zuerst - beim Lesen von Feedback interessiert meist das Aktuelle.
      texts: q.kind === 'TEXT' ? answers.flatMap(a => (a.text ? [{ text: a.text, at: a.at }] : [])).reverse() : []
    }
  })
  return { questions: results, responses }
}

export type SurveyResults = Awaited<ReturnType<typeof loadSurveyResults>>

/** Schlüssel eines Rasterfelds in SurveyResults counts. */
export function gridKey(rowId: string, columnId: string): string {
  return `${rowId}:${columnId}`
}

/** Bezeichnung einer Zeile eines Skalen-Rasters: "links ↔ rechts" bei einem Gegensatzpaar, sonst die Aussage. */
export function scaleRowLabel(row: { label: string; labelRight: string | null }): string {
  return row.labelRight ? `${row.label} ↔ ${row.labelRight}` : row.label
}

/** Spalten einer Frage im CSV: eine je Frage, beim Skalen-Raster eine je Zeile (für die Auswertung je Item). */
export function csvColumns(q: SurveyResults['questions'][number]): { header: string; value: (answers: AnswerRow[]) => string }[] {
  if (q.kind === 'INFO') return []
  if (q.kind === 'SCALE_GRID') {
    return q.rows.map(row => ({
      header: `${q.text}: ${scaleRowLabel(row)}`,
      value: answers => {
        const answer = answers.find(a => a.questionId === q.id && a.rowId === row.id)
        if (answer?.optOut) return q.optOutLabel ?? ''
        return answer?.number === undefined || answer.number === null ? '' : String(answer.number)
      }
    }))
  }
  return [{ header: q.text, value: answers => describeAnswer(q, answers) }]
}

/**
 * Fingerabdruck einer Abgabe: gleiche Antworten = gleicher Wert. Viele identische Abgaben in kurzer Zeit sind ein
 * Hinweis auf ein Skript (die Verwaltung zeigt sie gruppiert und kann sie gemeinsam löschen).
 */
export function responseSignature(answers: AnswerRow[]): string {
  return answers
    .map(a => [a.questionId, a.rowId ?? '', a.optionId ?? '', a.number ?? '', a.optOut ? 'x' : '', (a.text ?? '').trim().toLowerCase()].join('\u0001'))
    .sort()
    .join('\u0002')
}

/** Wie viele Abgaben in den letzten `ms` Millisekunden kamen (Hinweis auf Bursts in der Verwaltung). */
export function countSince(responses: { createdAt: Date }[], ms: number, now = Date.now()): number {
  return responses.filter(r => r.createdAt.getTime() > now - ms).length
}

/** Antwort einer Abgabe auf eine Frage als Text (CSV, eine Zelle je Frage). */
export function describeAnswer(q: SurveyResults['questions'][number], answers: AnswerRow[]): string {
  const mine = answers.filter(a => a.questionId === q.id)
  if (isGrid(q.kind)) {
    // "Zeile: Spalte, Spalte; Zeile: Spalte" - in der Reihenfolge des Fragebogens.
    return q.rows.flatMap(row => {
      const chosen = q.columns.filter(c => mine.some(a => a.rowId === row.id && a.optionId === c.id)).map(c => c.label)
      return chosen.length ? [`${row.label}: ${chosen.join(', ')}`] : []
    }).join('; ')
  }
  if (q.kind === 'SINGLE' || q.kind === 'MULTI') {
    return q.columns.flatMap(o => {
      const answer = mine.find(a => a.optionId === o.id)
      return answer ? [answer.text ? `${o.label}: ${answer.text}` : o.label] : []
    }).join(', ')
  }
  if (q.kind === 'TEXT') return mine[0]?.text ?? ''
  return mine[0]?.number !== undefined && mine[0]?.number !== null ? String(mine[0].number) : ''
}
