// app/erstellen/poll-settings-fields.tsx
import type { Poll, VoterIdentity } from '@prisma/client'
import { offeredIdentities } from '../lib/voter-identity'
import { MAX_ACCESS_CODE_LENGTH } from '../lib/access-code'
import { isMailConfigured } from '../lib/mail'
import { isPushConfigured } from '../lib/push'
import { DEFAULT_POINTS_BUDGET, MAX_POINTS_BUDGET, POLL_TYPE_LABELS, POLL_TYPES } from '../lib/poll-types'
import { IDENTITY_SHORT } from '../lib/poll-status'
import { participantIdps } from '../lib/participant'
import { idpLabel } from '../lib/suite'
import { hintClass, inputClass, labelClass, SettingsSection } from '../ui/kit'

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
    text: 'Du stellst unter "Stimmlinks" für jede Person einen eigenen Link aus (Namensliste oder Anzahl) und verteilst ihn per Kopieren, QR-Code oder Mail. Du siehst, wer schon abgestimmt hat.'
  },
  EMAIL: {
    title: 'Mit bestätigter E-Mail-Adresse (1 Stimme pro Adresse)',
    text: 'Wer abstimmen will, gibt seine Adresse ein und bestätigt sie über einen Link per Mail. Wer mehrere Adressen hat, kann mehrfach abstimmen - dagegen hilft eine feste Liste unten.'
  },
  ACCOUNT: {
    title: 'Nur mit Konto (1 Stimme pro Person)',
    // Der Text hängt davon ab, ob Teilnehmendenkonten aus dem Verbund angenommen werden - siehe accountText().
    text: ''
  },
  // Nie wählbar (offeredIdentities), nur der Vollständigkeit halber - Abstimmungen einer Sitzung legt die Sitzung an.
  ASSEMBLY: {
    title: 'Mitglieder der Sitzung',
    text: 'Abstimmung einer Sitzung: Mitglieder über rsvp-app, je nach Sitzung nur Anwesende.'
  }
}

const VISIBILITY_SHORT = { ALWAYS: 'Ergebnis live', AFTER_VOTE: 'Ergebnis nach der eigenen Stimme', AFTER_CLOSE: 'Ergebnis nach dem Ende', MANAGERS: 'Ergebnis nur für die Verwaltung' } as const

type Settings = Pick<Poll, 'closesAt' | 'allowMultipleChoices' | 'voterIdentity' | 'showVoterNames' | 'requireVoterName' | 'maxVoters' | 'accessCode' | 'secretBallot' | 'allowedEmails' | 'quorum' | 'notifyOwnerOnClose' | 'resultsVisibility' | 'minChoices' | 'maxChoices' | 'allowVoterOptions' | 'voterOptionsNeedApproval' | 'pollType' | 'pointsBudget' | 'confirmDate' | 'optionKind'>

/**
 * Erklärung zum Modus ACCOUNT. Nehmen wir Teilnehmendenkonten aus dem Verbund an (app/lib/participant.ts),
 * ist das der Weg für Gäste - ein Konto hier brauchen sie dann nicht. Sonst bleibt nur ein eigenes Konto
 * (für reine Abstimmende mit der Rolle Moderator).
 */
function accountText(): string {
  const providers = participantIdps().map(idpLabel)
  if (providers.length === 0) {
    return 'Abstimmen kann, wer hier ein Konto hat - auch eines aus einem verbundenen Tool. Angezeigt wird der Name, sonst die E-Mail. Wer nur abstimmen soll, bekommt unter "Konten" ein Konto mit der Rolle Moderator.'
  }
  return `Gäste melden sich mit ihrem Teilnehmendenkonto bei ${providers.join(' oder ')} an - ein Konto hier brauchen sie nicht. Beim ersten Mal stimmen sie dort zu; übertragen werden nur Name und eine Kennung, keine E-Mail. Abstimmen kann außerdem, wer hier ein Konto hat. Angezeigt wird der Name, geräteübergreifend gilt eine Stimme pro Person.`
}

const radioRow = 'flex items-start gap-2'
const smallInput = inputClass.replace('w-full', 'w-20')
const mediumInput = inputClass.replace('w-full', 'w-full sm:w-40')
const checkbox = 'h-4 w-4 mt-0.5 shrink-0'

/**
 * Die Einstellungen einer Abstimmung als einklappbare Abschnitte der Einstellungen-Seite (Gegenstück:
 * parsePollSettings/parseVoterIdentity in app/actions.ts). Zugeklappte Abschnitte werden mitgeschickt.
 * `locked`: Es gibt schon Stimmen, Art und Stimmmodus stehen dann fest (updatePoll ignoriert sie ebenfalls).
 * `open`: Abschnitt, der aufgeklappt beginnt (z.B. aus dem Hinweis nach dem Anlegen).
 */
export default function PollSettingsFields({ poll, locked = false, open }: { poll: Settings; locked?: boolean; open?: string }) {
  const identity = poll.voterIdentity
  // Ein (künftig) nicht mehr angebotener Modus einer bestehenden Abstimmung bleibt sichtbar.
  const offered = offeredIdentities()
  const kinds = offered.includes(identity) ? offered : [...offered, identity]
  const lockedNote = locked ? ' · gesperrt' : ''

  return (
    <>
      <SettingsSection
        id="art" title="Art der Abstimmung" open={open === 'art'} marker="blue"
        summary={`${POLL_TYPE_LABELS[poll.pollType].title}${poll.pollType === 'POINTS' ? ` (${poll.pointsBudget ?? DEFAULT_POINTS_BUDGET} Punkte)` : ''}${poll.pollType === 'CHOICE' && poll.allowMultipleChoices ? ' · Mehrfachauswahl' : ''}${lockedNote}`}
      >
        <fieldset className="space-y-2">
          <legend className="sr-only">Art der Abstimmung</legend>
          {locked && <p className="text-sm text-gray-600 dark:text-gray-400">Es wurde schon abgestimmt - die Art lässt sich nicht mehr ändern.</p>}
          {POLL_TYPES.map(type => (
            <label key={type} className={`${radioRow} ${locked ? 'opacity-70' : 'cursor-pointer'}`}>
              <input type="radio" name="pollType" value={type} defaultChecked={type === poll.pollType} disabled={locked} className={checkbox} />
              <span>
                <span className="block text-sm font-medium">{POLL_TYPE_LABELS[type].title}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{POLL_TYPE_LABELS[type].text}</span>
              </span>
            </label>
          ))}
          <div className="ml-6 flex items-center gap-2 text-sm">
            <label htmlFor="poll-points-budget">Punkte pro Person (nur bei &quot;Punkte verteilen&quot;)</label>
            <input
              id="poll-points-budget" type="number" name="pointsBudget" min={1} max={MAX_POINTS_BUDGET} disabled={locked}
              defaultValue={poll.pointsBudget ?? DEFAULT_POINTS_BUDGET} className={smallInput}
            />
          </div>
        </fieldset>

        <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="allowMultipleChoices" defaultChecked={poll.allowMultipleChoices} className="h-4 w-4" />
            <span className="text-sm font-medium">Mehrfachauswahl erlauben (mehrere Optionen gleichzeitig wählbar, nur bei &quot;Auswahl&quot;)</span>
          </label>
          <div className="ml-6 mt-2 flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="poll-min-choices">mindestens</label>
            <input id="poll-min-choices" type="number" name="minChoices" min={1} max={25} defaultValue={poll.minChoices ?? ''} placeholder="1" className={smallInput} />
            <label htmlFor="poll-max-choices">höchstens</label>
            <input id="poll-max-choices" type="number" name="maxChoices" min={1} max={25} defaultValue={poll.maxChoices ?? ''} placeholder="alle" className={smallInput} />
            <span className="text-xs text-gray-500 dark:text-gray-400">Optionen pro Stimme (optional, nur bei Mehrfachauswahl)</span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        id="wer" title="Wer darf abstimmen?" open={open === 'wer'} marker="amber"
        summary={`${IDENTITY_SHORT[identity]}${poll.secretBallot ? ', geheim' : ''}${lockedNote}`}
      >
        <fieldset className="space-y-3">
          <legend className="sr-only">Wer darf abstimmen?</legend>
          {locked && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Es wurde schon abgestimmt - die Art der Stimmabgabe lässt sich deshalb nicht mehr ändern.
            </p>
          )}
          {kinds.map(kind => (
            <div key={kind}>
              <label className={`${radioRow} ${locked ? 'opacity-70' : 'cursor-pointer'}`}>
                <input type="radio" name="voterIdentity" value={kind} defaultChecked={kind === identity} disabled={locked} className={checkbox} />
                <span>
                  <span className="block text-sm font-medium">{IDENTITY_LABELS[kind].title}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{kind === 'ACCOUNT' ? accountText() : IDENTITY_LABELS[kind].text}</span>
                </span>
              </label>
              {kind === 'EMAIL' && (
                <div className="ml-6 mt-2">
                  <label htmlFor="poll-allowed-emails" className="block text-sm">Nur diese Adressen bzw. Domains (optional)</label>
                  <textarea
                    id="poll-allowed-emails" name="allowedEmails" rows={2} defaultValue={poll.allowedEmails ?? ''}
                    placeholder={'@verein.de\nanna@example.org'} className={inputClass}
                  />
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    Eine Angabe pro Zeile: &quot;@verein.de&quot; lässt alle Adressen dieser Domain zu, sonst einzelne Adressen.
                    Leer = jede Adresse. Gilt auch nachträglich für schon bestätigte Adressen.
                  </span>
                </div>
              )}
              {kind === 'LINK' && (
                <label className={`${radioRow} ml-6 mt-2 ${locked ? 'opacity-70' : 'cursor-pointer'}`}>
                  <input type="checkbox" name="secretBallot" defaultChecked={poll.secretBallot} disabled={locked} className={checkbox} />
                  <span>
                    <span className="block text-sm">Geheime Wahl: nur Teilnahme speichern, nicht wer was gewählt hat</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      Die Verwaltung sieht dann nur, wer schon abgestimmt hat. Ehrliche Grenze: Wer die Links verteilt, kennt sie
                      und könnte mit einem Link nachsehen, wie diese Person gestimmt hat. Nach der ersten Stimme nicht mehr änderbar.
                    </span>
                  </span>
                </label>
              )}
              {kind === 'COOKIE' && (
                <label className={`${radioRow} ml-6 mt-2 cursor-pointer`}>
                  <input type="checkbox" name="requireVoterName" defaultChecked={poll.requireVoterName} className={checkbox} />
                  <span>
                    <span className="block text-sm">Namen beim Abstimmen verlangen</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      Keine Überprüfung - jeder kann jeden Namen eingeben. Zusammen mit der namentlichen Anzeige (Abschnitt
                      &quot;Ergebnis&quot;) sieht aber die ganze Gruppe, wer wofür gestimmt hat (soziale Kontrolle).
                    </span>
                  </span>
                </label>
              )}
            </div>
          ))}
        </fieldset>
      </SettingsSection>

      <SettingsSection
        id="ergebnis" title="Ergebnis" open={open === 'ergebnis'} marker="green"
        summary={`${VISIBILITY_SHORT[poll.resultsVisibility]}${poll.showVoterNames ? ', mit Namen' : ''}${poll.quorum !== null ? `, Quorum ${poll.quorum}` : ''}`}
      >
        <div>
          <label htmlFor="poll-results-visibility" className={labelClass}>Ergebnis öffentlich zeigen</label>
          <select id="poll-results-visibility" name="resultsVisibility" defaultValue={poll.resultsVisibility} className={inputClass}>
            <option value="ALWAYS">immer (live)</option>
            <option value="AFTER_VOTE">erst nach der eigenen Stimme</option>
            <option value="AFTER_CLOSE">erst nach dem Ende der Abstimmung</option>
            <option value="MANAGERS">nie - nur für die Verwaltung</option>
          </select>
          <p className={hintClass}>
            Wer die Abstimmung verwaltet, sieht das Ergebnis immer. Bei &quot;nur Verwaltung&quot; wird es auch nicht an rsvp-app gemeldet.
          </p>
        </div>
        <label className={`${radioRow} cursor-pointer`}>
          <input type="checkbox" name="showVoterNames" defaultChecked={poll.showVoterNames} className={checkbox} />
          <span>
            <span className="block text-sm font-medium">Abstimmende namentlich anzeigen (auf der öffentlichen Ergebnisseite)</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              Zeigt bei jeder Option, wer dafür gestimmt hat (je nach Art der Stimmabgabe Name oder E-Mail). Bei
              &quot;Offen für alle&quot; ohne verlangten Namen gibt es keine Namen - dort bleibt das Ergebnis anonym.
            </span>
          </span>
        </label>
        <div>
          <label htmlFor="poll-quorum" className={labelClass}>Mindestbeteiligung (Quorum)</label>
          <input id="poll-quorum" type="number" name="quorum" min={1} max={10000} defaultValue={poll.quorum ?? ''} placeholder="keine" className={mediumInput} />
          <p className={hintClass}>Das Ergebnis gilt erst ab so vielen Teilnehmenden, sonst heißt es &quot;nicht beschlussfähig&quot;.</p>
        </div>
        {poll.optionKind !== 'TEXT' && (
          <label className={`${radioRow} cursor-pointer`}>
            <input type="checkbox" name="confirmDate" defaultChecked={poll.confirmDate} className={checkbox} />
            <span>
              <span className="block text-sm font-medium">Terminabstimmung: nach dem Ende Termin festlegen</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Nach dem Ende bestätigst du den Termin (bei Gleichstand wählst du einen der gleichauf liegenden). Dann werden alle
                Abstimmenden benachrichtigt, die erreichbar sind (nicht bei &quot;Offen für alle&quot;), und der Termin geht an rsvp-app:
                Events dort mit Link auf diese Abstimmung und offenem Datum übernehmen ihn, sonst kann ein neues Event entstehen.
              </span>
            </span>
          </label>
        )}
        {(isMailConfigured() || isPushConfigured()) && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="notifyOwnerOnClose" defaultChecked={poll.notifyOwnerOnClose} className="h-4 w-4" />
            <span className="text-sm">Ergebnis beim Schließen dem Konto mitteilen, dem die Abstimmung gehört (Mail bzw. Push)</span>
          </label>
        )}
      </SettingsSection>

      <SettingsSection
        id="zugang" title="Zugang und Teilnahme" open={open === 'zugang'} marker="gray"
        summary={[poll.accessCode ? 'Zugangscode' : null, poll.maxVoters !== null ? `höchstens ${poll.maxVoters}` : null, poll.allowVoterOptions ? 'Vorschläge erlaubt' : null].filter(Boolean).join(', ') || 'ohne Hürden'}
      >
        <div>
          <label htmlFor="poll-access-code" className={labelClass}>Zugangscode</label>
          <input
            id="poll-access-code" name="accessCode" maxLength={MAX_ACCESS_CODE_LENGTH} autoComplete="off"
            defaultValue={poll.accessCode ?? ''} placeholder="z.B. Sommerfest" className={inputClass}
          />
          <p className={hintClass}>
            Ohne Code sieht niemand Optionen oder Ergebnis. Hält Fremde fern, verhindert aber <strong>keine</strong>{' '}
            Mehrfachabstimmung - alle Berechtigten kennen denselben Code. Groß-/Kleinschreibung zählt nicht.
            Ein geänderter Code sperrt alle aus, bis sie den neuen eingeben.
          </p>
        </div>
        <div>
          <label htmlFor="poll-max-voters" className={labelClass}>Höchstzahl an Teilnehmenden</label>
          <input id="poll-max-voters" type="number" name="maxVoters" min={1} max={10000} defaultValue={poll.maxVoters ?? ''} placeholder="unbegrenzt" className={mediumInput} />
          <p className={hintClass}>Danach kann niemand mehr neu abstimmen; wer schon abgestimmt hat, kann seine Auswahl weiter ändern.</p>
        </div>
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="allowVoterOptions" defaultChecked={poll.allowVoterOptions} className="h-4 w-4" />
            <span className="text-sm font-medium">Teilnehmende dürfen Optionen vorschlagen</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer ml-6 mt-1">
            <input type="checkbox" name="voterOptionsNeedApproval" defaultChecked={poll.voterOptionsNeedApproval} className="h-4 w-4" />
            <span className="text-sm">erst nach Freigabe durch die Verwaltung sichtbar</span>
          </label>
        </div>
      </SettingsSection>
    </>
  )
}
