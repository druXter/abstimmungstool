// app/meine-abstimmungen/page.tsx
import Link from 'next/link'
import { prisma } from '../lib/prisma'
import { requireUser } from '../lib/auth'
import { canCreatePolls } from '../lib/permissions'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  title: string
  createdAt: Date
  closedAt: Date | null
  closesAt: Date | null
  ownerId: string | null
  owner: { email: string } | null
}

function PollList({ title, polls, showOwner }: { title: string; polls: Row[]; showOwner?: boolean }) {
  if (polls.length === 0) return null
  const now = new Date()

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="font-bold mb-3">{title}</h2>
      <ul className="divide-y">
        {polls.map(poll => {
          const closed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < now)
          return (
            <li key={poll.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/${poll.id}/verwalten`} className="font-medium text-blue-700 hover:underline truncate block">
                  {poll.title}
                </Link>
                <div className="text-xs text-gray-500">
                  {poll.createdAt.toLocaleDateString('de-DE')}
                  {showOwner && ` · ${poll.owner ? `von ${poll.owner.email}` : 'Alt-Abstimmung ohne Konto'}`}
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${closed ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-800'}`}>
                {closed ? 'geschlossen' : 'offen'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default async function MeineAbstimmungenPage() {
  const user = await requireUser('/meine-abstimmungen')
  const isAdmin = user.role === 'ADMIN'

  // Admins sehen ALLE Abstimmungen (inkl. Alt-Abstimmungen ohne Konto), alle anderen nur
  // eigene und ihnen freigegebene - dieselbe Regel wie getPollLevel, hier nur als Abfrage.
  const polls: Row[] = await prisma.poll.findMany({
    where: isAdmin ? {} : { OR: [{ ownerId: user.id }, { access: { some: { userId: user.id } } }] },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, title: true, createdAt: true, closedAt: true, closesAt: true, ownerId: true,
      owner: { select: { email: true } }
    }
  })

  const mine = polls.filter(p => p.ownerId === user.id)
  const others = polls.filter(p => p.ownerId !== user.id)

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6 text-gray-900">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Meine Abstimmungen</h1>
          {canCreatePolls(user) && (
            <Link href="/erstellen" className="bg-blue-600 text-white text-sm font-bold py-2 px-4 rounded hover:bg-blue-700 transition">
              Neue Abstimmung
            </Link>
          )}
        </div>

        {polls.length === 0 && (
          <div className="bg-white p-6 rounded-lg shadow text-sm text-gray-600">
            {canCreatePolls(user)
              ? 'Du hast noch keine Abstimmung angelegt.'
              : 'Dir wurde noch keine Abstimmung zum Moderieren freigegeben.'}
          </div>
        )}

        <PollList title="Von mir" polls={mine} />
        <PollList title={isAdmin ? 'Alle anderen (Administrator-Ansicht)' : 'Mit mir geteilt'} polls={others} showOwner />
      </div>
    </main>
  )
}
