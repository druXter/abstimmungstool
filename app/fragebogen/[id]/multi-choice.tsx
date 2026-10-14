'use client'

import { useEffect, useRef, useState } from 'react'
import { surveyTexts, type SurveyLang } from '../../lib/survey-i18n'

/**
 * Checkboxen einer Mehrfachauswahl. Im Browser: Pflicht ("mindestens eine") über die eingebaute
 * Formularprüfung und bei einer Obergrenze die übrigen Kästchen gesperrt, sobald sie erreicht ist.
 * Ohne JavaScript bleiben es normale Checkboxen - parseSurveyAnswers prüft beides noch einmal.
 */
export default function MultiChoice({ name, options, required, max, initial, texts = {}, otherFields = {}, lang = 'de' }: {
  name: string
  options: { id: string; label: string }[]
  required: boolean
  max: number | null
  initial: string[]
  /** Bisherige Texte zu Antworten mit Textfeld ("Sonstiges: ___"). */
  texts?: Record<string, string>
  /** Antworten mit Textfeld: Option -> Feldname (otherTextField). Tippen kreuzt die Antwort an. */
  otherFields?: Record<string, string>
  lang?: SurveyLang
}) {
  const t = surveyTexts(lang)
  const [checked, setChecked] = useState(() => new Set(initial))
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    first.current?.setCustomValidity(required && checked.size === 0 ? t.chooseOne : '')
  }, [required, checked, t])

  const full = max !== null && checked.size >= max
  return (
    <div className="space-y-1.5">
      {options.map((o, i) => (
        <div key={o.id}>
        <label className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${full && !checked.has(o.id) ? 'opacity-50' : 'cursor-pointer'}`}>
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
        {otherFields[o.id] && (
          <input
            name={otherFields[o.id]} defaultValue={texts[o.id] ?? ''} maxLength={300} aria-label={t.otherLabel(o.label)} placeholder={t.otherPlaceholder}
            disabled={full && !checked.has(o.id)}
            // Wer etwas eintippt, meint diese Antwort - also ankreuzen (sonst ginge der Text verloren, siehe parseSurveyAnswers).
            onInput={e => { if (e.currentTarget.value.trim()) setChecked(prev => (prev.has(o.id) ? prev : new Set(prev).add(o.id))) }}
            className="ml-8 mt-0.5 w-[calc(100%-2rem)] rounded-lg border border-gray-300 bg-white p-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:focus:ring-blue-900"
          />
        )}
        </div>
      ))}
    </div>
  )
}
