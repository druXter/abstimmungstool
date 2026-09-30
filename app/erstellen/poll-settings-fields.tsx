// app/erstellen/poll-settings-fields.tsx
import type { Poll, VoterIdentity } from '@prisma/client'
import { offeredIdentities } from '../lib/voter-identity'
import { MAX_ACCESS_CODE_LENGTH } from '../lib/access-code'
import { isMailConfigured } from '../lib/mail'
import { isPushConfigured } from '../lib/push'
import { toInputValue } from '../lib/date-options'
import { DEFAULT_POINTS_BUDGET, MAX_POINTS_BUDGET, POLL_TYPE_LABELS, POLL_TYPES } from '../lib/poll-types'

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

type Settings = Pick<Poll, 'closesAt' | 'allowMultipleChoices' | 'voterIdentity' | 'showVoterNames' | 'requireVoterName' | 'maxVoters' | 'accessCode' | 'secretBallot' | 'allowedEmails' | 'quorum' | 'notifyOwnerOnClose' | 'resultsVisibility' | 'minChoices' | 'maxChoices' | 'allowVoterOptions' | 'voterOptionsNeedApproval' | 'pollType' | 'pointsBudget' | 'confirmDate'>

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
      <fieldset className="rounded-md border border-gray-200 p-4 space-y-2">
        <legend className="text-sm font-medium px-1">Art der Abstimmung</legend>
        {locked && <p className="text-xs text-gray-600">Es wurde schon abgestimmt - die Art lässt sich nicht mehr ändern.</p>}
        {POLL_TYPES.map(type => (
          <label key={type} className={`flex items-start gap-2 ${locked ? 'opacity-70' : 'cursor-pointer'}`}>
            <input
              type="radio" name="pollType" value={type} defaultChecked={type === (poll?.pollType ?? 'CHOICE')} disabled={locked}
              className="w-4 h-4 mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium">{POLL_TYPE_LABELS[type].title}</span>
              <span className="block text-xs text-gray-500">{POLL_TYPE_LABELS[type].text}</span>
            </span>
          </label>
        ))}
        <div className="ml-6 flex items-center gap-2 text-sm">
          <label htmlFor="poll-points-budget">Punkte pro Person (nur bei &quot;Punkte verteilen&quot;)</label>
          <input
            id="poll-points-budget" type="number" name="pointsBudget" min={1} max={MAX_POINTS_BUDGET} disabled={locked}
            defaultValue={poll?.pointsBudget ?? DEFAULT_POINTS_BUDGET}
            className="w-20 border border-gray-300 p-1.5 rounded"
          />
        </div>
      </fieldset>

      <div>
        <label htmlFor="poll-closes-at" className="block text-sm font-medium mb-1">Automatisch schließen am (optional)</label>
        <input
          id="poll-closes-at" type="datetime-local" name="closesAt" defaultValue={poll?.closesAt ? toInputValue(poll.closesAt, 'DATETIME') : ''}
          className="w-full border border-gray-300 p-2 rounded"
        />
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" name="allowMultipleChoices" defaultChecked={poll?.allowMultipleChoices} className="w-4 h-4" />
          <span className="text-sm font-medium">Mehrfachauswahl erlauben (mehrere Optionen gleichzeitig wählbar, nur bei &quot;Auswahl&quot;)</span>
        </label>
        <div className="ml-6 mt-2 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="poll-min-choices">mindestens</label>
          <input id="poll-min-choices" type="number" name="minChoices" min={1} max={25} defaultValue={poll?.minChoices ?? ''} placeholder="1" className="w-20 border border-gray-300 p-1.5 rounded" />
          <label htmlFor="poll-max-choices">höchstens</label>
          <input id="poll-max-choices" type="number" name="maxChoices" min={1} max={25} defaultValue={poll?.maxChoices ?? ''} placeholder="alle" className="w-20 border border-gray-300 p-1.5 rounded" />
          <span className="text-xs text-gray-500">Optionen pro Stimme (optional, nur bei Mehrfachauswahl)</span>
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" name="confirmDate" defaultChecked={poll ? poll.confirmDate : true} className="w-4 h-4" />
          <span className="text-sm font-medium">Terminabstimmung: nach dem Ende Termin festlegen (nur bei Tagen/Terminen)</span>
        </label>
        <p className="text-xs text-gray-500 ml-6">
          Nach dem Ende bestätigst du den Termin (bei Gleichstand wählst du einen der gleichauf liegenden). Dann werden alle
          Abstimmenden benachrichtigt, die erreichbar sind (nicht bei &quot;Offen für alle&quot;), und der Termin geht an rsvp-app:
          Events dort mit Link auf diese Abstimmung und offenem Datum übernehmen ihn, sonst kann ein neues Event entstehen.
        </p>
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" name="allowVoterOptions" defaultChecked={poll?.allowVoterOptions} className="w-4 h-4" />
          <span className="text-sm font-medium">Teilnehmende dürfen Optionen vorschlagen</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer ml-6 mt-1">
          <input type="checkbox" name="voterOptionsNeedApproval" defaultChecked={poll ? poll.voterOptionsNeedApproval : true} className="w-4 h-4" />
          <span className="text-sm">erst nach Freigabe durch die Verwaltung sichtbar</span>
        </label>
      </div>

      <div>
        <label htmlFor="poll-results-visibility" className="block text-sm font-medium mb-1">Ergebnis öffentlich zeigen</label>
        <select
          id="poll-results-visibility" name="resultsVisibility" defaultValue={poll?.resultsVisibility ?? 'ALWAYS'}
          className="w-full border border-gray-300 p-2 rounded bg-white"
        >
          <option value="ALWAYS">immer (live)</option>
          <option value="AFTER_VOTE">erst nach der eigenen Stimme</option>
          <option value="AFTER_CLOSE">erst nach dem Ende der Abstimmung</option>
          <option value="MANAGERS">nie - nur für die Verwaltung</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          Wer die Abstimmung verwaltet, sieht das Ergebnis immer. Bei &quot;nur Verwaltung&quot; wird es auch nicht an rsvp-app gemeldet.
        </p>
      </div>

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
        {(isMailConfigured() || isPushConfigured()) && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="notifyOwnerOnClose" defaultChecked={poll ? poll.notifyOwnerOnClose : true} className="w-4 h-4" />
            <span className="text-sm">Ergebnis beim Schließen dem Konto mitteilen, dem die Abstimmung gehört (Mail bzw. Push)</span>
          </label>
        )}
      </fieldset>
    </>
  )
}
