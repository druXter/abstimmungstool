// app/[pollId]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '../lib/prisma'
import { castVote } from '../actions'
import { getVoterToken } from '../lib/voter'
import { verifyRsvpToken } from '../lib/rsvp-verification'
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
        include: { _count: { select: { votes: true } } }
      }
    }
  })
  if (!poll) notFound()

  const totalVotes = poll.options.reduce((sum, o) => sum + o._count.votes, 0)
  const isClosed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < new Date())

  // Identität auflösen - welcher der beiden Modi gilt, entscheidet ausschließlich
  // poll.requireRsvpVerification (siehe schema.prisma), niemals die bloße Anwesenheit
  // eines ?verify=-Parameters. Für eine normale (nicht so markierte) Abstimmung wird
  // ein mitgeschickter Token also einfach ignoriert.
  let myVoteOptionId: string | null = null
  let verifiedEmail: string | null = null

  if (poll.requireRsvpVerification) {
    verifiedEmail = verifyRsvpToken(verify, poll.id)?.email ?? null
    if (verifiedEmail) {
      const vote = await prisma.vote.findUnique({
        where: { pollId_verifiedEmail: { pollId: poll.id, verifiedEmail } }
      })
      myVoteOptionId = vote?.optionId ?? null
    }
  } else {
    const voterToken = await getVoterToken()
    if (voterToken) {
      const vote = await prisma.vote.findUnique({
        where: { pollId_voterToken: { pollId: poll.id, voterToken } }
      })
      myVoteOptionId = vote?.optionId ?? null
    }
  }

  const canVote = !isClosed && (!poll.requireRsvpVerification || !!verifiedEmail)

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

        {poll.requireRsvpVerification && !isClosed && !verifiedEmail && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-sm">
            Diese Abstimmung ist nur über den entsprechenden Link/Button in rsvp-app erreichbar,
            damit jede Person nur einmal abstimmen kann. Ein direkter, anonymer Aufruf dieser Seite
            kann hier bewusst nicht abstimmen.
          </div>
        )}

        {canVote && (
          <form action={castVote} className="bg-white p-6 rounded-lg shadow space-y-3">
            <input type="hidden" name="pollId" value={poll.id} />
            {verify && <input type="hidden" name="verifyToken" value={verify} />}
            <h2 className="font-bold text-gray-900 mb-2">
              {myVoteOptionId ? 'Deine Stimme ändern' : 'Jetzt abstimmen'}
            </h2>
            {verifiedEmail && (
              <p className="text-xs text-gray-500">
                Angemeldet als <strong>{verifiedEmail}</strong> (über rsvp-app verifiziert)
              </p>
            )}
            {poll.options.map(option => (
              <label
                key={option.id}
                className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="radio"
                  name="optionId"
                  value={option.id}
                  defaultChecked={myVoteOptionId === option.id}
                  required
                  className="w-4 h-4"
                />
                <span className="text-gray-800">{option.label}</span>
              </label>
            ))}
            <SubmitButton>{myVoteOptionId ? 'Stimme ändern' : 'Abstimmen'}</SubmitButton>
          </form>
        )}

        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="font-bold text-gray-900 mb-4">
            Live-Ergebnis ({totalVotes} Stimme{totalVotes === 1 ? '' : 'n'})
          </h2>
          <PollResults options={poll.options} totalVotes={totalVotes} myVoteOptionId={myVoteOptionId} />
        </div>

        <p className="text-center text-xs text-gray-400">
          <Link href="/" className="hover:underline">Zur Startseite</Link>
        </p>
      </div>
    </main>
  )
}
