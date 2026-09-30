// app/erstellen/voter-identity-fields.tsx
import type { VoterIdentity } from '@prisma/client'
import { OFFERED_IDENTITIES } from '../lib/voter-identity'

const LABELS: Record<VoterIdentity, { title: string; text: string }> = {
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

/**
 * Auswahl "Wer darf abstimmen?" (Poll.voterIdentity) plus der Schalter für die namentliche
 * Anzeige - gemeinsam für Anlegen und Bearbeiten. `locked`: Es gibt schon Stimmen, der
 * Modus steht dann fest (updatePoll ignoriert ihn ebenfalls, siehe app/actions.ts).
 */
export default function VoterIdentityFields({
  identity = 'COOKIE',
  showVoterNames = false,
  locked = false
}: {
  identity?: VoterIdentity
  showVoterNames?: boolean
  locked?: boolean
}) {
  // Ein (künftig) nicht mehr angebotener Modus einer bestehenden Abstimmung bleibt sichtbar.
  const kinds = OFFERED_IDENTITIES.includes(identity) ? OFFERED_IDENTITIES : [...OFFERED_IDENTITIES, identity]

  return (
    <fieldset className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-3">
      <legend className="text-sm font-medium text-amber-900 px-1">Wer darf abstimmen?</legend>
      {locked && (
        <p className="text-xs text-amber-800">
          Es wurde schon abgestimmt - die Art der Stimmabgabe lässt sich deshalb nicht mehr ändern.
        </p>
      )}
      {kinds.map(kind => (
        <label key={kind} className={`flex items-start gap-2 ${locked ? 'opacity-70' : 'cursor-pointer'}`}>
          <input
            type="radio"
            name="voterIdentity"
            value={kind}
            defaultChecked={kind === identity}
            disabled={locked}
            className="w-4 h-4 mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-amber-900">{LABELS[kind].title}</span>
            {LABELS[kind].text && <span className="block text-xs text-amber-700">{LABELS[kind].text}</span>}
          </span>
        </label>
      ))}

      <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-amber-200">
        <input type="checkbox" name="showVoterNames" defaultChecked={showVoterNames} className="w-4 h-4 mt-0.5" />
        <span>
          <span className="block text-sm font-medium text-amber-900">
            Abstimmende namentlich anzeigen (auf der öffentlichen Ergebnisseite)
          </span>
          <span className="block text-xs text-amber-700">
            Zeigt bei jeder Option, wer dafür gestimmt hat (je nach Art der Stimmabgabe Name oder E-Mail). Bei
            &quot;Offen für alle&quot; gibt es keine Namen - dort bleibt das Ergebnis anonym.
          </span>
        </span>
      </label>
    </fieldset>
  )
}
