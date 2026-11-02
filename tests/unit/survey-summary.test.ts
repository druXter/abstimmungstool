import { describe, expect, it } from 'vitest'
import {
  parseStoredThemes, readSurveySummary, summaryAllowed, summaryAnswers, summaryPrompt, summaryTask, SUMMARY_ANSWER_CHARS, SUMMARY_MAX_ANSWERS, SUMMARY_MAX_THEMES,
  type SummaryAnswer
} from '../../app/lib/survey-summary'

const answers: SummaryAnswer[] = [
  { id: 'a', text: 'Mehr vegetarisches Essen\nbitte' },
  { id: 'b', text: 'Musik war zu laut' },
  { id: 'c', text: 'Essen war super' }
]

describe('KI-Zusammenfassung: Anfrage', () => {
  it('nummeriert die Antworten einzeilig, ohne IDs, mit Fragebogen und Frage', () => {
    const prompt = summaryPrompt({ survey: 'Feedback Winterball', question: 'Was sollen wir besser machen?', hint: 'ehrlich' }, answers)
    expect(prompt).toContain('Fragebogen: Feedback Winterball')
    expect(prompt).toContain('Frage: Was sollen wir besser machen? (Hinweis: ehrlich)')
    expect(prompt).toContain('1. Mehr vegetarisches Essen bitte\n2. Musik war zu laut\n3. Essen war super')
    expect(prompt).not.toMatch(/\b[abc]\b(?![a-zäöü])/)
  })

  it('nimmt die neuesten nicht leeren Antworten, höchstens SUMMARY_MAX_ANSWERS, und kürzt lange', () => {
    const many = Array.from({ length: SUMMARY_MAX_ANSWERS + 10 }, (_, index) => ({ id: `x${index}`, text: index === 0 ? '  ' : `Antwort ${index}` }))
    const chosen = summaryAnswers(many)
    expect(chosen).toHaveLength(SUMMARY_MAX_ANSWERS)
    expect(chosen[0].id).toBe('x1')
    const prompt = summaryPrompt({ survey: 's', question: 'q' }, [{ id: 'l', text: 'y'.repeat(5000) }])
    expect(prompt.split('\n').at(-1)).toHaveLength(`1. `.length + SUMMARY_ANSWER_CHARS)
  })

  it('verlangt das Schema und genug Platz für die Antwort', () => {
    const task = summaryTask({ survey: 's', question: 'q' }, answers)
    expect(task.schema).toMatchObject({ required: ['ueberblick', 'themen'], additionalProperties: false })
    expect(task.input).toHaveLength(1)
    expect(task.maxOutputTokens).toBeGreaterThanOrEqual(2000)
  })
})

describe('KI-Zusammenfassung: Antwort', () => {
  it('ordnet Nummern den Antworten zu, verwirft unbekannte und doppelte, sortiert nach Anzahl', () => {
    const summary = readSurveySummary({
      ueberblick: ' Gemischt. ',
      themen: [
        { titel: 'Musik', beschreibung: 'Zu laut.', antworten: [2, 2, 9] },
        { titel: 'Essen', beschreibung: 'Lob und Wünsche.', antworten: [3, 1, 0, 1.5] },
        { titel: 'Leer', beschreibung: 'nichts', antworten: [7] },
        { titel: '  ', beschreibung: 'ohne Titel', antworten: [1] }
      ]
    }, answers)
    expect(summary).toEqual({
      overview: 'Gemischt.',
      themes: [
        { title: 'Essen', description: 'Lob und Wünsche.', answerIds: ['c', 'a'] },
        { title: 'Musik', description: 'Zu laut.', answerIds: ['b'] }
      ]
    })
  })

  it('höchstens SUMMARY_MAX_THEMES Themen, Texte gekürzt', () => {
    const themen = Array.from({ length: SUMMARY_MAX_THEMES + 3 }, (_, index) => ({ titel: `T${index} ${'x'.repeat(200)}`, beschreibung: 'y'.repeat(900), antworten: [1] }))
    const summary = readSurveySummary({ ueberblick: 'z'.repeat(2000), themen }, answers)
    expect(summary?.themes).toHaveLength(SUMMARY_MAX_THEMES)
    expect(summary?.themes[0].title).toHaveLength(80)
    expect(summary?.themes[0].description).toHaveLength(300)
    expect(summary?.overview).toHaveLength(600)
  })

  it('unbrauchbare Antworten ergeben null', () => {
    expect(readSurveySummary(null, answers)).toBeNull()
    expect(readSurveySummary({ ueberblick: 'x' }, answers)).toBeNull()
    expect(readSurveySummary({ ueberblick: 'x', themen: [{ titel: 'a', beschreibung: 'b', antworten: 'c' }] }, answers)).toBeNull()
    expect(readSurveySummary({ ueberblick: 'x', themen: [] }, answers)).toEqual({ overview: 'x', themes: [] })
  })

  it('gespeicherte Themen lesen, Kaputtes verwerfen', () => {
    expect(parseStoredThemes(JSON.stringify([{ title: 'a', description: 'b', answerIds: ['x'] }, { title: 1 }]))).toEqual([{ title: 'a', description: 'b', answerIds: ['x'] }])
    expect(parseStoredThemes('kaputt')).toEqual([])
    expect(parseStoredThemes('{}')).toEqual([])
  })

  it('nur Antworten ab dem Einschalten', () => {
    const since = new Date('2026-11-02T10:00:00Z')
    expect(summaryAllowed(null, new Date())).toBe(false)
    expect(summaryAllowed(since, new Date('2026-11-02T09:59:59Z'))).toBe(false)
    expect(summaryAllowed(since, since)).toBe(true)
  })
})
