import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { currentPlayer } from '../../lib/live-player'
import { loadView, settleQuestion } from '../../lib/live'
import Player from './player'

export const dynamic = 'force-dynamic'

/** Spielansicht der Teilnehmenden. Ohne Cookie dieser Runde geht es zum Beitritt (PIN vorausgefüllt, solange sie läuft). */
export default async function LivePlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await prisma.liveSession.findUnique({ where: { id }, select: { id: true, pin: true } })
  if (!session) notFound()

  const player = await currentPlayer(id)
  if (!player) redirect(session.pin ? `/live?pin=${session.pin}` : '/live')

  await settleQuestion(id)
  const view = await loadView(id, player.id)
  if (!view) redirect('/live')

  return (
    <div className="sm:py-6">
      <Player sessionId={id} initial={view} />
    </div>
  )
}
