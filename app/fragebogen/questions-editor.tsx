'use client'

import { useState } from 'react'
import type { SurveyQuestionKind } from '@prisma/client'
import { attachment } from '../lib/survey-numbers'

export type EditorQuestion = {
  text: string
  hint: string
  kind: SurveyQuestionKind
  required: boolean
  /** Titel nur für Screenreader und Auswertung - die Frage schließt ohne Nummer und Trennlinie an die vorige an. */
  hideTitle: boolean
  /** Auswahl: Antwortmöglichkeiten, Raster: Spalten. */
  options: string[]
  /** Nur Raster und Skalen-Raster: Zeilen (Aussagen bzw. linker Begriff eines Gegensatzpaars). */
  rows: string[]
  /** Nur Skalen-Raster: rechter Begriff je Zeile, leer = Aussage statt Gegensatzpaar. */
  rowsRight: string[]
  /** Mehrfachauswahl: höchstens so viele, 0 = beliebig viele. */
  maxChoices: number
  multiline: boolean
  scaleMin: number
  scaleMax: number
  minLabel: string
  maxLabel: string
  /** Nur Skalen-Raster: Ausweich-Antwort neben der Skala, leer = keine. */
  optOutLabel: string
}

// Spiegeln die Grenzen aus app/lib/survey.ts (die Server Action prüft selbst noch einmal).
const MAX_QUESTIONS = 50
const MIN_OPTIONS = 2
const MAX_OPTIONS = 20
const MAX_GRID_ROWS = 20
const MAX_GRID_COLUMNS = 10

const KINDS: { kind: SurveyQuestionKind; label: string; hint: string }[] = [
  { kind: 'SINGLE', label: 'Einfachauswahl', hint: 'Genau eine Antwort wählen (Radiobuttons).' },
  { kind: 'MULTI', label: 'Mehrfachauswahl', hint: 'Beliebig viele Antworten ankreuzen, auf Wunsch höchstens eine bestimmte Zahl.' },
  { kind: 'TEXT', label: 'Freitext', hint: 'Antwort frei eintippen - einzeilig (bis 300 Zeichen) oder mehrzeilig (bis 2000).' },
  { kind: 'SCALE', label: 'Lineare Skala', hint: 'Einen Wert auf einer Skala wählen, z.B. 1 bis 5 von "gar nicht" bis "sehr".' },
  { kind: 'GRID_SINGLE', label: 'Raster (eine pro Zeile)', hint: 'Mehrere Aussagen (Zeilen) mit denselben Antwortmöglichkeiten (Spalten), je Zeile genau eine - z.B. jedes Angebot mit "gut / okay / schlecht" bewerten. Als Pflichtfrage muss jede Zeile beantwortet werden.' },
  { kind: 'GRID_MULTI', label: 'Raster (mehrere pro Zeile)', hint: 'Wie das Raster, aber je Zeile beliebig viele Spalten - z.B. "An welchen Tagen hast du welches Angebot genutzt?". Als Pflichtfrage braucht jede Zeile mindestens ein Kreuz.' },
  { kind: 'SCALE_GRID', label: 'Skalen-Raster', hint: 'Mehrere Zeilen mit derselben Skala: Gegensatzpaare (z.B. "kompliziert" ↔ "einfach", wie im UEQ-S) oder Aussagen ohne rechten Begriff (z.B. "Die App war hilfreich" mit 1 = stimme nicht zu bis 5 = stimme zu). Auswertung je Zeile und gesamt mit Mittelwert. Als Pflichtfrage muss jede Zeile beantwortet werden.' },
  { kind: 'INFO', label: 'Überschrift / Text', hint: 'Keine Frage: eine Überschrift (wie ein Fragentitel) und/oder ein erklärender Text zwischen den Fragen, z.B. eine Anleitung für den nächsten Teil.' }
]

/** Die acht Gegensatzpaare des UEQ-S (Schrepp, Hinderks & Thomaschewski 2017) in der Originalreihenfolge. */
const UEQ_S_PRAGMATIC: [string, string][] = [['behindernd', 'unterstützend'], ['kompliziert', 'einfach'], ['ineffizient', 'effizient'], ['verwirrend', 'übersichtlich']]
const UEQ_S_HEDONIC: [string, string][] = [['langweilig', 'spannend'], ['uninteressant', 'interessant'], ['konventionell', 'originell'], ['herkömmlich', 'neuartig']]

/**
 * UEQ-S als drei Blöcke: Anleitung, dann die pragmatische und die hedonische Qualität als je ein Skalen-Raster (1-7)
 * mit ausgeblendetem Titel - für Teilnehmende ein zusammenhängender Block, in der Auswertung steht der Mittelwert
 * jeder Skala direkt (zentriert -3 bis +3, wie in der offiziellen Auswertung).
 */
function ueqS(): EditorQuestion[] {
  const pairs = (list: [string, string][]) => ({ rows: list.map(p => p[0]), rowsRight: list.map(p => p[1]) })
  const scale = { ...emptyQuestion(), kind: 'SCALE_GRID' as const, hideTitle: true, scaleMin: 1, scaleMax: 7 }
  return [
    {
      ...emptyQuestion(), kind: 'INFO', text: 'Wie ist dein Eindruck?',
      hint: 'Bitte bewerte anhand der folgenden Gegensatzpaare. Je näher du einen Begriff ankreuzt, desto mehr trifft er zu - die Mitte ist neutral. Es gibt keine richtigen oder falschen Antworten, dein spontaner Eindruck zählt.'
    },
    { ...scale, text: 'UEQ-S: Pragmatische Qualität', ...pairs(UEQ_S_PRAGMATIC) },
    { ...scale, text: 'UEQ-S: Hedonische Qualität', ...pairs(UEQ_S_HEDONIC) }
  ]
}

const isGridKind = (kind: SurveyQuestionKind) => kind === 'GRID_SINGLE' || kind === 'GRID_MULTI'

function emptyQuestion(): EditorQuestion {
  return { text: '', hint: '', kind: 'SINGLE', required: false, hideTitle: false, options: ['', ''], rows: ['', ''], rowsRight: ['', ''], maxChoices: 0, multiline: false, scaleMin: 1, scaleMax: 5, minLabel: '', maxLabel: '', optOutLabel: '' }
}

const field = 'rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900'
const smallSelect = 'rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900'
const linkButton = 'text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline'

/**
 * Fragen eines Fragebogens bearbeiten: Text, Hinweis, Art, Pflicht und je nach Art Optionen, Zeilen und Spalten
 * (Raster), Freitext-Länge oder Skala. Die Felder heißen s<i>_… (gelesen von parseQuestions in app/survey-actions.ts) und
 * werden nach jedem Verschieben/Löschen neu durchnummeriert.
 */
export default function QuestionsEditor({ initial }: { initial?: EditorQuestion[] }) {
  // Stabile Schlüssel, damit React beim Verschieben die richtigen Felder behält.
  const [questions, setQuestions] = useState(() => (initial?.length ? initial : [emptyQuestion()]).map((q, i) => ({ ...q, key: i })))
  const [nextKey, setNextKey] = useState(questions.length)

  const update = (index: number, change: (q: EditorQuestion) => Partial<EditorQuestion>) =>
    setQuestions(qs => qs.map((q, i) => (i === index ? { ...q, ...change(q) } : q)))

  /** Hängt Blöcke an; ist der Fragebogen noch leer (nur eine unberührte erste Frage), ersetzen sie diese. */
  const add = (blocks: EditorQuestion[]) => {
    setQuestions(qs => {
      const untouched = qs.length === 1 && !qs[0].text && !qs[0].hint && qs[0].kind === 'SINGLE' && qs[0].options.every(o => !o)
      return [...(untouched ? [] : qs), ...blocks.map((b, k) => ({ ...b, key: nextKey + k }))]
    })
    setNextKey(k => k + blocks.length)
  }

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
      {questions.map((q, i) => {
        const choice = q.kind === 'SINGLE' || q.kind === 'MULTI'
        const info = q.kind === 'INFO'
        const filled = q.options.filter(o => o.trim()).length
        return (
          <fieldset key={q.key} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 space-y-3" data-testid="survey-question">
            <legend className="text-sm font-medium px-1">{info ? `Überschrift / Text (Block ${i + 1})` : `Frage ${i + 1}`}</legend>
            <div className="flex flex-wrap gap-2 justify-end text-xs">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-blue-700 dark:text-blue-300 hover:underline disabled:opacity-40">nach oben</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === questions.length - 1} className="text-blue-700 dark:text-blue-300 hover:underline disabled:opacity-40">nach unten</button>
              <button
                type="button" disabled={questions.length === 1}
                onClick={() => setQuestions(qs => qs.filter((_, other) => other !== i))}
                className="text-red-700 dark:text-red-300 hover:underline disabled:opacity-40"
              >
                {info ? 'Block entfernen' : 'Frage entfernen'}
              </button>
            </div>
            <div className="space-y-2">
              <label htmlFor={`s${i}_text`} className="sr-only">{info ? `Überschrift ${i + 1}` : `Frage ${i + 1}`}</label>
              <input
                id={`s${i}_text`} name={`s${i}_text`} required={!info} maxLength={300} value={q.text}
                onChange={e => update(i, () => ({ text: e.target.value }))}
                placeholder={info ? 'Überschrift (optional), z.B. Teil 2: Deine Meinung zur App' : 'z.B. Wie hat dir die Erstiwoche gefallen?'}
                className={`w-full ${field} ${info ? 'font-medium' : ''}`}
              />
              {info ? (
                <textarea
                  name={`s${i}_hint`} maxLength={2000} rows={3} value={q.hint} aria-label={`Block ${i + 1}, Text`}
                  onChange={e => update(i, () => ({ hint: e.target.value }))}
                  placeholder="Text (optional), z.B. eine Anleitung für die folgenden Fragen"
                  className={`w-full ${field}`}
                />
              ) : (
                <input
                  name={`s${i}_hint`} maxLength={300} value={q.hint} aria-label={`Frage ${i + 1}, Hinweis`}
                  onChange={e => update(i, () => ({ hint: e.target.value }))}
                  placeholder="Hinweis unter der Frage (optional)"
                  className={`w-full ${field} text-xs`}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <label htmlFor={`s${i}_kind`}>Art</label>
                <select
                  id={`s${i}_kind`} name={`s${i}_kind`} value={q.kind}
                  onChange={e => update(i, () => ({ kind: e.target.value as SurveyQuestionKind }))}
                  className={smallSelect}
                >
                  {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>
              </span>
              {!info && (
                <>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" name={`s${i}_required`} checked={q.required} onChange={e => update(i, () => ({ required: e.target.checked }))} className="w-4 h-4" />
                    Pflichtfrage
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" name={`s${i}_hideTitle`} checked={q.hideTitle} onChange={e => update(i, () => ({ hideTitle: e.target.checked }))} className="w-4 h-4" />
                    Titel ausblenden
                  </label>
                </>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{KINDS.find(k => k.kind === q.kind)!.hint}</p>
            {!info && q.hideTitle && <HiddenTitleNote questions={questions} index={i} />}

            {choice && (
              <>
                <ul className="space-y-2">
                  {q.options.map((label, j) => (
                    <li key={j} className="flex items-center gap-2">
                      <span aria-hidden className={`h-4 w-4 shrink-0 border border-gray-400 dark:border-gray-500 ${q.kind === 'SINGLE' ? 'rounded-full' : 'rounded'}`} />
                      <input
                        name={`s${i}_o${j}`} maxLength={150} value={label} required={j < MIN_OPTIONS} aria-label={`Frage ${i + 1}, Option ${j + 1}`}
                        onChange={e => update(i, prev => ({ options: prev.options.map((x, k) => (k === j ? e.target.value : x)) }))}
                        placeholder={`Option ${j + 1}`}
                        className={`grow min-w-0 ${field}`}
                      />
                      {q.options.length > MIN_OPTIONS && (
                        <button
                          type="button" aria-label={`Option ${j + 1} entfernen`}
                          onClick={() => update(i, prev => ({ options: prev.options.filter((_, k) => k !== j) }))}
                          className="text-gray-400 dark:text-gray-500 hover:text-red-700 dark:hover:text-red-300 px-1"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {q.options.length < MAX_OPTIONS && (
                    <button type="button" onClick={() => update(i, prev => ({ options: [...prev.options, ''] }))} className={linkButton}>
                      + Option hinzufügen
                    </button>
                  )}
                  {q.kind === 'MULTI' && (
                    <span className="flex items-center gap-2 text-sm">
                      <label htmlFor={`s${i}_max`}>Höchstens</label>
                      <select id={`s${i}_max`} name={`s${i}_max`} value={q.maxChoices} onChange={e => update(i, () => ({ maxChoices: Number(e.target.value) }))} className={smallSelect}>
                        <option value={0}>beliebig viele</option>
                        {Array.from({ length: Math.max(filled - 1, 0) }, (_, k) => k + 1).map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </span>
                  )}
                </div>
              </>
            )}

            {isGridKind(q.kind) && (
              <div className="grid gap-4 sm:grid-cols-2">
                <LabelList
                  title="Zeilen (Aussagen)" name={`s${i}_r`} items={q.rows} max={MAX_GRID_ROWS} min={1} question={i + 1} itemLabel="Zeile"
                  placeholder={j => (j === 0 ? 'z.B. Campus-Rallye' : `Zeile ${j + 1}`)}
                  onChange={rows => update(i, () => ({ rows }))}
                />
                <LabelList
                  title="Spalten (Antwortmöglichkeiten)" name={`s${i}_o`} items={q.options} max={MAX_GRID_COLUMNS} min={MIN_OPTIONS} question={i + 1} itemLabel="Spalte"
                  placeholder={j => (['z.B. gut', 'z.B. okay', 'z.B. schlecht'][j] ?? `Spalte ${j + 1}`)}
                  onChange={options => update(i, () => ({ options }))}
                />
                <p className="sm:col-span-2 text-xs text-gray-500 dark:text-gray-400">
                  Am Handy erscheint jede Zeile als eigener Block mit den Spalten als Knöpfen, auf größeren Bildschirmen als Tabelle. Kurze
                  Spaltennamen lesen sich in beiden Ansichten am besten.
                </p>
              </div>
            )}

            {q.kind === 'TEXT' && (
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" name={`s${i}_multiline`} checked={q.multiline} onChange={e => update(i, () => ({ multiline: e.target.checked }))} className="w-4 h-4" />
                Mehrzeilig (für längere Antworten)
              </label>
            )}

            {q.kind === 'SCALE_GRID' && (
              <PairList
                question={i + 1} name={`s${i}`} left={q.rows} right={q.rowsRight}
                onChange={(rows, rowsRight) => update(i, () => ({ rows, rowsRight }))}
              />
            )}

            {(q.kind === 'SCALE' || q.kind === 'SCALE_GRID') && (
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <div className="flex items-center gap-2">
                  <label htmlFor={`s${i}_from`}>Von</label>
                  <select id={`s${i}_from`} name={`s${i}_from`} value={q.scaleMin} onChange={e => update(i, () => ({ scaleMin: Number(e.target.value) }))} className={smallSelect}>
                    {[0, 1].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <label htmlFor={`s${i}_to`}>bis</label>
                  <select id={`s${i}_to`} name={`s${i}_to`} value={q.scaleMax} onChange={e => update(i, () => ({ scaleMax: Number(e.target.value) }))} className={smallSelect}>
                    {Array.from({ length: 9 }, (_, k) => k + 2).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="hidden sm:block" />
                <input
                  name={`s${i}_fromLabel`} maxLength={40} value={q.minLabel} aria-label={`Frage ${i + 1}, Beschriftung für ${q.scaleMin}`}
                  onChange={e => update(i, () => ({ minLabel: e.target.value }))} placeholder={`Beschriftung für ${q.scaleMin} (optional), z.B. gar nicht`}
                  className={field}
                />
                <input
                  name={`s${i}_toLabel`} maxLength={40} value={q.maxLabel} aria-label={`Frage ${i + 1}, Beschriftung für ${q.scaleMax}`}
                  onChange={e => update(i, () => ({ maxLabel: e.target.value }))} placeholder={`Beschriftung für ${q.scaleMax} (optional), z.B. sehr`}
                  className={field}
                />
                {q.kind === 'SCALE_GRID' && (
                  <div className="sm:col-span-2 space-y-1">
                    <input
                      name={`s${i}_optOut`} maxLength={40} value={q.optOutLabel} aria-label={`Frage ${i + 1}, Ausweich-Antwort`}
                      onChange={e => update(i, () => ({ optOutLabel: e.target.value }))}
                      placeholder="Ausweich-Antwort (optional), z.B. nicht genutzt oder kann ich nicht beurteilen"
                      className={`w-full ${field}`}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Erscheint in jeder Zeile neben der Skala. Zählt als beantwortet (auch bei Pflicht), aber nicht im Mittelwert - die
                      Auswertung zählt sie je Zeile getrennt.
                    </p>
                  </div>
                )}
              </div>
            )}
          </fieldset>
        )
      })}

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {questions.length < MAX_QUESTIONS && (
          <button type="button" onClick={() => add([emptyQuestion()])} className={linkButton}>+ Weitere Frage</button>
        )}
        {questions.length < MAX_QUESTIONS && (
          <button type="button" onClick={() => add([{ ...emptyQuestion(), kind: 'INFO' }])} className={linkButton}>+ Überschrift / Text</button>
        )}
        {questions.length + 3 <= MAX_QUESTIONS && (
          <button type="button" onClick={() => add(ueqS())} className={linkButton} title="User Experience Questionnaire, Kurzversion: 8 Gegensatzpaare, Skala 1-7">
            + UEQ-S einfügen
          </button>
        )}
      </div>
    </div>
  )
}

/** Liste kurzer Einträge (Zeilen bzw. Spalten eines Rasters) mit Hinzufügen und Entfernen. Felder <name><j>. */
function LabelList({ title, name, items, min, max, question, itemLabel, placeholder, onChange }: {
  title: string
  name: string
  items: string[]
  min: number
  max: number
  question: number
  itemLabel: string
  placeholder: (index: number) => string
  onChange: (items: string[]) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <ul className="space-y-2">
        {items.map((label, j) => (
          <li key={j} className="flex items-center gap-2">
            <input
              name={`${name}${j}`} maxLength={150} value={label} required={j < min} aria-label={`Frage ${question}, ${itemLabel} ${j + 1}`}
              onChange={e => onChange(items.map((x, k) => (k === j ? e.target.value : x)))}
              placeholder={placeholder(j)}
              className={`grow min-w-0 ${field}`}
            />
            {items.length > min && (
              <button
                type="button" aria-label={`${itemLabel} ${j + 1} entfernen`}
                onClick={() => onChange(items.filter((_, k) => k !== j))}
                className="text-gray-400 dark:text-gray-500 hover:text-red-700 dark:hover:text-red-300 px-1"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {items.length < max && (
        <button type="button" onClick={() => onChange([...items, ''])} className={linkButton}>+ {itemLabel} hinzufügen</button>
      )}
    </div>
  )
}

/**
 * Zeilen eines Skalen-Rasters: je Zeile ein linker Begriff (bzw. die Aussage) und optional ein rechter Begriff
 * (Gegensatzpaar). Felder <name>_r<j> und <name>_rr<j>.
 */
function PairList({ question, name, left, right, onChange }: {
  question: number
  name: string
  left: string[]
  right: string[]
  onChange: (left: string[], right: string[]) => void
}) {
  const set = (j: number, side: 'left' | 'right', value: string) =>
    onChange(
      left.map((x, k) => (side === 'left' && k === j ? value : x)),
      left.map((_, k) => (side === 'right' && k === j ? value : right[k] ?? ''))
    )
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Zeilen</p>
      <ul className="space-y-2">
        {left.map((label, j) => (
          <li key={j} className="flex items-center gap-2">
            <input
              name={`${name}_r${j}`} maxLength={150} value={label} required={j === 0} aria-label={`Frage ${question}, Zeile ${j + 1}, links`}
              onChange={e => set(j, 'left', e.target.value)} placeholder={j === 0 ? 'z.B. kompliziert' : 'links bzw. Aussage'}
              className={`min-w-0 flex-1 ${field}`}
            />
            <span aria-hidden className="text-gray-400">↔</span>
            <input
              name={`${name}_rr${j}`} maxLength={150} value={right[j] ?? ''} aria-label={`Frage ${question}, Zeile ${j + 1}, rechts`}
              onChange={e => set(j, 'right', e.target.value)} placeholder={j === 0 ? 'z.B. einfach' : 'rechts (optional)'}
              className={`min-w-0 flex-1 ${field}`}
            />
            {left.length > 1 && (
              <button
                type="button" aria-label={`Zeile ${j + 1} entfernen`}
                onClick={() => onChange(left.filter((_, k) => k !== j), left.map((_, k) => right[k] ?? '').filter((_, k) => k !== j))}
                className="text-gray-400 dark:text-gray-500 hover:text-red-700 dark:hover:text-red-300 px-1"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {left.length < MAX_GRID_ROWS && (
        <button type="button" onClick={() => onChange([...left, ''], [...left.map((_, k) => right[k] ?? ''), ''])} className={linkButton}>+ Zeile hinzufügen</button>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Mit rechtem Begriff ein Gegensatzpaar (links = kleinster, rechts = größter Wert), ohne eine Aussage, die auf der Skala bewertet wird.
      </p>
    </div>
  )
}

/**
 * Was ein ausgeblendeter Titel bewirkt - und eine Warnung, wenn die Frage dadurch optisch an eine andere Frage
 * anschließt (sähe für Teilnehmende aus wie ein Teil davon) oder ganz oben ohne Titel steht. Gleiche Regel wie die
 * Ausfüllseite (attachment und questionNumbers in app/lib/survey-numbers.ts).
 */
function HiddenTitleNote({ questions, index }: { questions: EditorQuestion[]; index: number }) {
  const q = questions[index]
  const base = 'Titel ausgeblendet: Teilnehmende sehen ihn nicht (Screenreader schon), in Auswertung und CSV steht er weiter.'
  if (q.hint.trim()) {
    return <p className="text-xs text-gray-500 dark:text-gray-400">{base} Statt des Titels steht der Hinweis über der Frage.</p>
  }
  const { to, index: target } = attachment(questions, index)
  if (to === 'heading') {
    return <p className="text-xs text-gray-500 dark:text-gray-400">{base} Die Frage gehört zur Überschrift in Block {target + 1} - die Überschrift bekommt die Nummer.</p>
  }
  if (to === 'text') {
    return <p className="text-xs text-gray-500 dark:text-gray-400">{base} Die Frage schließt an den Text in Block {target + 1} an und bekommt keine Nummer.</p>
  }
  return (
    <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200" data-testid="hidden-title-warning">
      {to === 'question'
        ? `Wird an Frage ${target + 1} angehängt: Ohne eigenen Titel sieht diese Frage für Teilnehmende wie ein Teil davon aus. Für eine eigene Frage den Titel einblenden oder eine Überschrift davor setzen.`
        : 'Ganz oben ohne Titel: Teilnehmende sehen nicht, worum es geht. Titel einblenden oder eine Überschrift davor setzen.'}
    </p>
  )
}
