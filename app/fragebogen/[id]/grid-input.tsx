'use client'

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'

type Item = { id: string; label: string }

/**
 * Raster zum Ausfüllen: je Zeile eine Gruppe (Radiobuttons bzw. Checkboxen, Feld q_<Frage>_<Zeile>, siehe
 * answerField). Jedes Feld gibt es nur EINMAL, die Ansicht wechselt allein per CSS:
 * - am Handy ein Block je Zeile, die Aussage als Überschrift, die Spalten als große Knöpfe zum Antippen (umbrechend,
 *   auch lange Spaltennamen passen) - der Radiobutton selbst ist dann nur für Screenreader da;
 * - ab sm eine Tabelle mit Spaltenköpfen, sichtbaren Radiobuttons/Checkboxen und den Spaltennamen nur für Screenreader.
 * Pflicht: bei einer Antwort pro Zeile über die eingebaute Formularprüfung, bei mehreren im Browser (mindestens ein
 * Kreuz je Zeile); parseSurveyAnswers prüft beides noch einmal.
 */
export default function GridInput({ questionId, rows, columns, multiple, required, initial }: {
  questionId: string
  rows: Item[]
  columns: Item[]
  multiple: boolean
  required: boolean
  /** Bisherige Antworten als "<Zeile>:<Spalte>". */
  initial: string[]
}) {
  const id = useId()
  const [checked, setChecked] = useState(() => new Set(initial))
  const firstInRow = useRef(new Map<string, HTMLInputElement>())

  useEffect(() => {
    if (!multiple) return
    for (const row of rows) {
      const empty = !columns.some(c => checked.has(`${row.id}:${c.id}`))
      firstInRow.current.get(row.id)?.setCustomValidity(required && empty ? 'Bitte kreuze in dieser Zeile mindestens eine Antwort an.' : '')
    }
  }, [multiple, required, rows, columns, checked])

  const template = { '--grid-cols': columns.length } as CSSProperties
  const columnsClass = 'sm:grid-cols-[minmax(8rem,2fr)_repeat(var(--grid-cols),minmax(3.75rem,1fr))]'

  return (
    <div className="sm:overflow-x-auto sm:rounded-lg sm:border sm:border-gray-200 sm:dark:border-gray-700" style={template}>
      <div aria-hidden className={`hidden sm:grid ${columnsClass} min-w-fit bg-gray-50 text-xs font-medium text-gray-600 dark:bg-gray-900 dark:text-gray-400`}>
        <span />
        {columns.map(c => <span key={c.id} className="px-1.5 py-2 text-center break-words">{c.label}</span>)}
      </div>
      <div className="space-y-3 sm:space-y-0">
        {rows.map((row, r) => {
          const rowLabel = `${id}-${r}`
          return (
            <div
              key={row.id} role={multiple ? 'group' : 'radiogroup'} aria-labelledby={rowLabel} data-testid="grid-row"
              className={`rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:grid ${columnsClass} sm:min-w-fit sm:items-center sm:rounded-none sm:border-0 sm:border-t sm:p-0 ${r % 2 ? 'sm:bg-gray-50/60 sm:dark:bg-gray-900/40' : ''}`}
            >
              <span id={rowLabel} className="mb-2 block text-sm font-medium sm:mb-0 sm:px-3 sm:py-2.5 sm:font-normal">{row.label}</span>
              <div className="flex flex-wrap gap-2 sm:contents">
                {columns.map((c, ci) => {
                  const key = `${row.id}:${c.id}`
                  return (
                    <label key={c.id} className="group cursor-pointer sm:flex sm:h-full sm:items-center sm:justify-center sm:py-2.5">
                      <input
                        ref={ci === 0 ? el => { if (el) firstInRow.current.set(row.id, el) } : undefined}
                        type={multiple ? 'checkbox' : 'radio'} name={`q_${questionId}_${row.id}`} value={c.id}
                        required={!multiple && required}
                        {...(multiple
                          ? {
                              checked: checked.has(key),
                              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setChecked(prev => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(key)
                                else next.delete(key)
                                return next
                              })
                            }
                          : { defaultChecked: checked.has(key) })}
                        className="peer sr-only sm:not-sr-only sm:h-4 sm:w-4"
                      />
                      <span className={`flex min-h-10 items-center justify-center gap-1.5 border border-gray-300 px-3.5 py-1.5 text-sm transition peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300 dark:border-gray-600 sm:sr-only ${multiple ? 'rounded-lg' : 'rounded-full'}`}>
                        {multiple && <span aria-hidden className="hidden text-xs group-has-checked:inline">✓</span>}
                        {c.label}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
