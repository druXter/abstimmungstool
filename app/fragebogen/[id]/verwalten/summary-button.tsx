'use client'

import { useFormStatus } from 'react-dom'
import { buttonClass } from '../../../ui/kit'

/** Knopf der KI-Zusammenfassung: zeigt, dass es dauert (die Antwort von OpenAI braucht oft 10-30 Sekunden). */
export default function SummaryButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <>
      <button type="submit" disabled={pending} className={buttonClass('secondary', 'sm')}>
        {pending ? 'Wird zusammengefasst …' : label}
      </button>
      <span role="status" className="text-xs text-gray-500 dark:text-gray-400">{pending ? 'Das dauert meist 10 bis 30 Sekunden.' : ''}</span>
    </>
  )
}
