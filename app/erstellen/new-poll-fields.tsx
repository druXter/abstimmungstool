// app/erstellen/new-poll-fields.tsx
'use client'

import { useState } from 'react'
import type { OptionKind } from '@prisma/client'
import OptionsFieldList from './options-field-list'
import { Card } from '../ui/kit'

const KINDS: { kind: OptionKind; label: string; type: 'text' | 'date' | 'datetime-local' }[] = [
  { kind: 'TEXT', label: 'Freitext', type: 'text' },
  { kind: 'DATE', label: 'Tage', type: 'date' },
  { kind: 'DATETIME', label: 'Termine mit Uhrzeit', type: 'datetime-local' }
]

export type PresetChoice = { id: string; title: string; text: string; sets: string; dateOptions: boolean }

/**
 * Vorlage und Optionen beim Anlegen (app/lib/poll-presets.ts). Ohne JavaScript funktioniert beides wie ein normales
 * Formular; mit JavaScript stellt "Terminfindung" die Optionen von Freitext auf Tage um. Ein Wechsel der
 * Optionsart leert die Felder (key), weil Text und Datum nicht ineinander passen.
 */
export default function NewPollFields({ presets }: { presets: PresetChoice[] }) {
  const [kind, setKind] = useState<OptionKind>('TEXT')
  const current = KINDS.find(k => k.kind === kind)!

  return (
    <>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Was für eine Abstimmung?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {presets.map((preset, i) => (
            <label
              key={preset.id}
              className="flex cursor-pointer gap-3 rounded-xl border border-gray-200 bg-white p-4 transition hover:border-blue-300 has-[:checked]:border-blue-500 has-[:checked]:ring-2 has-[:checked]:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700 dark:has-[:checked]:ring-blue-900"
            >
              <input
                type="radio" name="preset" value={preset.id} defaultChecked={i === 0} className="mt-1 h-4 w-4"
                onChange={() => { if (preset.dateOptions && kind === 'TEXT') setKind('DATE') }}
              />
              <span className="min-w-0">
                <span className="block font-medium text-gray-900 dark:text-gray-100">{preset.title}</span>
                <span className="block text-sm text-gray-600 dark:text-gray-400">{preset.text}</span>
                <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{preset.sets}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">Alles lässt sich danach unter &quot;Einstellungen&quot; anpassen, solange noch niemand abgestimmt hat.</p>
      </fieldset>

      <Card>
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Optionen</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {KINDS.map(k => (
              <label key={k.kind} className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="optionKind" value={k.kind} checked={kind === k.kind} onChange={() => setKind(k.kind)} className="h-4 w-4" />
                {k.label}
              </label>
            ))}
          </div>
          {kind !== 'TEXT' && (
            <p className="text-xs text-gray-500 dark:text-gray-400">Terminabstimmung: Die Optionen werden nach Datum sortiert. Die Art lässt sich später nicht mehr ändern.</p>
          )}
          <OptionsFieldList key={kind} inputType={current.type} />
        </fieldset>
      </Card>
    </>
  )
}
