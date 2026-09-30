// app/[pollId]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '../lib/prisma'
import { castVote, unlockPoll } from '../actions'
import { resolveVoter } from '../lib/voter-identity'
import { hasPollAccess, MAX_ACCESS_CODE_LENGTH } from '../lib/access-code'
import SubmitButton from '../ui/submit-button'
import Notice from '../ui/notice'
import PollResults from './poll-results'

export const dynamic = 'force-dynamic'

// Rückmeldungen der Server Actions (?hinweis=..., siehe pollUrl in app/actions.ts). Nur
// feste Texte - ein unbekannter Wert zeigt nichts an.
const NOTICES: Record<string, string> = {
  gedrosselt: 'Von deinem Netzwerk aus haben in der letzten Stunde sehr viele neue Personen abgestimmt. Bitte versuche es später noch einmal.',
  voll: 'Die Höchstzahl an Teilnehmenden ist inzwischen erreicht - deine Stimme wurde nicht gezählt.',
  'code-falsch': 'Der Zugangscode stimmt nicht.',
  'code-gesperrt': 'Zu viele Versuche. Bitte warte eine Viertelstunde und versuche es dann erneut.'
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-sm">{children}</div>
}

export default async function PollPage({
  params,
  searchParams
}: {
  params: Promise<{ pollId: string }>
  searchParams: Promise<{ verify?: string; hinweis?: string; code?: string }>
}) {
  const { pollId } = await params
  const { verify, hinweis, code } = await searchParams
  const notice = hinweis && Object.hasOwn(NOTICES, hinweis) ? NOTICES[hinweis] : null

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      options: {
        orderBy: { position: 'asc' },
        include: {
          _count: { select: { votes: true } },
          votes: { select: { voterName: true } }
        }
      },
      votes: { select: { voterKey: true } }
    }
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
          {notice && <Notice tone="error">{notice}</Notice>}
          <input type="hidden" name="pollId" value={poll.id} />
          {verify && <input type="hidden" name="verifyToken" value={verify} />}
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

  // Zähler für die Prozent-Basis in PollResults - siehe dort für die Begründung,
  // warum das die Anzahl abstimmender PERSONEN ist, nicht die Summe der Options-Stimmen.
  const distinctVoters = new Set(poll.votes.map(v => v.voterKey)).size
  const isClosed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < new Date())

  // Wer hier abstimmt (und ob überhaupt), entscheidet allein resolveVoter anhand von
  // poll.voterIdentity - siehe app/lib/voter-identity.ts.
  const { voter, block } = await resolveVoter(poll, { verifyToken: verify }, { create: false })
  const myVotes = voter
    ? await prisma.vote.findMany({ where: { pollId: poll.id, voterKey: voter.key }, select: { optionId: true, voterName: true } })
    : []
  const myVoteOptionIds = myVotes.map(v => v.optionId)
  const hasVoted = myVoteOptionIds.length > 0

  // Wer schon abgestimmt hat, darf trotz erreichter Höchstzahl weiter ändern.
  const isFull = poll.maxVoters !== null && distinctVoters >= poll.maxVoters && !hasVoted
  const canVote = !isClosed && !block && !isFull
  const asksForName = poll.voterIdentity === 'COOKIE' && poll.requireVoterName
  const namesVisible = poll.voterIdentity !== 'COOKIE' || asksForName

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
        </div>

        {notice && <Notice tone="warning">{notice}</Notice>}

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

        {!isClosed && block === 'unavailable' && (
          <Hint>
            Für diese Abstimmung ist eine Art der Stimmabgabe eingestellt, die dieses Tool noch nicht anbietet.
            Bitte wende dich an die Person, die die Abstimmung verwaltet.
          </Hint>
        )}

        {!isClosed && !block && isFull && (
          <Hint>Die Höchstzahl von {poll.maxVoters} Teilnehmenden ist erreicht - hier kann niemand mehr neu abstimmen.</Hint>
        )}

        {canVote && (
          <form action={castVote} className="bg-white p-6 rounded-lg shadow space-y-3">
            <input type="hidden" name="pollId" value={poll.id} />
            {verify && <input type="hidden" name="verifyToken" value={verify} />}
            <h2 className="font-bold text-gray-900 mb-2">
              {hasVoted ? 'Deine Auswahl ändern' : 'Jetzt abstimmen'}
            </h2>
            {voter?.kind === 'RSVP' && (
              <p className="text-xs text-gray-500">
                Angemeldet als <strong>{voter.name}</strong> (über rsvp-app verifiziert)
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
                {poll.showVoterNames
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
                  defaultValue={myVotes[0]?.voterName ?? ''}
                  className="w-full border border-gray-300 p-2 rounded text-gray-900"
                />
              </div>
            )}
            {poll.allowMultipleChoices && (
              <p className="text-xs text-gray-500">Mehrere Optionen wählbar.</p>
            )}
            {poll.options.map(option => (
              <label
                key={option.id}
                className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type={poll.allowMultipleChoices ? 'checkbox' : 'radio'}
                  name="optionId"
                  value={option.id}
                  defaultChecked={myVoteOptionIds.includes(option.id)}
                  required={!poll.allowMultipleChoices}
                  className="w-4 h-4"
                />
                <span className="text-gray-800">{option.label}</span>
              </label>
            ))}
            <SubmitButton>{hasVoted ? 'Auswahl speichern' : 'Abstimmen'}</SubmitButton>
          </form>
        )}

        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="font-bold text-gray-900 mb-4">
            Live-Ergebnis ({distinctVoters} Person{distinctVoters === 1 ? '' : 'en'})
          </h2>
          <PollResults
            options={poll.options}
            distinctVoters={distinctVoters}
            myVoteOptionIds={myVoteOptionIds}
            showVoterNames={poll.showVoterNames}
          />
        </div>

        <p className="text-center text-xs text-gray-400">
          <Link href="/" className="hover:underline">Zur Startseite</Link>
        </p>
      </div>
    </main>
  )
}
