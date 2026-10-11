// app/meine-abstimmungen/page.tsx
import { prisma } from '../lib/prisma'
import { requireUser } from '../lib/auth'
import { canCreatePolls } from '../lib/permissions'
import { POLL_TYPE_LABELS } from '../lib/poll-types'
import { IDENTITY_SHORT, pollStatus } from '../lib/poll-status'
import { ButtonLink, EmptyState, Main, PageHeader, sectionTitleClass } from '../ui/kit'
import PollRow, { type RowData } from './poll-row'

export const dynamic = 'force-dynamic'

const LIVE_PHASE = { LOBBY: 'Lobby', QUESTION: 'läuft', REVEAL: 'läuft', LEADERBOARD: 'läuft', FINISHED: 'beendet' } as const

/**
 * Übersicht der Verwaltung (docs/KONZEPT-OBERFLAECHE.md, wie die Event-Übersicht in rsvp-app): Abstimmungen und
 * Live-Runden als kompakte Liste - "Aktuell" (was zu tun ist zuerst) und eingeklappt "Beendet". Admins sehen alle
 * Konten (inkl. Alt-Abstimmungen ohne Konto), alle anderen nur eigene und ihnen freigegebene - dieselbe Regel wie
 * getPollLevel/getLiveLevel, hier nur als Abfrage.
 */
export default async function MeineAbstimmungenPage() {
  const user = await requireUser('/meine-abstimmungen')
  const isAdmin = user.role === 'ADMIN'
  const visible = isAdmin ? {} : { OR: [{ ownerId: user.id }, { access: { some: { userId: user.id } } }] }

  const [polls, liveSessions] = await Promise.all([
    prisma.poll.findMany({
      where: visible,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, createdAt: true, closedAt: true, closesAt: true, ownerId: true, pollType: true, optionKind: true,
        voterIdentity: true, confirmDate: true, finalizedAt: true,
        owner: { select: { email: true } },
        _count: { select: { options: { where: { approved: false } }, voterLinks: true } }
      }
    }),
    // Live-Runden (app/lib/live.ts): eigene und geteilte (LiveAccess), Admins sehen alle.
    prisma.liveSession.findMany({
      where: visible,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, createdAt: true, phase: true, ownerId: true, owner: { select: { email: true } },
        _count: { select: { players: true, questions: true } }
      }
    })
  ])

  // Teilnehmende = verschiedene voterKeys pro Abstimmung (wie loadResult), abgegebene Stimmlinks dazu.
  const pollIds = polls.map(p => p.id)
  const [voterKeys, votedLinks] = pollIds.length > 0
    ? await Promise.all([
        prisma.vote.groupBy({ by: ['pollId', 'voterKey'], where: { pollId: { in: pollIds } } }),
        prisma.voterLink.groupBy({ by: ['pollId'], where: { pollId: { in: pollIds }, hasVoted: true }, _count: { _all: true } })
      ])
    : [[], []]
  const voters = new Map<string, number>()
  for (const v of voterKeys) voters.set(v.pollId, (voters.get(v.pollId) ?? 0) + 1)
  const voted = new Map(votedLinks.map(v => [v.pollId, v._count._all]))

  const owner = (ownerId: string | null, email: string | undefined) =>
    ownerId === user.id ? null : ownerId ? (isAdmin ? email ?? null : `von ${email}`) : 'Alt-Abstimmung ohne Konto'
  const shared = (ownerId: string | null, email: string | undefined) =>
    !isAdmin && ownerId !== user.id ? [{ label: 'freigegeben', tone: 'teal' as const, title: `freigegeben von ${email}` }] : []

  const rows: { row: RowData; ended: boolean }[] = [
    ...polls.map(poll => {
      const status = pollStatus(poll)
      const count = voters.get(poll.id) ?? 0
      const decide = poll.confirmDate && poll.optionKind !== 'TEXT' && !!poll.closedAt && !poll.finalizedAt && count > 0
      const pending = poll._count.options
      const badges: RowData['badges'] = [
        ...(decide ? [{ label: 'Termin festlegen', tone: 'amber' as const }] : []),
        ...(pending > 0 ? [{ label: `${pending} Vorschl${pending === 1 ? 'ag' : 'äge'} offen`, tone: 'amber' as const }] : []),
        ...(poll.voterIdentity === 'LINK' && poll._count.voterLinks > 0 ? [{ label: `${voted.get(poll.id) ?? 0}/${poll._count.voterLinks} Stimmlinks`, tone: 'indigo' as const }] : []),
        ...shared(poll.ownerId, poll.owner?.email)
      ]
      const line = [
        `${POLL_TYPE_LABELS[poll.pollType].title}${poll.optionKind !== 'TEXT' ? ' über Termine' : ''}`,
        IDENTITY_SHORT[poll.voterIdentity],
        status.text,
        owner(poll.ownerId, poll.owner?.email)
      ].filter(Boolean).join(' · ')
      return {
        ended: status.state !== 'open' && !decide && pending === 0,
        row: {
          kind: 'poll' as const, id: poll.id, href: `/${poll.id}/verwalten`, title: poll.title,
          count, countLabel: count === 1 ? 'Person' : 'Pers.', status: { label: status.badge, tone: status.tone },
          badges, line, attention: decide || pending > 0, sortDate: poll.createdAt
        }
      }
    }),
    ...liveSessions.map(live => ({
      ended: live.phase === 'FINISHED',
      row: {
        kind: 'live' as const, id: live.id, href: `/live/${live.id}/verwalten`, title: live.title,
        count: live._count.players, countLabel: 'Spielende',
        status: { label: `Live · ${LIVE_PHASE[live.phase]}`, tone: live.phase === 'FINISHED' ? 'gray' as const : 'purple' as const },
        badges: shared(live.ownerId, live.owner.email),
        line: [`Live-Runde mit ${live._count.questions} Frage${live._count.questions === 1 ? '' : 'n'}`, `angelegt am ${live.createdAt.toLocaleDateString('de-DE')}`, owner(live.ownerId, live.owner.email)].filter(Boolean).join(' · '),
        attention: false, sortDate: live.createdAt
      }
    }))
  ]
  const byDate = (a: RowData, b: RowData) => b.sortDate.getTime() - a.sortDate.getTime()
  const current = rows.filter(r => !r.ended).map(r => r.row).sort((a, b) => Number(b.attention) - Number(a.attention) || byDate(a, b))
  const ended = rows.filter(r => r.ended).map(r => r.row).sort(byDate)
  const mayCreate = canCreatePolls(user)

  return (
    <Main>
      <PageHeader
        title="Abstimmungen"
        subtitle={isAdmin ? 'Alle Abstimmungen und Live-Runden aller Konten' : !mayCreate ? 'Für dich freigegebene Abstimmungen und Live-Runden' : undefined}
        actions={mayCreate && (
          <>
            <ButtonLink href="/live/neu">+ Neue Live-Runde</ButtonLink>
            <ButtonLink href="/erstellen" variant="primary">+ Neue Abstimmung</ButtonLink>
          </>
        )}
      />

      {rows.length === 0 && (
        <EmptyState>
          {mayCreate
            ? 'Du hast noch keine Abstimmung angelegt. Leg mit „+ Neue Abstimmung“ die erste an.'
            : 'Dir wurde noch keine Abstimmung zum Moderieren freigegeben.'}
        </EmptyState>
      )}

      {current.length > 0 && (
        <section className="mb-8" aria-labelledby="aktuell">
          <h2 id="aktuell" className={sectionTitleClass}>Aktuell</h2>
          <div className="grid gap-3">{current.map(r => <PollRow key={r.id} row={r} />)}</div>
        </section>
      )}

      {ended.length > 0 && (
        <details className="group" data-testid="ended-polls">
          <summary className={`${sectionTitleClass} cursor-pointer list-none`}>
            <span className="inline-block transition group-open:rotate-90">▸</span> Beendet ({ended.length})
          </summary>
          <div className="grid gap-3">{ended.map(r => <PollRow key={r.id} row={r} muted />)}</div>
        </details>
      )}
    </Main>
  )
}
