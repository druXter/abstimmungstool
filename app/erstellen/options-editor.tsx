// app/erstellen/options-editor.tsx
'use client'

import { useState } from 'react'
import type { OptionKind } from '@prisma/client'
import OptionsFieldList from './options-field-list'

const KINDS: { kind: OptionKind; label: string; type: 'text' | 'date' | 'datetime-local' }[] = [
  { kind: 'TEXT', label: 'Freitext', type: 'text' },
  { kind: 'DATE', label: 'Tage', type: 'date' },
  { kind: 'DATETIME', label: 'Termine mit Uhrzeit', type: 'datetime-local' }
]

/**
 * Optionen beim Anlegen: Art wählen (Poll.optionKind) und die Felder passend dazu. Ein
 * Wechsel der Art leert die Felder (key), weil Text und Datum nicht ineinander passen.
 */
export default function OptionsEditor() {
  const [kind, setKind] = useState<OptionKind>('TEXT')
  const current = KINDS.find(k => k.kind === kind)!

  return (
    <fieldset className="space-y-2">
      <legend className="block text-sm font-medium mb-1">Optionen</legend>
      <div className="flex flex-wrap gap-4 text-sm">
        {KINDS.map(k => (
          <label key={k.kind} className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="optionKind" value={k.kind} checked={kind === k.kind} onChange={() => setKind(k.kind)} className="w-4 h-4" />
            {k.label}
          </label>
        ))}
      </div>
      {kind !== 'TEXT' && (
        <p className="text-xs text-gray-500">Terminabstimmung: Die Optionen werden nach Datum sortiert. Die Art lässt sich später nicht mehr ändern.</p>
      )}
      <OptionsFieldList key={kind} inputType={current.type} />
    </fieldset>
  )
}
