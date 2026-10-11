// app/erstellen/options-field-list.tsx
'use client'

import { useState } from 'react'

const START_COUNT = 4

/**
 * Erweiterbare Liste von Options-Eingabefeldern bis max (Standard 25 - muss mit
 * MAX_OPTIONS in app/actions.ts übereinstimmen) - leere Felder werden beim Absenden
 * serverseitig ignoriert (siehe createPoll/updatePoll), man muss also nicht alle
 * sichtbaren Felder ausfüllen. Wiederverwendet von der Bearbeiten-Seite (mit
 * abweichendem `name`, da dort zwischen bestehenden und neu hinzugefügten Optionen
 * unterschieden werden muss - siehe app/[pollId]/verwalten/bearbeiten/page.tsx) und
 * startet dort mit 0 sichtbaren Feldern statt 4, da bereits bestehende Optionen
 * separat angezeigt werden.
 */
export default function OptionsFieldList({
  name = 'option',
  max = 25,
  startCount = START_COUNT,
  inputType = 'text'
}: {
  name?: string
  max?: number
  startCount?: number
  /** Bei Terminabstimmungen Kalender-Eingabe statt Freitext (siehe app/lib/date-options.ts). */
  inputType?: 'text' | 'date' | 'datetime-local'
}) {
  const [count, setCount] = useState(startCount)

  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <input
          key={i}
          type={inputType}
          name={name}
          maxLength={200}
          aria-label={`Option ${i + 1}`}
          className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900"
          placeholder={inputType === 'text' ? `Option ${i + 1}` : undefined}
        />
      ))}
      {count < max && (
        <button
          type="button"
          onClick={() => setCount(c => Math.min(c + 1, max))}
          className="text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline"
        >
          {inputType === 'text' ? '+ Weitere Option hinzufügen' : '+ Weiteren Termin hinzufügen'}
        </button>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">Maximal {max} Optionen insgesamt.</p>
    </div>
  )
}
