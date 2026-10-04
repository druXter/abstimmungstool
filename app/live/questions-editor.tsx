'use client'

import { useState } from 'react'
import { ANSWER_STYLES, AnswerShape } from './shapes'

export type EditorQuestion = { text: string; timeLimit: number; answers: { label: string; correct: boolean }[] }

// Spiegeln die Grenzen aus app/lib/live.ts (die Server Action prüft selbst noch einmal).
const MAX_QUESTIONS = 50
const MIN_ANSWERS = 2
const MAX_ANSWERS = 6
const TIME_LIMITS = [5, 10, 20, 30, 60, 90, 120, 240]

function emptyQuestion(): EditorQuestion {
  return { text: '', timeLimit: 20, answers: Array.from({ length: 4 }, () => ({ label: '', correct: false })) }
}

/**
 * Fragen einer Live-Runde bearbeiten: Text, Zeitlimit, 2-6 Antworten, optional richtige
 * Antwort(en). Die Felder heißen q<i>_text, q<i>_time, q<i>_a<j>, q<i>_c<j> (gelesen von
 * parseQuestions in app/live-actions.ts) und werden nach jedem Verschieben/Löschen neu durchnummeriert.
 */
export default function QuestionsEditor({ initial }: { initial?: EditorQuestion[] }) {
  // Stabile Schlüssel, damit React beim Verschieben die richtigen Felder behält.
  const [questions, setQuestions] = useState(() => (initial?.length ? initial : [emptyQuestion()]).map((q, i) => ({ ...q, key: i })))
  const [nextKey, setNextKey] = useState(questions.length)

  const update = (index: number, change: (q: EditorQuestion) => EditorQuestion) =>
    setQuestions(qs => qs.map((q, i) => (i === index ? { ...change(q), key: q.key } : q)))

  const move = (index: number, delta: number) =>
    setQuestions(qs => {
      const target = index + delta
      if (target < 0 || target >= qs.length) return qs
      const copy = [...qs]
      ;[copy[index], copy[target]] = [copy[target], copy[index]]
      return copy
    })

  return (
    <div className="space-y-4">
      {questions.map((q, i) => (
        <fieldset key={q.key} className="rounded-md border border-gray-200 p-4 space-y-3">
          <legend className="text-sm font-medium px-1">Frage {i + 1}</legend>
          <div className="flex flex-wrap gap-2 justify-end text-xs">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-blue-700 hover:underline disabled:opacity-40">nach oben</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === questions.length - 1} className="text-blue-700 hover:underline disabled:opacity-40">nach unten</button>
            <button
              type="button" disabled={questions.length === 1}
              onClick={() => setQuestions(qs => qs.filter((_, other) => other !== i))}
              className="text-red-700 hover:underline disabled:opacity-40"
            >
              Frage entfernen
            </button>
          </div>
          <div>
            <label htmlFor={`q${i}_text`} className="sr-only">Frage {i + 1}</label>
            <input
              id={`q${i}_text`} name={`q${i}_text`} required maxLength={200} value={q.text}
              onChange={e => update(i, prev => ({ ...prev, text: e.target.value }))}
              placeholder="z.B. Wie viele Beine hat eine Spinne?"
              className="w-full border border-gray-300 p-2 rounded"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor={`q${i}_time`}>Zeitlimit</label>
            <select
              id={`q${i}_time`} name={`q${i}_time`} value={q.timeLimit}
              onChange={e => update(i, prev => ({ ...prev, timeLimit: Number(e.target.value) }))}
              className="border border-gray-300 p-1.5 rounded"
            >
              {TIME_LIMITS.map(t => <option key={t} value={t}>{t} Sekunden</option>)}
              <option value={0}>ohne (du löst auf)</option>
            </select>
          </div>
          <ul className="space-y-2">
            {q.answers.map((a, j) => (
              <li key={j} className="flex items-center gap-2">
                <span className={`${ANSWER_STYLES[j].bg} rounded p-1.5`}><AnswerShape index={j} className="w-4 h-4" /></span>
                <input
                  name={`q${i}_a${j}`} maxLength={100} value={a.label} required={j < MIN_ANSWERS} aria-label={`Frage ${i + 1}, Antwort ${j + 1}`}
                  onChange={e => update(i, prev => ({ ...prev, answers: prev.answers.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) }))}
                  placeholder={`Antwort ${j + 1}${j < MIN_ANSWERS ? '' : ' (optional)'}`}
                  className="grow min-w-0 border border-gray-300 p-2 rounded"
                />
                <label className="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap cursor-pointer">
                  <input
                    type="checkbox" name={`q${i}_c${j}`} checked={a.correct}
                    onChange={e => update(i, prev => ({ ...prev, answers: prev.answers.map((x, k) => (k === j ? { ...x, correct: e.target.checked } : x)) }))}
                    className="w-4 h-4"
                  />
                  richtig
                </label>
                {q.answers.length > MIN_ANSWERS && (
                  <button
                    type="button" aria-label={`Antwort ${j + 1} entfernen`}
                    onClick={() => update(i, prev => ({ ...prev, answers: prev.answers.filter((_, k) => k !== j) }))}
                    className="text-gray-400 hover:text-red-700 px-1"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {q.answers.length < MAX_ANSWERS && (
            <button
              type="button" onClick={() => update(i, prev => ({ ...prev, answers: [...prev.answers, { label: '', correct: false }] }))}
              className="text-sm text-blue-600 hover:underline"
            >
              + Antwort hinzufügen
            </button>
          )}
          <p className="text-xs text-gray-500">
            {q.answers.some(a => a.correct)
              ? 'Quizfrage: Wer richtig antwortet, bekommt Punkte - je schneller, desto mehr.'
              : 'Ohne richtige Antwort ist es eine reine Umfragefrage (keine Punkte).'}
          </p>
        </fieldset>
      ))}

      {questions.length < MAX_QUESTIONS && (
        <button
          type="button"
          onClick={() => {
            setQuestions(qs => [...qs, { ...emptyQuestion(), key: nextKey }])
            setNextKey(k => k + 1)
          }}
          className="text-sm text-blue-600 hover:underline"
        >
          + Weitere Frage
        </button>
      )}
    </div>
  )
}
