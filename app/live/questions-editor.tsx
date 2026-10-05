'use client'

import { useState } from 'react'
import type { LiveQuestionKind } from '@prisma/client'
import { ANSWER_STYLES, AnswerShape } from './shapes'

export type EditorQuestion = {
  text: string
  kind: LiveQuestionKind
  timeLimit: number
  answers: { label: string; correct: boolean }[]
  /** Schätzfrage: als Text, damit "1,5" beim Tippen nicht verloren geht. */
  target: string
  tolerance: string
  unit: string
  /** Bereits gespeichertes Bild (beim Bearbeiten). */
  imageId: string | null
  /** Bild auf der Leinwand nach und nach aufdecken. */
  imageReveal: boolean
}

// Spiegeln die Grenzen aus app/lib/live.ts und app/lib/live-images.ts (die Server Action prüft selbst noch einmal).
const MAX_QUESTIONS = 50
const MIN_ANSWERS = 2
const MAX_ANSWERS = 6
const TIME_LIMITS = [5, 10, 20, 30, 60, 90, 120, 240]
const IMAGE_MAX_SIDE = 1600

const KINDS: { kind: LiveQuestionKind; label: string; hint: string }[] = [
  { kind: 'CHOICE', label: 'Auswahl', hint: 'Eine Antwort wählen. Mit markierter richtiger Antwort eine Quizfrage (Punkte nach Schnelligkeit).' },
  { kind: 'MULTI', label: 'Mehrfachauswahl', hint: 'Mehrere Antworten wählen. Als Quiz zählt nur genau die richtige Kombination.' },
  { kind: 'ESTIMATE', label: 'Schätzfrage', hint: 'Eine Zahl schätzen. Mit richtigem Wert eine Quizfrage: Punkte nach Nähe, außerhalb der Toleranz keine.' },
  { kind: 'WORDCLOUD', label: 'Wortwolke', hint: 'Ein kurzer Begriff pro Person, die Leinwand zeigt eine Wortwolke. Keine Punkte; Unpassendes lässt sich dort ausblenden.' }
]

function emptyQuestion(): EditorQuestion {
  return {
    text: '', kind: 'CHOICE', timeLimit: 20, target: '', tolerance: '', unit: '', imageId: null, imageReveal: false,
    answers: Array.from({ length: 4 }, () => ({ label: '', correct: false }))
  }
}

/**
 * Verkleinert ein Bild im Browser und kodiert es als JPEG neu: kleinere Uploads, und EXIF-Daten
 * (z.B. der Aufnahmeort eines Handyfotos) fallen dabei weg. Transparenz wird weiß hinterlegt.
 */
async function shrinkImage(file: File): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob ? new File([blob], 'bild.jpg', { type: 'image/jpeg' }) : file
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Fragen einer Live-Runde bearbeiten: Text, Art, Zeitlimit, je nach Art Antworten (mit richtigen)
 * oder Schätzwert, optional ein Bild (auch zum Aufdecken). Die Felder heißen q<i>_… (gelesen von parseQuestions in
 * app/live-actions.ts) und werden nach jedem Verschieben/Löschen neu durchnummeriert.
 */
export default function QuestionsEditor({ initial }: { initial?: EditorQuestion[] }) {
  // Stabile Schlüssel, damit React beim Verschieben die richtigen Felder (auch die Dateiauswahl) behält.
  const [questions, setQuestions] = useState(() => (initial?.length ? initial : [emptyQuestion()]).map((q, i) => ({ ...q, key: i, preview: null as string | null })))
  const [nextKey, setNextKey] = useState(questions.length)

  const update = (index: number, change: (q: EditorQuestion) => Partial<EditorQuestion & { preview: string | null }>) =>
    setQuestions(qs => qs.map((q, i) => (i === index ? { ...q, ...change(q) } : q)))

  const move = (index: number, delta: number) =>
    setQuestions(qs => {
      const target = index + delta
      if (target < 0 || target >= qs.length) return qs
      const copy = [...qs]
      ;[copy[index], copy[target]] = [copy[target], copy[index]]
      return copy
    })

  const pickImage = async (index: number, input: HTMLInputElement) => {
    const file = input.files?.[0]
    if (!file) return update(index, () => ({ preview: null }))
    try {
      const small = await shrinkImage(file)
      const transfer = new DataTransfer()
      transfer.items.add(small)
      input.files = transfer.files
      update(index, () => ({ preview: URL.createObjectURL(small) }))
    } catch {
      // Kein dekodierbares Bild (oder alter Browser ohne DataTransfer): Originaldatei, der Server prüft.
      update(index, () => ({ preview: null }))
    }
  }

  return (
    <div className="space-y-4">
      {questions.map((q, i) => {
        const hasAnswers = q.kind === 'CHOICE' || q.kind === 'MULTI'
        return (
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
                onChange={e => update(i, () => ({ text: e.target.value }))}
                placeholder="z.B. Wie viele Beine hat eine Spinne?"
                className="w-full border border-gray-300 p-2 rounded"
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <label htmlFor={`q${i}_kind`}>Art</label>
                <select
                  id={`q${i}_kind`} name={`q${i}_kind`} value={q.kind}
                  onChange={e => update(i, () => ({ kind: e.target.value as LiveQuestionKind }))}
                  className="border border-gray-300 p-1.5 rounded"
                >
                  {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>
              </span>
              <span className="flex items-center gap-2">
                <label htmlFor={`q${i}_time`}>Zeitlimit</label>
                <select
                  id={`q${i}_time`} name={`q${i}_time`} value={q.timeLimit}
                  onChange={e => update(i, () => ({ timeLimit: Number(e.target.value) }))}
                  className="border border-gray-300 p-1.5 rounded"
                >
                  {TIME_LIMITS.map(t => <option key={t} value={t}>{t} Sekunden</option>)}
                  <option value={0}>ohne (du löst auf)</option>
                </select>
              </span>
            </div>
            <p className="text-xs text-gray-500">{KINDS.find(k => k.kind === q.kind)!.hint}</p>

            {hasAnswers && (
              <>
                <ul className="space-y-2">
                  {q.answers.map((a, j) => (
                    <li key={j} className="flex items-center gap-2">
                      <span className={`${ANSWER_STYLES[j].bg} rounded p-1.5`}><AnswerShape index={j} className="w-4 h-4" /></span>
                      <input
                        name={`q${i}_a${j}`} maxLength={100} value={a.label} required={j < MIN_ANSWERS} aria-label={`Frage ${i + 1}, Antwort ${j + 1}`}
                        onChange={e => update(i, prev => ({ answers: prev.answers.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) }))}
                        placeholder={`Antwort ${j + 1}${j < MIN_ANSWERS ? '' : ' (optional)'}`}
                        className="grow min-w-0 border border-gray-300 p-2 rounded"
                      />
                      <label className="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap cursor-pointer">
                        <input
                          type="checkbox" name={`q${i}_c${j}`} checked={a.correct}
                          onChange={e => update(i, prev => ({ answers: prev.answers.map((x, k) => (k === j ? { ...x, correct: e.target.checked } : x)) }))}
                          className="w-4 h-4"
                        />
                        richtig
                      </label>
                      {q.answers.length > MIN_ANSWERS && (
                        <button
                          type="button" aria-label={`Antwort ${j + 1} entfernen`}
                          onClick={() => update(i, prev => ({ answers: prev.answers.filter((_, k) => k !== j) }))}
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
                    type="button" onClick={() => update(i, prev => ({ answers: [...prev.answers, { label: '', correct: false }] }))}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    + Antwort hinzufügen
                  </button>
                )}
                <p className="text-xs text-gray-500">
                  {!q.answers.some(a => a.correct)
                    ? 'Ohne richtige Antwort ist es eine reine Umfragefrage (keine Punkte).'
                    : q.kind === 'CHOICE' && q.answers.filter(a => a.correct).length > 1
                      ? 'Quizfrage mit mehreren richtigen Antworten: Gewählt wird nur eine, jede der markierten zählt als richtig. Sollen alle zusammen gewählt werden, nimm "Mehrfachauswahl".'
                      : q.kind === 'MULTI'
                        ? 'Quizfrage: Punkte nur, wer genau alle markierten Antworten wählt - je schneller, desto mehr.'
                        : 'Quizfrage: Wer richtig antwortet, bekommt Punkte - je schneller, desto mehr.'}
                </p>
              </>
            )}

            {q.kind === 'ESTIMATE' && (
              <div className="grid gap-2 sm:grid-cols-3 text-sm">
                <label className="space-y-1">
                  <span className="block">Richtiger Wert (optional)</span>
                  <input
                    name={`q${i}_target`} inputMode="decimal" value={q.target} onChange={e => update(i, () => ({ target: e.target.value }))}
                    aria-label={`Frage ${i + 1}, richtiger Wert`} placeholder="z.B. 8848" className="w-full border border-gray-300 p-2 rounded"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block">Toleranz (±)</span>
                  <input
                    name={`q${i}_tolerance`} inputMode="decimal" value={q.tolerance} onChange={e => update(i, () => ({ tolerance: e.target.value }))}
                    aria-label={`Frage ${i + 1}, Toleranz`} placeholder="Standard: 10 %" className="w-full border border-gray-300 p-2 rounded"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block">Einheit (optional)</span>
                  <input
                    name={`q${i}_unit`} maxLength={20} value={q.unit} onChange={e => update(i, () => ({ unit: e.target.value }))}
                    aria-label={`Frage ${i + 1}, Einheit`} placeholder="z.B. m" className="w-full border border-gray-300 p-2 rounded"
                  />
                </label>
                <p className="sm:col-span-3 text-xs text-gray-500">
                  {q.target.trim()
                    ? 'Quizfrage: genau getroffen 1000 Punkte, am Rand der Toleranz 500, außerhalb keine.'
                    : 'Ohne richtigen Wert eine reine Umfrage: Die Leinwand zeigt Median, Durchschnitt und die Verteilung.'}
                </p>
              </div>
            )}

            <div className="text-sm space-y-2">
              <label className="block">
                <span className="block mb-1">Bild (optional, wird auf der Leinwand und den Handys gezeigt)</span>
                <input
                  type="file" name={`q${i}_image`} accept="image/jpeg,image/png,image/webp,image/gif"
                  aria-label={`Frage ${i + 1}, Bild`}
                  onChange={e => pickImage(i, e.currentTarget)}
                  className="text-sm"
                />
              </label>
              {q.imageId && <input type="hidden" name={`q${i}_imageId`} value={q.imageId} />}
              {(q.preview || q.imageId) && (
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Vorschau aus dem eigenen Speicher bzw. lokaler Datei */}
                  <img src={q.preview ?? `/api/live/bild/${q.imageId}`} alt={`Bild zu Frage ${i + 1}`} className="max-h-32 rounded border" />
                  <div className="space-y-2">
                    <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox" name={`q${i}_reveal`} checked={q.imageReveal}
                        onChange={e => update(i, () => ({ imageReveal: e.target.checked }))}
                        className="w-4 h-4"
                      />
                      Nach und nach aufdecken
                    </label>
                    {q.imageId && !q.preview && (
                      <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                        <input type="checkbox" name={`q${i}_noimage`} className="w-4 h-4" />
                        Bild entfernen
                      </label>
                    )}
                  </div>
                </div>
              )}
              {q.imageReveal && (q.preview || q.imageId) && (
                <p className="text-xs text-gray-500">
                  Zum Erraten (z.B. Promi oder Sehenswürdigkeit): Die Leinwand legt 25 Kacheln über das Bild,{' '}
                  {q.timeLimit
                    ? 'die bis zum Ende des Zeitlimits nach und nach aufgehen; mit "Stück aufdecken" geht es schneller.'
                    : 'die du mit "Stück aufdecken" einzeln öffnest.'}
                  {' '}Auf den Handys erscheint das Bild erst bei der Auflösung.
                </p>
              )}
            </div>
          </fieldset>
        )
      })}

      {questions.length < MAX_QUESTIONS && (
        <button
          type="button"
          onClick={() => {
            setQuestions(qs => [...qs, { ...emptyQuestion(), key: nextKey, preview: null }])
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
