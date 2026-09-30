// app/[pollId]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '../lib/prisma'
import { castVote, forgetVoteEmail, requestVoteEmail, suggestOption, unlockPoll } from '../actions'
import { inputTypeFor } from '../lib/date-options'
import { resolveVoter } from '../lib/voter-identity'
import { hasPollAccess, MAX_ACCESS_CODE_LENGTH } from '../lib/access-code'
import SubmitButton from '../ui/submit-button'
import Notice from '../ui/notice'
import PollResults from './poll-results'
import { choiceLimits, loadResult, loadVoterNames, resultsVisible } from '../lib/results'
import BallotInputs from './ballot-inputs'
import { finalDateLabel } from '../lib/final-date'
import { parseTransfer } from '../lib/rsvp-date'
import { POLL_TYPE_LABELS } from '../lib/poll-types'

export const dynamic = 'force-dynamic'

// Rückmeldungen der Server Actions (?hinweis=..., siehe pollUrl in app/actions.ts). Nur
// feste Texte - ein unbekannter Wert zeigt nichts an.
const NOTICES: Record<string, { tone: 'success' | 'warning' | 'error'; text: string }> = {
  gedrosselt: { tone: 'warning', text: 'Von deinem Netzwerk aus haben in der letzten Stunde sehr viele neue Personen abgestimmt. Bitte versuche es später noch einmal.' },
  voll: { tone: 'warning', text: 'Die Höchstzahl an Teilnehmenden ist inzwischen erreicht - deine Stimme wurde nicht gezählt.' },
  'code-falsch': { tone: 'error', text: 'Der Zugangscode stimmt nicht.' },
  'code-gesperrt': { tone: 'error', text: 'Zu viele Versuche. Bitte warte eine Viertelstunde und versuche es dann erneut.' },
  auswahl: { tone: 'error', text: 'Bitte halte dich an die angegebene Anzahl von Optionen - deine Auswahl wurde nicht gespeichert.' },
  rangfolge: { tone: 'error', text: 'Jeder Platz darf nur einmal vergeben werden - deine Rangfolge wurde nicht gespeichert.' },
  punkte: { tone: 'error', text: 'Du hast mehr Punkte verteilt als erlaubt - deine Stimme wurde nicht gespeichert.' },
  'vorschlag-wartet': { tone: 'success', text: 'Danke für deinen Vorschlag! Er erscheint, sobald die Verwaltung ihn freigegeben hat.' },
  'vorschlag-da': { tone: 'success', text: 'Deine Option steht jetzt zur Wahl.' },
  'vorschlag-ungueltig': { tone: 'error', text: 'Bitte gib eine Option ein.' },
  'vorschlag-doppelt': { tone: 'error', text: 'Diese Option gibt es schon (oder sie wurde schon vorgeschlagen).' },
  'vorschlag-voll': { tone: 'error', text: 'Diese Abstimmung hat schon die höchstmögliche Zahl an Optionen.' },
  'vorschlag-gedrosselt': { tone: 'error', text: 'Von deinem Netzwerk aus kamen gerade sehr viele Vorschläge. Bitte versuche es später erneut.' },
  'mail-gesendet': { tone: 'success', text: 'Wir haben dir einen Bestätigungslink geschickt. Öffne ihn in diesem Browser, um abzustimmen - er ist 24 Stunden gültig.' },
  'mail-bestaetigt': { tone: 'success', text: 'Deine Adresse ist bestätigt. Du kannst jetzt abstimmen.' },
  'mail-ungueltig': { tone: 'error', text: 'Bitte gib eine gültige E-Mail-Adresse ein.' },
  'mail-nicht-zugelassen': { tone: 'error', text: 'Mit dieser Adresse kann bei dieser Abstimmung nicht abgestimmt werden.' },
  'mail-gedrosselt': { tone: 'error', text: 'Für diese Adresse wurden gerade schon mehrere Links angefordert. Bitte schau in dein Postfach (auch in den Spam-Ordner) oder versuche es in einer Stunde erneut.' },
  'mail-fehler': { tone: 'error', text: 'Die Mail konnte gerade nicht verschickt werden. Bitte versuche es später erneut.' }
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-sm">{children}</div>
}

export default async function PollPage({
  params,
  searchParams
}: {
  params: Promise<{ pollId: string }>
  searchParams: Promise<{ verify?: string; k?: string; hinweis?: string; code?: string }>
}) {
  const { pollId } = await params
  const { verify, k, hinweis, code } = await searchParams
  // Identitäts-Nachweise aus der URL wandern als versteckte Felder in jedes Formular (und von
  // dort per pollUrl zurück in die URL) - siehe IdentityParams in app/lib/voter-identity.ts.
  const identityInputs = (
    <>
      {verify && <input type="hidden" name="verifyToken" value={verify} />}
      {k && <input type="hidden" name="linkToken" value={k} />}
    </>
  )
  const notice = hinweis && Object.hasOwn(NOTICES, hinweis) ? NOTICES[hinweis] : null

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: { options: { where: { approved: true }, orderBy: { position: 'asc' }, select: { id: true, label: true } } }
  })
  if (!poll) notFound()

  // Zugangscode: Ohne ihn verrät die Seite nichts über die Abstimmung, nicht einmal den
  // Titel. `?code=` (Link mit Code von der Verwaltungsseite) füllt das Feld nur vor -
  // freigeschaltet wird immer erst per Formular, weil nur eine Server Action das Cookie setzen darf.
  if (!(await hasPollAccess(poll))) {
    return (
      <main className="min-h-screen bg-gray-50 py-10 px-4">
        <form action={unlockPoll} className="max-w-sm mx-auto bg-white p-6 rounded-lg shadow space-y-4 text-gray-900">
          <h1 className="text-xl font-bold">Zugangscode erforderlich</h1>
          <p className="text-sm text-gray-600">Diese Abstimmung ist mit einem Zugangscode geschützt. Du bekommst ihn von der Person, die dich eingeladen hat.</p>
          {notice && <Notice tone="error">{notice.text}</Notice>}
          <input type="hidden" name="pollId" value={poll.id} />
          {identityInputs}
          <div>
            <label htmlFor="access-code" className="block text-sm font-medium mb-1">Zugangscode</label>
            <input
              id="access-code" name="accessCode" required maxLength={MAX_ACCESS_CODE_LENGTH} autoComplete="off"
              defaultValue={code?.slice(0, MAX_ACCESS_CODE_LENGTH)}
              className="w-full border border-gray-300 p-2 rounded"
            />
          </div>
          <SubmitButton>Weiter</SubmitButton>
        </form>
      </main>
    )
  }

  // Auswertung je Art (app/lib/results.ts); Teilnehmende = verschiedene Personen.
  const result = (await loadResult(poll.id))!
  const distinctVoters = result.voters
  const isClosed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < new Date())
  // Terminabstimmung festgelegt: Link auf das rsvp-app-Event, falls eins den Termin übernommen hat.
  const transfer = parseTransfer(poll.rsvpTransfer)
  const finalEventUrl = transfer?.created?.url ?? transfer?.updated?.[0]?.url ?? null

  // Wer hier abstimmt (und ob überhaupt), entscheidet allein resolveVoter anhand von
  // poll.voterIdentity - siehe app/lib/voter-identity.ts.
  const { voter, block } = await resolveVoter(poll, { verifyToken: verify, linkToken: k }, { create: false })
  const myVoteRows = voter
    ? await prisma.vote.findMany({ where: { pollId: poll.id, voterKey: voter.key }, select: { optionId: true, voterName: true, value: true } })
    : []
  const myVotes = Object.fromEntries(myVoteRows.map(v => [v.optionId, v.value]))
  const hasVoted = myVoteRows.length > 0

  // Wer schon abgestimmt hat, darf trotz erreichter Höchstzahl weiter ändern.
  const isFull = poll.maxVoters !== null && distinctVoters >= poll.maxVoters && !hasVoted
  const canVote = !isClosed && !block && !isFull
  const asksForName = poll.voterIdentity === 'COOKIE' && poll.requireVoterName
  const showResults = resultsVisible(poll.resultsVisibility, { hasVoted, closed: isClosed })
  const limits = choiceLimits(poll)
  const secretLinks = poll.voterIdentity === 'LINK' && poll.secretBallot
  const namesVisible = (poll.voterIdentity !== 'COOKIE' && !secretLinks) || asksForName

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h1 className="text-2xl font-bold text-gray-900">{poll.title}</h1>
          {poll.description && (
            <p className="text-gray-600 mt-2 whitespace-pre-wrap">{poll.description}</p>
          )}
          {isClosed && (
            <p className="mt-3 text-sm font-medium text-orange-700 bg-orange-50 inline-block px-3 py-1 rounded">
              Diese Abstimmung ist beendet.
            </p>
          )}
          {poll.finalStartsAt && (
            <p className="mt-3 text-sm font-medium text-green-800 bg-green-50 border border-green-200 px-3 py-2 rounded">
              📅 Termin steht fest: {finalDateLabel(poll.finalStartsAt)}
              {finalEventUrl && <> · <a href={finalEventUrl} className="underline">zur Veranstaltung (Zu-/Absage)</a></>}
            </p>
          )}
        </div>

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        {!isClosed && block === 'rsvp-missing' && (
          <Hint>
            Diese Abstimmung ist nur über den entsprechenden Link/Button in rsvp-app erreichbar,
            damit jede Person nur einmal abstimmen kann. Ein direkter, anonymer Aufruf dieser Seite
            kann hier bewusst nicht abstimmen.
          </Hint>
        )}

        {!isClosed && block === 'rsvp-declined' && (
          <Hint>
            Du hast für den zugehörigen Termin abgesagt und kannst daher hier nicht (mehr) abstimmen.
            Sag erneut zu, um wieder abstimmen zu können.
          </Hint>
        )}

        {!isClosed && block === 'account-missing' && (
          <Hint>
            Für diese Abstimmung brauchst du ein Konto, damit jede Person nur einmal abstimmt.{' '}
            <Link href={`/anmelden?next=${encodeURIComponent(`/${poll.id}`)}`} className="underline font-medium">Jetzt anmelden</Link>
          </Hint>
        )}

        {!isClosed && block === 'email-missing' && (
          <form action={requestVoteEmail} className="bg-white p-6 rounded-lg shadow space-y-3">
            <input type="hidden" name="pollId" value={poll.id} />
            <h2 className="font-bold text-gray-900">Mit E-Mail-Adresse abstimmen</h2>
            <p className="text-sm text-gray-600">
              Damit jede Person nur einmal abstimmt, bestätigst du zuerst deine Adresse: Wir schicken dir einen Link,
              danach kannst du in diesem Browser abstimmen.
            </p>
            <div>
              <label htmlFor="vote-email" className="block text-sm font-medium text-gray-800 mb-1">E-Mail-Adresse</label>
              <input
                id="vote-email" type="email" name="email" required maxLength={254} autoComplete="email"
                className="w-full border border-gray-300 p-2 rounded text-gray-900"
              />
            </div>
            <SubmitButton>Bestätigungslink schicken</SubmitButton>
          </form>
        )}

        {!isClosed && block === 'email-not-allowed' && (
          <Hint>
            Die bestätigte Adresse <strong>{voter?.name}</strong> ist für diese Abstimmung (inzwischen) nicht zugelassen.
            <form action={forgetVoteEmail} className="mt-2">
              <input type="hidden" name="pollId" value={poll.id} />
              <button type="submit" className="underline font-medium">Andere Adresse verwenden</button>
            </form>
          </Hint>
        )}

        {!isClosed && block === 'link-missing' && (
          <Hint>
            Für diese Abstimmung bekommt jede Person einen persönlichen Link. Öffne bitte den Link, den du erhalten
            hast - ohne ihn kannst du hier nicht abstimmen.
          </Hint>
        )}

        {!isClosed && block === 'link-used' && (
          <Hint>
            Mit deinem Link wurde bereits abgestimmt, bevor er neu ausgestellt wurde. Weil die Wahl geheim ist, lässt
            sich diese Stimme nicht mehr zuordnen und daher auch nicht ändern - sie zählt aber.
          </Hint>
        )}


        {!isClosed && !block && isFull && (
          <Hint>Die Höchstzahl von {poll.maxVoters} Teilnehmenden ist erreicht - hier kann niemand mehr neu abstimmen.</Hint>
        )}

        {canVote && (
          <form action={castVote} className="bg-white p-6 rounded-lg shadow space-y-3">
            <input type="hidden" name="pollId" value={poll.id} />
            {identityInputs}
            <h2 className="font-bold text-gray-900 mb-2">
              {hasVoted ? 'Deine Auswahl ändern' : 'Jetzt abstimmen'}
            </h2>
            {voter?.kind === 'RSVP' && (
              <p className="text-xs text-gray-500">
                Angemeldet als <strong>{voter.name}</strong> (über rsvp-app verifiziert)
              </p>
            )}
            {voter?.kind === 'LINK' && (
              <p className="text-xs text-gray-500">
                {voter.secret
                  ? 'Geheime Wahl: Gespeichert wird nur, dass du abgestimmt hast - nicht, wofür. Mit deinem Link kannst du deine Auswahl ändern.'
                  : <>Persönlicher Link für <strong>{voter.name}</strong> - bitte nicht weitergeben.</>}
              </p>
            )}
            {voter?.kind === 'EMAIL' && (
              <p className="text-xs text-gray-500">
                Du stimmst mit deiner bestätigten Adresse ab: <strong>{voter.name}</strong> ·{' '}
                <button type="submit" form="forget-email" className="underline">andere Adresse verwenden</button>
              </p>
            )}
            {voter?.kind === 'ACCOUNT' && (
              <p className="text-xs text-gray-500">
                Du stimmst mit deinem Konto ab: <strong>{voter.name}</strong>
              </p>
            )}
            {namesVisible && (
              // Die Datenschutzerklärung (Punkt 4) verweist auf diesen Hinweis.
              <p className="text-xs text-gray-500">
                {poll.showVoterNames && poll.resultsVisibility !== 'MANAGERS'
                  ? 'Hinweis: Wer abstimmt, wird auf dieser Seite namentlich bei der gewählten Option angezeigt.'
                  : 'Hinweis: Wer die Abstimmung verwaltet, sieht, wofür du gestimmt hast. Öffentlich bleibt das Ergebnis anonym.'}
              </p>
            )}
            {poll.maxVoters !== null && !hasVoted && (
              <p className="text-xs text-gray-500">Noch {poll.maxVoters - distinctVoters} von {poll.maxVoters} Plätzen frei.</p>
            )}
            {asksForName && (
              <div>
                <label htmlFor="voter-name" className="block text-sm font-medium text-gray-800 mb-1">Dein Name</label>
                <input
                  id="voter-name" name="voterName" required maxLength={60} autoComplete="name"
                  defaultValue={myVoteRows[0]?.voterName ?? ''}
                  className="w-full border border-gray-300 p-2 rounded text-gray-900"
                />
              </div>
            )}
            {poll.pollType === 'CHOICE' && poll.allowMultipleChoices && (
              <p className="text-xs text-gray-500">{choiceHint(limits, poll.options.length)}</p>
            )}
            {poll.pollType !== 'CHOICE' && (
              <p className="text-xs text-gray-500">{POLL_TYPE_LABELS[poll.pollType].title}: {POLL_TYPE_LABELS[poll.pollType].text}</p>
            )}
            <BallotInputs
              pollType={poll.pollType}
              allowMultipleChoices={poll.allowMultipleChoices}
              pointsBudget={poll.pointsBudget}
              options={poll.options}
              myVotes={myVotes}
            />
            <SubmitButton>{hasVoted ? 'Auswahl speichern' : 'Abstimmen'}</SubmitButton>
          </form>
        )}

        {poll.allowVoterOptions && !isClosed && !block && (
          <form action={suggestOption} className="bg-white p-6 rounded-lg shadow space-y-3">
            <input type="hidden" name="pollId" value={poll.id} />
            {identityInputs}
            <h2 className="font-bold text-gray-900">Option vorschlagen</h2>
            {poll.voterOptionsNeedApproval && (
              <p className="text-xs text-gray-500">Vorschläge erscheinen erst, wenn die Verwaltung sie freigegeben hat.</p>
            )}
            <div className="flex gap-2">
              <label htmlFor="suggestion" className="sr-only">Neue Option</label>
              <input
                id="suggestion" name="suggestion" type={inputTypeFor(poll.optionKind)} required maxLength={200}
                placeholder={poll.optionKind === 'TEXT' ? 'Neue Option' : undefined}
                className="flex-1 border border-gray-300 p-2 rounded text-gray-900"
              />
              <button type="submit" className="bg-blue-600 text-white text-sm font-bold px-4 rounded hover:bg-blue-700 transition">
                Vorschlagen
              </button>
            </div>
          </form>
        )}

        {voter?.kind === 'EMAIL' && (
          // Eigenes Formular außerhalb des Abstimmformulars (Formulare dürfen nicht verschachtelt
          // sein); der Knopf im Abstimmformular zeigt per form-Attribut hierher.
          <form id="forget-email" action={forgetVoteEmail} className="hidden">
            <input type="hidden" name="pollId" value={poll.id} />
          </form>
        )}

        {showResults ? (
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="font-bold text-gray-900 mb-4">
              Live-Ergebnis ({distinctVoters} Person{distinctVoters === 1 ? '' : 'en'})
            </h2>
            <PollResults
              result={result}
              names={poll.showVoterNames ? await loadVoterNames(poll.id) : undefined}
              myVotes={myVotes}
              showVoterNames={poll.showVoterNames}
              closed={isClosed}
            />
          </div>
        ) : (
          <div className="bg-white p-6 rounded-lg shadow text-sm text-gray-600">
            <h2 className="font-bold text-gray-900 mb-2">Ergebnis</h2>
            <p>
              {poll.resultsVisibility === 'AFTER_VOTE' && 'Das Ergebnis siehst du, sobald du abgestimmt hast.'}
              {poll.resultsVisibility === 'AFTER_CLOSE' && 'Das Ergebnis wird nach dem Ende der Abstimmung angezeigt.'}
              {poll.resultsVisibility === 'MANAGERS' && 'Das Ergebnis sieht nur, wer die Abstimmung verwaltet.'}
              {' '}Bisher {distinctVoters === 1 ? 'hat 1 Person' : `haben ${distinctVoters} Personen`} abgestimmt.
            </p>
          </div>
        )}

        <p className="text-center text-xs text-gray-400">
          <Link href="/" className="hover:underline">Zur Startseite</Link>
        </p>
      </div>
    </main>
  )
}

/** "Wähle 1 bis 3 Optionen." - Hinweis zur Mehrfachauswahl passend zu den Grenzen (siehe choiceLimits). */
function choiceHint({ min, max }: { min: number; max: number }, count: number): string {
  if (min <= 1 && max >= count) return 'Mehrere Optionen wählbar.'
  if (min === max) return `Wähle genau ${min} Option${min === 1 ? '' : 'en'}.`
  if (min <= 1) return `Wähle bis zu ${max} Optionen.`
  if (max >= count) return `Wähle mindestens ${min} Optionen.`
  return `Wähle ${min} bis ${max} Optionen.`
}
