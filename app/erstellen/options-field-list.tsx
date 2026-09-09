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
  startCount = START_COUNT
}: {
  name?: string
  max?: number
  startCount?: number
}) {
  const [count, setCount] = useState(startCount)

  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <input
          key={i}
          type="text"
          name={name}
          maxLength={200}
          className="w-full border border-gray-300 p-2 rounded"
          placeholder={`Option ${i + 1}`}
        />
      ))}
      {count < max && (
        <button
          type="button"
          onClick={() => setCount(c => Math.min(c + 1, max))}
          className="text-sm text-blue-600 hover:underline"
        >
          + Weitere Option hinzufügen
        </button>
      )}
      <p className="text-xs text-gray-500">Maximal {max} Optionen insgesamt.</p>
    </div>
  )
}
