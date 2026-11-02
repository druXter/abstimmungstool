import { aiConfigured } from 'suite-kit'
import { formatShortDate, hintClass } from '../ui/kit'

/**
 * Häkchen „Freitext-Antworten mit KI zusammenfassen“ beim Anlegen und Bearbeiten (app/lib/survey-summary.ts). Ohne
 * OPENAI_API_KEY gesperrt - ein gesperrtes Feld wird nicht mitgeschickt, die Einstellung bleibt dann, wie sie ist.
 */
export default function AiFields({ since = null }: { since?: Date | null }) {
  const configured = aiConfigured()
  return (
    <div>
      <label className={`flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200 ${configured ? 'cursor-pointer' : 'opacity-70'}`}>
        <input type="checkbox" name="ai" defaultChecked={!!since} disabled={!configured} className="h-4 w-4" />
        Freitext-Antworten mit KI zusammenfassen
      </label>
      <p className={hintClass}>
        {configured ? (
          <>
            In der Auswertung fasst eine KI (OpenAI) die Antworten auf Freitext-Fragen auf Knopfdruck zu Themen zusammen. Wer
            antwortet, sieht dazu einen Hinweis im Formular; an OpenAI gehen nur Antworten, die nach dem Einschalten abgegeben
            oder geändert wurden{since ? ` (eingeschaltet am ${formatShortDate(since)})` : ''}, ohne Namen oder Kennungen.
          </>
        ) : 'Auf diesem Server nicht eingerichtet (OPENAI_API_KEY).'}
      </p>
    </div>
  )
}
