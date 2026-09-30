// app/erstellen/poll-settings-fields.tsx
import type { Poll, VoterIdentity } from '@prisma/client'
import { OFFERED_IDENTITIES } from '../lib/voter-identity'
import { MAX_ACCESS_CODE_LENGTH } from '../lib/access-code'

const IDENTITY_LABELS: Record<VoterIdentity, { title: string; text: string }> = {
  COOKIE: {
    title: 'Offen für alle mit dem Link (Standard)',
    text: 'Anonym und ohne Anmeldung. Eine Stimme pro Browser - wer Cookies löscht oder ein anderes Gerät nutzt, kann erneut abstimmen.'
  },
  RSVP: {
    title: 'Nur über rsvp-app (max. 1 Stimme pro Person)',
    text: 'Identität ist die über rsvp-app verifizierte E-Mail - die Abstimmung muss über einen entsprechend eingerichteten Link/Button in rsvp-app aufgerufen werden, direkter Zugriff kann nicht abstimmen. Nur Zusagende stimmen ab. Nur sinnvoll, sobald diese Verknüpfung eingerichtet ist (siehe README).'
  },
  LINK: { title: 'Persönliche Stimmlinks', text: '' },
  EMAIL: { title: 'Bestätigte E-Mail-Adresse', text: '' },
  ACCOUNT: { title: 'Mit Konto', text: '' }
}

type Settings = Pick<Poll, 'closesAt' | 'allowMultipleChoices' | 'voterIdentity' | 'showVoterNames' | 'requireVoterName' | 'maxVoters' | 'accessCode'>

/** Wert für <input type="datetime-local"> in der Zeitzone des Servers (TZ, siehe package.json/docker-compose.yml). */
function toDateTimeLocal(date: Date | null): string {
  if (!date) return ''
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Die Einstellungen einer Abstimmung, gemeinsam für Anlegen und Bearbeiten (Gegenstück:
 * parsePollSettings/parseVoterIdentity in app/actions.ts). `locked`: Es gibt schon
 * Stimmen, der Stimmmodus steht dann fest (updatePoll ignoriert ihn ebenfalls).
 */
export default function PollSettingsFields({ poll, locked = false }: { poll?: Settings; locked?: boolean }) {
  const identity = poll?.voterIdentity ?? 'COOKIE'
  // Ein (künftig) nicht mehr angebotener Modus einer bestehenden Abstimmung bleibt sichtbar.
  const kinds = OFFERED_IDENTITIES.includes(identity) ? OFFERED_IDENTITIES : [...OFFERED_IDENTITIES, identity]

  return (
    <>
      <div>
        <label htmlFor="poll-closes-at" className="block text-sm font-medium mb-1">Automatisch schließen am (optional)</label>
        <input
          id="poll-closes-at" type="datetime-local" name="closesAt" defaultValue={toDateTimeLocal(poll?.closesAt ?? null)}
          className="w-full border border-gray-300 p-2 rounded"
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" name="allowMultipleChoices" defaultChecked={poll?.allowMultipleChoices} className="w-4 h-4" />
        <span className="text-sm font-medium">Mehrfachauswahl erlauben (mehrere Optionen gleichzeitig wählbar)</span>
      </label>

      <fieldset className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-3">
        <legend className="text-sm font-medium text-amber-900 px-1">Wer darf abstimmen?</legend>
        {locked && (
          <p className="text-xs text-amber-800">
            Es wurde schon abgestimmt - die Art der Stimmabgabe lässt sich deshalb nicht mehr ändern.
          </p>
        )}
        {kinds.map(kind => (
          <div key={kind}>
            <label className={`flex items-start gap-2 ${locked ? 'opacity-70' : 'cursor-pointer'}`}>
              <input
                type="radio" name="voterIdentity" value={kind} defaultChecked={kind === identity} disabled={locked}
                className="w-4 h-4 mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium text-amber-900">{IDENTITY_LABELS[kind].title}</span>
                {IDENTITY_LABELS[kind].text && <span className="block text-xs text-amber-700">{IDENTITY_LABELS[kind].text}</span>}
              </span>
            </label>
            {kind === 'COOKIE' && (
              <label className="flex items-start gap-2 cursor-pointer ml-6 mt-2">
                <input type="checkbox" name="requireVoterName" defaultChecked={poll?.requireVoterName} className="w-4 h-4 mt-0.5" />
                <span>
                  <span className="block text-sm text-amber-900">Namen beim Abstimmen verlangen</span>
                  <span className="block text-xs text-amber-700">
                    Keine Überprüfung - jeder kann jeden Namen eingeben. Zusammen mit der namentlichen Anzeige unten
                    sieht aber die ganze Gruppe, wer wofür gestimmt hat (soziale Kontrolle).
                  </span>
                </span>
              </label>
            )}
          </div>
        ))}

        <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-amber-200">
          <input type="checkbox" name="showVoterNames" defaultChecked={poll?.showVoterNames} className="w-4 h-4 mt-0.5" />
          <span>
            <span className="block text-sm font-medium text-amber-900">
              Abstimmende namentlich anzeigen (auf der öffentlichen Ergebnisseite)
            </span>
            <span className="block text-xs text-amber-700">
              Zeigt bei jeder Option, wer dafür gestimmt hat (je nach Art der Stimmabgabe Name oder E-Mail). Bei
              &quot;Offen für alle&quot; ohne verlangten Namen gibt es keine Namen - dort bleibt das Ergebnis anonym.
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="rounded-md border border-gray-200 p-4 space-y-3">
        <legend className="text-sm font-medium px-1">Zugang und Teilnahme (optional)</legend>
        <div>
          <label htmlFor="poll-access-code" className="block text-sm font-medium mb-1">Zugangscode</label>
          <input
            id="poll-access-code" name="accessCode" maxLength={MAX_ACCESS_CODE_LENGTH} autoComplete="off"
            defaultValue={poll?.accessCode ?? ''} placeholder="z.B. Sommerfest"
            className="w-full border border-gray-300 p-2 rounded"
          />
          <p className="text-xs text-gray-500 mt-1">
            Ohne Code sieht niemand Optionen oder Ergebnis. Hält Fremde fern, verhindert aber <strong>keine</strong>{' '}
            Mehrfachabstimmung - alle Berechtigten kennen denselben Code. Groß-/Kleinschreibung zählt nicht.
            Ein geänderter Code sperrt alle aus, bis sie den neuen eingeben.
          </p>
        </div>
        <div>
          <label htmlFor="poll-max-voters" className="block text-sm font-medium mb-1">Höchstzahl an Teilnehmenden</label>
          <input
            id="poll-max-voters" type="number" name="maxVoters" min={1} max={10000}
            defaultValue={poll?.maxVoters ?? ''} placeholder="unbegrenzt"
            className="w-40 border border-gray-300 p-2 rounded"
          />
          <p className="text-xs text-gray-500 mt-1">
            Danach kann niemand mehr neu abstimmen; wer schon abgestimmt hat, kann seine Auswahl weiter ändern.
          </p>
        </div>
      </fieldset>
    </>
  )
}
