// app/erstellen/poll-settings-fields.tsx
import type { Poll, VoterIdentity } from '@prisma/client'
import { offeredIdentities } from '../lib/voter-identity'
import { MAX_ACCESS_CODE_LENGTH } from '../lib/access-code'
import { isMailConfigured } from '../lib/mail'

const IDENTITY_LABELS: Record<VoterIdentity, { title: string; text: string }> = {
  COOKIE: {
    title: 'Offen für alle mit dem Link (Standard)',
    text: 'Anonym und ohne Anmeldung. Eine Stimme pro Browser - wer Cookies löscht oder ein anderes Gerät nutzt, kann erneut abstimmen.'
  },
  RSVP: {
    title: 'Nur über rsvp-app (max. 1 Stimme pro Person)',
    text: 'Identität ist die über rsvp-app verifizierte E-Mail - die Abstimmung muss über einen entsprechend eingerichteten Link/Button in rsvp-app aufgerufen werden, direkter Zugriff kann nicht abstimmen. Nur Zusagende stimmen ab. Nur sinnvoll, sobald diese Verknüpfung eingerichtet ist (siehe README).'
  },
  LINK: {
    title: 'Persönliche Stimmlinks (1 Stimme pro Link)',
    text: 'Du stellst nach dem Anlegen auf der Verwaltungsseite für jede Person einen eigenen Link aus (Namensliste oder Anzahl) und verteilst ihn per Kopieren, QR-Code oder Mail. Du siehst, wer schon abgestimmt hat.'
  },
  EMAIL: {
    title: 'Mit bestätigter E-Mail-Adresse (1 Stimme pro Adresse)',
    text: 'Wer abstimmen will, gibt seine Adresse ein und bestätigt sie über einen Link per Mail. Wer mehrere Adressen hat, kann mehrfach abstimmen - dagegen hilft eine feste Liste unten.'
  },
  ACCOUNT: {
    title: 'Nur mit Konto (1 Stimme pro Konto)',
    text: 'Abstimmen kann, wer hier ein Konto hat - auch eines, das über ein verbundenes Tool entstanden ist. Angezeigt wird der Name, sonst die E-Mail des Kontos. Konten legst du unter "Nutzer" an (Rolle Moderator genügt).'
  }
}

type Settings = Pick<Poll, 'closesAt' | 'allowMultipleChoices' | 'voterIdentity' | 'showVoterNames' | 'requireVoterName' | 'maxVoters' | 'accessCode' | 'secretBallot' | 'allowedEmails' | 'quorum' | 'notifyOwnerOnClose'>

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
  const offered = offeredIdentities()
  const kinds = offered.includes(identity) ? offered : [...offered, identity]

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
            {kind === 'EMAIL' && (
              <div className="ml-6 mt-2">
                <label htmlFor="poll-allowed-emails" className="block text-sm text-amber-900">Nur diese Adressen bzw. Domains (optional)</label>
                <textarea
                  id="poll-allowed-emails" name="allowedEmails" rows={2} defaultValue={poll?.allowedEmails ?? ''}
                  placeholder={'@verein.de\nanna@example.org'}
                  className="w-full border border-amber-200 p-2 rounded text-sm bg-white"
                />
                <span className="block text-xs text-amber-700">
                  Eine Angabe pro Zeile: &quot;@verein.de&quot; lässt alle Adressen dieser Domain zu, sonst einzelne Adressen.
                  Leer = jede Adresse. Gilt auch nachträglich für schon bestätigte Adressen.
                </span>
              </div>
            )}
            {kind === 'LINK' && (
              <label className={`flex items-start gap-2 ml-6 mt-2 ${locked ? 'opacity-70' : 'cursor-pointer'}`}>
                <input type="checkbox" name="secretBallot" defaultChecked={poll?.secretBallot} disabled={locked} className="w-4 h-4 mt-0.5" />
                <span>
                  <span className="block text-sm text-amber-900">Geheime Wahl: nur Teilnahme speichern, nicht wer was gewählt hat</span>
                  <span className="block text-xs text-amber-700">
                    Die Verwaltung sieht dann nur, wer schon abgestimmt hat. Ehrliche Grenze: Wer die Links verteilt, kennt sie
                    und könnte mit einem Link nachsehen, wie diese Person gestimmt hat. Nach der ersten Stimme nicht mehr änderbar.
                  </span>
                </span>
              </label>
            )}
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
        <div>
          <label htmlFor="poll-quorum" className="block text-sm font-medium mb-1">Mindestbeteiligung (Quorum)</label>
          <input
            id="poll-quorum" type="number" name="quorum" min={1} max={10000}
            defaultValue={poll?.quorum ?? ''} placeholder="keine"
            className="w-40 border border-gray-300 p-2 rounded"
          />
          <p className="text-xs text-gray-500 mt-1">
            Das Ergebnis gilt erst ab so vielen Teilnehmenden, sonst heißt es &quot;nicht beschlussfähig&quot;.
          </p>
        </div>
        {/* Neue Abstimmungen: an; bestehende behalten ihre Einstellung. */}
        {isMailConfigured() && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="notifyOwnerOnClose" defaultChecked={poll ? poll.notifyOwnerOnClose : true} className="w-4 h-4" />
            <span className="text-sm">Ergebnis beim Schließen an das Konto mailen, dem die Abstimmung gehört</span>
          </label>
        )}
      </fieldset>
    </>
  )
}
