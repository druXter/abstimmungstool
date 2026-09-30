// app/[pollId]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '../lib/prisma'
import { castVote } from '../actions'
import { resolveVoter } from '../lib/voter-identity'
import SubmitButton from '../ui/submit-button'
import PollResults from './poll-results'

export const dynamic = 'force-dynamic'

export default async function PollPage({
  params,
  searchParams
}: {
  params: Promise<{ pollId: string }>
  searchParams: Promise<{ verify?: string }>
}) {
  const { pollId } = await params
  const { verify } = await searchParams

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

  // Zähler für die Prozent-Basis in PollResults - siehe dort für die Begründung,
  // warum das die Anzahl abstimmender PERSONEN ist, nicht die Summe der Options-Stimmen.
  const distinctVoters = new Set(poll.votes.map(v => v.voterKey)).size
  const isClosed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < new Date())

  // Wer hier abstimmt (und ob überhaupt), entscheidet allein resolveVoter anhand von
  // poll.voterIdentity - siehe app/lib/voter-identity.ts.
  const { voter, block } = await resolveVoter(poll, { verifyToken: verify }, { create: false })
  const myVoteOptionIds = voter
    ? (await prisma.vote.findMany({ where: { pollId: poll.id, voterKey: voter.key }, select: { optionId: true } })).map(v => v.optionId)
    : []

  const canVote = !isClosed && !block
  const hasVoted = myVoteOptionIds.length > 0

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

        {!isClosed && block === 'rsvp-missing' && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-sm">
            Diese Abstimmung ist nur über den entsprechenden Link/Button in rsvp-app erreichbar,
            damit jede Person nur einmal abstimmen kann. Ein direkter, anonymer Aufruf dieser Seite
            kann hier bewusst nicht abstimmen.
          </div>
        )}

        {!isClosed && block === 'rsvp-declined' && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-sm">
            Du hast für den zugehörigen Termin abgesagt und kannst daher hier nicht (mehr) abstimmen.
            Sag erneut zu, um wieder abstimmen zu können.
          </div>
        )}

        {!isClosed && block === 'unavailable' && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-sm">
            Für diese Abstimmung ist eine Art der Stimmabgabe eingestellt, die dieses Tool noch nicht anbietet.
            Bitte wende dich an die Person, die die Abstimmung verwaltet.
          </div>
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
            {poll.voterIdentity !== 'COOKIE' && (
              // Die Datenschutzerklärung (Punkt 4) verweist auf diesen Hinweis.
              <p className="text-xs text-gray-500">
                {poll.showVoterNames
                  ? 'Hinweis: Wer abstimmt, wird auf dieser Seite namentlich bei der gewählten Option angezeigt.'
                  : 'Hinweis: Wer die Abstimmung verwaltet, sieht, wofür du gestimmt hast. Öffentlich bleibt das Ergebnis anonym.'}
              </p>
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
