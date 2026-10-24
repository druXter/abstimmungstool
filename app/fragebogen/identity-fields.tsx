import type { SurveyIdentity } from '@prisma/client'
import { IDENTITY_LABELS, offeredSurveyIdentities } from '../lib/survey'
import { labelClass } from '../ui/kit'

/** "Wer darf antworten?" beim Anlegen und Bearbeiten - gesperrt, sobald es Antworten gibt. */
export default function IdentityFields({ value, locked = false }: { value: SurveyIdentity; locked?: boolean }) {
  return (
    <fieldset className="space-y-2">
      <legend className={labelClass}>Wer darf antworten?</legend>
      {offeredSurveyIdentities(value).map(identity => (
        <label key={identity} className={`flex gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700 ${locked ? 'opacity-70' : 'cursor-pointer'}`}>
          <input type="radio" name="identity" value={identity} defaultChecked={value === identity} disabled={locked} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="block text-sm font-medium">{IDENTITY_LABELS[identity].title}</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">{IDENTITY_LABELS[identity].hint}</span>
          </span>
        </label>
      ))}
      {locked && <p className="text-xs text-gray-500 dark:text-gray-400">Lässt sich nicht mehr ändern, weil schon geantwortet wurde.</p>}
    </fieldset>
  )
}
