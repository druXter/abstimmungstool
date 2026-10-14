'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Checkboxen einer Mehrfachauswahl. Im Browser: Pflicht ("mindestens eine") über die eingebaute
 * Formularprüfung und bei einer Obergrenze die übrigen Kästchen gesperrt, sobald sie erreicht ist.
 * Ohne JavaScript bleiben es normale Checkboxen - parseSurveyAnswers prüft beides noch einmal.
 */
export default function MultiChoice({ name, options, required, max, initial }: {
  name: string
  options: { id: string; label: string }[]
  required: boolean
  max: number | null
  initial: string[]
}) {
  const [checked, setChecked] = useState(() => new Set(initial))
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    first.current?.setCustomValidity(required && checked.size === 0 ? 'Bitte wähle mindestens eine Option.' : '')
  }, [required, checked])

  const full = max !== null && checked.size >= max
  return (
    <div className="space-y-1.5">
      {options.map((o, i) => (
        <label key={o.id} className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${full && !checked.has(o.id) ? 'opacity-50' : 'cursor-pointer'}`}>
          <input
            ref={i === 0 ? first : undefined}
            type="checkbox" name={name} value={o.id} checked={checked.has(o.id)} disabled={full && !checked.has(o.id)}
            onChange={e => setChecked(prev => {
              const next = new Set(prev)
              if (e.target.checked) next.add(o.id)
              else next.delete(o.id)
              return next
            })}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="text-sm">{o.label}</span>
        </label>
      ))}
    </div>
  )
}
