// app/lib/survey-summary.ts
//
// KI-Zusammenfassung der Freitext-Antworten eines Fragebogens (README „Fragebögen“, Abschnitt KI-Zusammenfassung):
// Aufgabe für askAi (suite-kit) bauen und die Antwort lesen. Rein (Unit-Tests); den Aufruf macht summarizeSurveyQuestion
// in app/survey-actions.ts. Die Antworten gehen nummeriert und ohne jede Kennung raus, die KI ordnet jedem Thema
// Nummern zu - Anzahl und Zitate rechnet die Seite aus den echten Antworten, nicht aus dem Text der KI.

import type { AiTask } from 'suite-kit'

/** So viele Antworten gehen höchstens mit (die neuesten) - hält die Anfrage klein. */
export const SUMMARY_MAX_ANSWERS = 400
/** Jede Antwort wird dafür auf so viele Zeichen gekürzt. */
export const SUMMARY_ANSWER_CHARS = 600
/** Erst ab so vielen Antworten lohnt eine Zusammenfassung. */
export const SUMMARY_MIN_ANSWERS = 3
export const SUMMARY_MAX_THEMES = 8

export type SummaryAnswer = { id: string; text: string }
export type SummaryTheme = { title: string; description: string; answerIds: string[] }
export type Summary = { overview: string; themes: SummaryTheme[] }

const INSTRUCTIONS = [
  'Du wertest die Freitext-Antworten auf eine Frage aus einem Fragebogen aus und fasst sie für die Veranstalter*innen',
  `zusammen. Bilde höchstens ${SUMMARY_MAX_THEMES} Themen, die häufigsten zuerst. Je Thema: "titel" (2 bis 6 Wörter),`,
  '"beschreibung" (ein Satz: was die Antwortenden dazu sagen, ohne zu werten) und "antworten" (die Nummern aller',
  'Antworten, die das Thema ansprechen, die treffendsten zuerst; eine Antwort darf zu mehreren Themen gehören). Dazu',
  '"ueberblick": ein bis drei Sätze zum Gesamtbild (Stimmung, wichtigste Punkte). Nur zusammenfassen, was in den',
  'Antworten steht, nichts erfinden und keine Namen von Personen nennen. Antworten ohne Inhalt (z.B. "-", "nichts",',
  '"passt") keinem Thema zuordnen. Antworte auf Deutsch, auch wenn Antworten in einer anderen Sprache sind.'
].join(' ')

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ueberblick', 'themen'],
  properties: {
    ueberblick: { type: 'string' },
    themen: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titel', 'beschreibung', 'antworten'],
        properties: { titel: { type: 'string' }, beschreibung: { type: 'string' }, antworten: { type: 'array', items: { type: 'integer' } } }
      }
    }
  }
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Die Antworten, die an die KI gehen: nicht leer, die neuesten SUMMARY_MAX_ANSWERS (Eingabe: neueste zuerst). */
export function summaryAnswers(newestFirst: SummaryAnswer[]): SummaryAnswer[] {
  return newestFirst.filter(answer => answer.text.trim()).slice(0, SUMMARY_MAX_ANSWERS)
}

/** Text zur Anfrage: Fragebogen, Frage und die Antworten nummeriert (Nummern statt IDs - kürzer, verrät nichts). */
export function summaryPrompt({ survey, question, hint }: { survey: string; question: string; hint?: string | null }, answers: SummaryAnswer[]): string {
  return [
    `Fragebogen: ${oneLine(survey, 200)}`,
    `Frage: ${oneLine(question, 300)}${hint ? ` (Hinweis: ${oneLine(hint, 300)})` : ''}`,
    `Antworten (${answers.length}):`,
    ...answers.map((answer, index) => `${index + 1}. ${oneLine(answer.text, SUMMARY_ANSWER_CHARS)}`)
  ].join('\n')
}

/** Aufgabe für askAi. `answers` aus summaryAnswers - dieselbe Reihenfolge braucht readSurveySummary. */
export function summaryTask(context: { survey: string; question: string; hint?: string | null }, answers: SummaryAnswer[]): AiTask {
  return {
    instructions: INSTRUCTIONS,
    input: [{ type: 'input_text', text: summaryPrompt(context, answers) }],
    schemaName: 'zusammenfassung',
    schema: SCHEMA,
    maxOutputTokens: 4000
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * Antwort der KI lesen (JSON aus askAi): Nummern zurück auf die Antworten (`answers` wie in der Anfrage), unbekannte
 * und doppelte verwerfen, Themen ohne Antwort weglassen, Texte kürzen, höchstens SUMMARY_MAX_THEMES Themen, sortiert
 * nach Zahl der Antworten. null, wenn die Antwort nicht zum Schema passt.
 */
export function readSurveySummary(value: unknown, answers: SummaryAnswer[]): Summary | null {
  if (!isRecord(value) || typeof value.ueberblick !== 'string' || !Array.isArray(value.themen)) return null
  const themes: SummaryTheme[] = []
  for (const theme of value.themen) {
    if (!isRecord(theme) || typeof theme.titel !== 'string' || typeof theme.beschreibung !== 'string' || !Array.isArray(theme.antworten)) return null
    const ids = new Set<string>()
    for (const number of theme.antworten) {
      const answer = Number.isInteger(number) ? answers[(number as number) - 1] : undefined
      if (answer) ids.add(answer.id)
    }
    const title = oneLine(theme.titel, 80)
    if (!title || ids.size === 0) continue
    themes.push({ title, description: oneLine(theme.beschreibung, 300), answerIds: [...ids] })
  }
  themes.sort((a, b) => b.answerIds.length - a.answerIds.length)
  return { overview: oneLine(value.ueberblick, 600), themes: themes.slice(0, SUMMARY_MAX_THEMES) }
}

/** Gespeicherte Themen (SurveySummary.themes) lesen; Unlesbares ergibt eine leere Liste. */
export function parseStoredThemes(json: string): SummaryTheme[] {
  try {
    const value: unknown = JSON.parse(json)
    if (!Array.isArray(value)) return []
    return value.filter((theme): theme is SummaryTheme =>
      isRecord(theme) && typeof theme.title === 'string' && typeof theme.description === 'string' &&
      Array.isArray(theme.answerIds) && theme.answerIds.every(id => typeof id === 'string'))
  } catch {
    return []
  }
}

/** Darf diese Antwort an die KI? Nur wenn sie nach dem Einschalten abgegeben oder geändert wurde (Hinweis gesehen). */
export function summaryAllowed(aiSince: Date | null, answeredAt: Date): boolean {
  return aiSince !== null && answeredAt >= aiSince
}
