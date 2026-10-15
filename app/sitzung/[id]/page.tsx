// app/sitzung/[id]/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { castVote } from '../../actions'
import { requestToSpeak, withdrawSpeak } from '../../assembly-actions'
import { resolveVoter } from '../../lib/voter-identity'
import { loadResult, loadVoterNames } from '../../lib/results'
import { fetchRoster } from '../../lib/assembly-coupling'
import { currentMember, quorumState, SPEAKER_KIND_LABEL, speakerOrder } from '../../lib/assembly'
import BallotInputs from '../../[pollId]/ballot-inputs'
import SubmitButton from '../../ui/submit-button'
import Notice from '../../ui/notice'
import { Badge, buttonClass, Main } from '../../ui/kit'
import LiveRefresh from '../live-refresh'
import QuorumLine from '../quorum-line'

export const dynamic = 'force-dynamic'

const BLOCK_TEXT: Record<string, string> = {
  'assembly-missing': 'Du bist dieser Sitzung in diesem Browser nicht beigetreten. Öffne sie über deinen Termin in rsvp-app („🗳️ Zur Sitzung“).',
  'assembly-absent': 'Abstimmen und Wortmeldungen nur für Anwesende - du bist gerade nicht eingecheckt. Lass dich am Einlass (wieder) einchecken.',
  'assembly-unreachable': 'Die Anwesenheit lässt sich gerade nicht prüfen. Bitte versuch es gleich noch einmal oder wende dich an die Sitzungsleitung.',
  'assembly-voted': 'Du hast bei dieser geheimen Abstimmung schon abgestimmt (auf einem anderen Gerät). Die Stimme lässt sich nicht mehr ändern.'
}
const NOTICES: Record<string, string> = {
  ...BLOCK_TEXT,
  'beitritt-ungueltig': 'Der Link zum Beitreten ist ungültig oder abgelaufen. Öffne die Sitzung noch einmal über deinen Termin in rsvp-app.',
  'anderer-termin': 'Diese Sitzung gehört zu einem anderen Termin. Bitte wende dich an die Sitzungsleitung.',
  auswahl: 'Bitte halte dich an die angegebene Anzahl von Optionen - deine Stimme wurde nicht gespeichert.',
  voll: 'Die Abstimmung nimmt keine weiteren Stimmen an.'
}

/**
 * Sitzung für Mitglieder (docs/KONZEPT-SITZUNG.md): Anwesenheit und Beschlussfähigkeit, die offenen Abstimmungen direkt
 * mit Stimmzettel (castVote leitet hierher zurück), die Ergebnisse geschlossener Abstimmungen und - wenn eingeschaltet -
 * die Rednerliste. Aktualisiert sich selbst (LiveRefresh). Ohne Beitritt nur Titel und Hinweis.
 */
export default async function AssemblyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hinweis?: string; abstimmung?: string }> }) {
  const { id } = await params
  const { hinweis, abstimmung } = await searchParams
  const assembly = await prisma.assembly.findUnique({
    where: { id },
    include: {
      polls: { orderBy: { createdAt: 'desc' }, include: { options: { where: { approved: true }, orderBy: { position: 'asc' }, select: { id: true, label: true } } } },
      speakers: { where: { doneAt: null }, include: { member: { select: { id: true, name: true } } } }
    }
  })
  if (!assembly) notFound()
  const member = await currentMember(assembly.id)
  const notice = hinweis && Object.hasOwn(NOTICES, hinweis) ? NOTICES[hinweis] : null

  if (!member) {
    return (
      <Main width="narrow">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{assembly.title}</h1>
        <div className="mt-4 space-y-3">
          {notice && <Notice tone="warning">{notice}</Notice>}
          <Notice>{BLOCK_TEXT['assembly-missing']}</Notice>
        </div>
      </Main>
    )
  }

  const roster = await fetchRoster(assembly)
  const quorum = quorumState(assembly, roster)
  const present = roster.state === 'ok' && roster.present.has(member.sub)
  const open = assembly.polls.filter(p => !p.closedAt)
  const closed = assembly.polls.filter(p => p.closedAt)
  const ballots = await Promise.all(open.map(async poll => {
    const { voter, block } = await resolveVoter(poll, {}, { create: false })
    const mine = voter ? await prisma.vote.findMany({ where: { pollId: poll.id, voterKey: voter.key }, select: { optionId: true, value: true } }) : []
    return { poll, block, myVotes: Object.fromEntries(mine.map(v => [v.optionId, v.value])) as Record<string, number> }
  }))
  const results = await Promise.all(closed.map(async poll => ({
    poll, result: await loadResult(poll.id), names: poll.secretBallot ? {} : await loadVoterNames(poll.id)
  })))
  const speakers = speakerOrder(assembly.speakers)
  const mySpeaks = speakers.filter(s => s.member.id === member.id)

  return (
    <Main width="narrow">
      <LiveRefresh assemblyId={assembly.id} version={assembly.version} />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{assembly.title}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Angemeldet als <strong>{member.name}</strong>
          {assembly.presenceRequired && (
            <> · {present ? <span className="text-green-700 dark:text-green-400" data-testid="member-presence">anwesend</span>
              : <span className="text-amber-700 dark:text-amber-300" data-testid="member-presence">{roster.state === 'ok' ? 'nicht eingecheckt' : 'Anwesenheit nicht prüfbar'}</span>}</>
          )}
        </p>
        <QuorumLine state={quorum} />
      </div>

      <div className="mt-6 space-y-6">
        {notice && !abstimmung && <Notice tone="warning">{notice}</Notice>}
        {assembly.closedAt && <Notice>Die Sitzung ist beendet.</Notice>}

        {ballots.length > 0 && (
          <section className="space-y-4" aria-labelledby="offen">
            <h2 id="offen" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Jetzt abstimmen</h2>
            {ballots.map(({ poll, block, myVotes }) => {
              const voted = Object.keys(myVotes).length > 0 || (poll.secretBallot && member.votedPolls.split(' ').includes(poll.id))
              return (
                <article key={poll.id} id={`abstimmung-${poll.id}`} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800" data-testid="assembly-ballot">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">{poll.title}</h3>
                    <Badge tone={poll.secretBallot ? 'indigo' : 'gray'}>{poll.secretBallot ? 'geheim' : 'namentlich'}</Badge>
                  </div>
                  {abstimmung === poll.id && notice && <div className="mt-3"><Notice tone="warning">{notice}</Notice></div>}
                  {block === 'assembly-voted'
                    ? <p className="mt-3 text-sm text-green-700 dark:text-green-400">✓ Du hast abgestimmt (auf einem anderen Gerät).</p>
                    : block
                      ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{voted ? '✓ Deine Stimme ist abgegeben. ' : ''}{BLOCK_TEXT[block] ?? 'Du kannst hier gerade nicht abstimmen.'}</p>
                      : (
                        <form action={castVote} className="mt-3 space-y-3">
                          <input type="hidden" name="pollId" value={poll.id} />
                          <BallotInputs pollType={poll.pollType} allowMultipleChoices={poll.allowMultipleChoices} pointsBudget={poll.pointsBudget} options={poll.options} myVotes={myVotes} />
                          <div className="flex flex-wrap items-center gap-3">
                            <SubmitButton>{voted ? 'Stimme ändern' : 'Abstimmen'}</SubmitButton>
                            {voted && <span className="text-sm text-green-700 dark:text-green-400">✓ Deine Stimme ist abgegeben.</span>}
                          </div>
                        </form>
                      )}
                </article>
              )
            })}
          </section>
        )}
        {ballots.length === 0 && !assembly.closedAt && (
          <p className="rounded-xl border border-dashed border-gray-300 p-5 text-center text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400">Gerade läuft keine Abstimmung. Die Seite aktualisiert sich von selbst.</p>
        )}

        {assembly.speakerList && (
          <section id="rednerliste" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800" aria-labelledby="redner">
            <h2 id="redner" className="font-semibold text-gray-900 dark:text-gray-100">Rednerliste</h2>
            {speakers.length === 0
              ? <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Niemand auf der Liste.</p>
              : (
                <ol className="mt-2 space-y-1 text-sm" data-testid="speaker-list">
                  {speakers.map(s => (
                    <li key={s.id} className={s.calledAt ? 'font-semibold text-green-700 dark:text-green-400' : 'text-gray-800 dark:text-gray-200'}>
                      {s.calledAt ? '🎤 ' : ''}{s.member.name}{s.kind === 'GO' ? ' (GO-Antrag)' : ''}{s.member.id === member.id ? ' - du' : ''}
                    </li>
                  ))}
                </ol>
              )}
            {!assembly.closedAt && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(['SPEAK', 'GO'] as const).map(kind => {
                  const mine = mySpeaks.find(s => s.kind === kind)
                  return mine ? (
                    <form key={kind} action={withdrawSpeak}>
                      <input type="hidden" name="speakerId" value={mine.id} />
                      <button type="submit" className={buttonClass('secondary', 'sm')}>{SPEAKER_KIND_LABEL[kind]} zurückziehen</button>
                    </form>
                  ) : (
                    <form key={kind} action={requestToSpeak}>
                      <input type="hidden" name="assemblyId" value={assembly.id} />
                      <input type="hidden" name="kind" value={kind} />
                      <button type="submit" className={buttonClass(kind === 'SPEAK' ? 'primary' : 'secondary', 'sm')}>{kind === 'SPEAK' ? '✋ Wortmeldung' : 'GO-Antrag'}</button>
                    </form>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {results.length > 0 && (
          <section className="space-y-3" aria-labelledby="ergebnisse">
            <h2 id="ergebnisse" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Ergebnisse</h2>
            {results.map(({ poll, result, names }) => result && (
              <article key={poll.id} id={`abstimmung-${poll.id}`} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800" data-testid="assembly-result">
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{poll.title}</h3>
                <ul className="mt-2 space-y-0.5 text-sm">
                  {result.options.map(o => (
                    <li key={o.id} className="text-gray-800 dark:text-gray-200">
                      <span className="tabular-nums font-semibold">{o.votes}</span> {o.label}
                      {names[o.id]?.length ? <span className="text-gray-500 dark:text-gray-400"> ({names[o.id].map(n => n.name).join(', ')})</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {[`${result.voters} abgestimmt`, poll.assemblyPresent !== null ? `${poll.assemblyPresent} anwesend` : null,
                    poll.assemblyQuorumMet === true ? 'beschlussfähig' : poll.assemblyQuorumMet === false ? 'nicht beschlussfähig' : null].filter(Boolean).join(' · ')}
                </p>
              </article>
            ))}
          </section>
        )}
      </div>
    </Main>
  )
}
