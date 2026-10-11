import { redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { isMailConfigured } from '../../../lib/mail'
import { manageUrl } from '../../../lib/manage'
import Notice from '../../../ui/notice'
import PollFrame, { loadManagedPoll } from '../poll-frame'
import VoterLinksPanel from '../voter-links-panel'

export const dynamic = 'force-dynamic'

/** Reiter "Stimmlinks" (nur im Modus LINK): ausstellen, verteilen, Beteiligung - siehe voter-links-panel.tsx. */
export default async function StimmlinksPage({
  params,
  searchParams
}: {
  params: Promise<{ pollId: string }>
  searchParams: Promise<{ token?: string; created?: string }>
}) {
  const { pollId } = await params
  const { token, created } = await searchParams
  const loaded = await loadManagedPoll(pollId, token, 'stimmlinks')
  const { poll, legacyToken } = loaded
  if (poll.voterIdentity !== 'LINK') redirect(manageUrl(poll.id, legacyToken))

  const links = await prisma.voterLink.findMany({
    where: { pollId: poll.id },
    select: { id: true, label: true, email: true, hasVoted: true },
    orderBy: { createdAt: 'asc' }
  })

  return (
    <PollFrame loaded={loaded}>
      <div className="space-y-6">
        {created === '1' && <Notice tone="success">Abstimmung erstellt! Stelle jetzt für jede Person einen eigenen Stimmlink aus.</Notice>}
        <VoterLinksPanel
          pollId={poll.id}
          legacyToken={legacyToken}
          links={links}
          secretBallot={poll.secretBallot}
          mailConfigured={isMailConfigured()}
        />
      </div>
    </PollFrame>
  )
}
