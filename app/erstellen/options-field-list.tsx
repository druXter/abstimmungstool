// app/erstellen/options-field-list.tsx
'use client'

import { useState } from 'react'

const START_COUNT = 4

/**
 * Erweiterbare Liste von Options-Eingabefeldern bis max (Standard 25 - muss mit
 * MAX_OPTIONS in app/actions.ts übereinstimmen) - leere Felder werden beim Absenden
 * serverseitig ignoriert (siehe createPoll), man muss also nicht alle sichtbaren
 * Felder ausfüllen.
 */
export default function OptionsFieldList({ max = 25 }: { max?: number }) {
  const [count, setCount] = useState(START_COUNT)

  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <input
          key={i}
          type="text"
          name="option"
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
      <p className="text-xs text-gray-500">Mindestens 2, maximal {max} Optionen.</p>
    </div>
  )
}
