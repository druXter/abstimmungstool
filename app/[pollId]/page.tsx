// app/[pollId]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '../lib/prisma'
import { castVote, getMyVote } from '../actions'
import SubmitButton from '../ui/submit-button'
import PollResults from './poll-results'

export const dynamic = 'force-dynamic'

export default async function PollPage({
  params
}: {
  params: Promise<{ pollId: string }>
}) {
  const { pollId } = await params

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
  const myVote = await getMyVote(poll.id)

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

        {!isClosed && (
          <form action={castVote} className="bg-white p-6 rounded-lg shadow space-y-3">
            <input type="hidden" name="pollId" value={poll.id} />
            <h2 className="font-bold text-gray-900 mb-2">
              {myVote ? 'Deine Stimme ändern' : 'Jetzt abstimmen'}
            </h2>
            {poll.options.map(option => (
              <label
                key={option.id}
                className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="radio"
                  name="optionId"
                  value={option.id}
                  defaultChecked={myVote === option.id}
                  required
                  className="w-4 h-4"
                />
                <span className="text-gray-800">{option.label}</span>
              </label>
            ))}
            <SubmitButton>{myVote ? 'Stimme ändern' : 'Abstimmen'}</SubmitButton>
          </form>
        )}

        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="font-bold text-gray-900 mb-4">
            Live-Ergebnis ({totalVotes} Stimme{totalVotes === 1 ? '' : 'n'})
          </h2>
          <PollResults options={poll.options} totalVotes={totalVotes} myVoteOptionId={myVote} />
        </div>

        <p className="text-center text-xs text-gray-400">
          <Link href="/" className="hover:underline">Zur Startseite</Link>
        </p>
      </div>
    </main>
  )
}
