// app/[pollId]/verwalten/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '../../lib/prisma'
import { closePoll } from '../../actions'
import { baseUrl } from '../../lib/base-url'
import PollResults from '../poll-results'
import CopyableField from '../../ui/copyable-field'
import DeletePollButton from './delete-poll-button'

export const dynamic = 'force-dynamic'

export default async function VerwaltenPage({
  params,
  searchParams
}: {
  params: Promise<{ pollId: string }>
  searchParams: Promise<{ token?: string; created?: string }>
}) {
  const { pollId } = await params
  const { token, created } = await searchParams

  // Besitz des creatorToken ist die einzige Berechtigung für diese Seite - kein Login.
  if (!token) notFound()

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      options: {
        orderBy: { position: 'asc' },
        include: { _count: { select: { votes: true } } }
      },
      votes: { select: { voterToken: true, verifiedEmail: true } }
    }
  })
  if (!poll || poll.creatorToken !== token) notFound()

  // Siehe app/[pollId]/page.tsx für die Begründung, warum die Prozent-Basis in
  // PollResults die Anzahl abstimmender Personen ist, nicht die Summe der Stimmen.
  const distinctVoters = new Set(poll.votes.map(v => v.voterToken ?? v.verifiedEmail)).size
  const isClosed = !!poll.closedAt
  const publicLink = `${baseUrl()}/${poll.id}`
  const managementLink = `${baseUrl()}/${poll.id}/verwalten?token=${poll.creatorToken}`

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {created === '1' && (
          <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-lg text-sm">
            🎉 Abstimmung erstellt! Speichere diese Seite - der Verwaltungs-Link unten ist deine
            einzige Möglichkeit, sie später zu schließen oder zu löschen.
          </div>
        )}

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">{poll.title}</h1>

          <CopyableField label="Link zum Teilen (zum Abstimmen)" value={publicLink} />
          <CopyableField label="Verwaltungs-Link (nur für dich - nicht teilen!)" value={managementLink} />

          <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100">
            {!isClosed ? (
              <form action={closePoll}>
                <input type="hidden" name="pollId" value={poll.id} />
                <input type="hidden" name="creatorToken" value={poll.creatorToken} />
                <button
                  type="submit"
                  className="text-sm bg-amber-100 text-amber-800 hover:bg-amber-200 px-3 py-1.5 rounded transition"
                >
                  🔒 Abstimmung jetzt schließen
                </button>
              </form>
            ) : (
              <span className="text-sm text-gray-500 px-1 py-1.5">Abstimmung ist geschlossen.</span>
            )}
            <DeletePollButton pollId={poll.id} creatorToken={poll.creatorToken} />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="font-bold text-gray-900 mb-4">
            Ergebnis ({distinctVoters} Person{distinctVoters === 1 ? '' : 'en'})
          </h2>
          <PollResults options={poll.options} distinctVoters={distinctVoters} />
        </div>

        <p className="text-center text-xs text-gray-400">
          <Link href={`/${poll.id}`} className="hover:underline">Zur öffentlichen Abstimmungsseite</Link>
        </p>
      </div>
    </main>
  )
}
