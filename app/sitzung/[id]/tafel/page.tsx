// app/sitzung/[id]/tafel/page.tsx
import { timingSafeEqual } from 'node:crypto'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { loadResult, loadVoterNames } from '../../../lib/results'
import { OUTCOME_LABEL, verdictFor } from '../../../lib/majority'
import VerdictLine from '../../verdict'
import { fetchRoster } from '../../../lib/assembly-coupling'
import { quorumState, speakerOrder } from '../../../lib/assembly'
import { agendaClock, fetchAgenda } from '../../../lib/timeline'
import LiveRefresh from '../../live-refresh'
import Clock from './clock'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Tafel', robots: { index: false, follow: false } }

/** Höchstens so viele Punkte, Wortmeldungen und frühere Ergebnisse - die Tafel soll ohne Scrollen auskommen. */
const AGENDA_AHEAD = 4
const SPEAKERS_SHOWN = 6
const EARLIER_RESULTS = 3

function keyMatches(stored: string | null, given: string | string[] | undefined): boolean {
  if (!stored || typeof given !== 'string') return false
  const a = Buffer.from(stored)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Tafel einer Sitzung (docs/KONZEPT-SITZUNG.md Abschnitt 7) für Beamer, Gästemonitor und Gäste ohne Stimmrecht: nur mit
 * dem Tafel-Link (?k=…, Assembly.boardKey), ohne Anmeldung. Zeigt, was auch Mitglieder sehen: Tagesordnung aus dem
 * Zeitplan, Beschlussfähigkeit, laufende Abstimmungen mit der Zahl der Stimmen (kein Zwischenstand), Ergebnisse nach
 * dem Schließen - bei namentlichen Abstimmungen mit Namen - und die Rednerliste. Aktualisiert sich selbst.
 */
export default async function AssemblyBoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string | string[] }> }) {
  const { id } = await params
  const { k } = await searchParams
  const assembly = await prisma.assembly.findUnique({
    where: { id },
    include: {
      polls: { orderBy: { closedAt: 'desc' }, select: { id: true, title: true, closedAt: true, createdAt: true, secretBallot: true, assemblyPresent: true, assemblyQuorumMet: true, assemblyMajority: true, assemblyMembers: true } },
      speakers: { where: { doneAt: null }, include: { member: { select: { name: true } } } }
    }
  })
  if (!assembly || !keyMatches(assembly.boardKey, k)) notFound()

  const [roster, agenda] = await Promise.all([fetchRoster(assembly), fetchAgenda(assembly.timelineUrl)])
  const quorum = quorumState(assembly, roster)
  const open = assembly.polls.filter(p => !p.closedAt).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const closed = assembly.polls.filter(p => p.closedAt).slice(0, 1 + EARLIER_RESULTS)
  const voterCounts = new Map((await prisma.vote.groupBy({ by: ['pollId', 'voterKey'], where: { pollId: { in: open.map(p => p.id) } } }))
    .reduce((m, v) => m.set(v.pollId, (m.get(v.pollId) ?? 0) + 1), new Map<string, number>()))
  const results = await Promise.all(closed.map(async (poll, index) => ({
    poll, result: await loadResult(poll.id), names: poll.secretBallot || index > 0 ? {} : await loadVoterNames(poll.id)
  })))
  const [latest, ...earlier] = results.filter(r => r.result)
  const speakers = speakerOrder(assembly.speakers).slice(0, SPEAKERS_SHOWN)
  const nowIndex = agenda ? agenda.items.findIndex(i => i.status === 'now') : -1
  const firstOpen = agenda ? agenda.items.findIndex(i => i.status === 'now' || i.status === 'upcoming') : -1
  const agendaShown = agenda && firstOpen >= 0 ? agenda.items.slice(firstOpen, firstOpen + 1 + AGENDA_AHEAD) : []

  return (
    <div data-board className="fixed inset-0 z-50 overflow-y-auto bg-slate-950 text-white">
      <LiveRefresh assemblyId={assembly.id} version={assembly.version} everySeconds={10} />
      <div className="mx-auto flex min-h-full max-w-[110rem] flex-col gap-[2.5vh] px-[3vw] py-[3vh] text-[clamp(1rem,1.5vw,2rem)]">
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="truncate text-[clamp(1.5rem,3vw,3.5rem)] font-bold leading-tight">{assembly.title}</h1>
            {quorum.present !== null && (
              <p className="text-slate-300" data-testid="board-quorum">
                <strong className="tabular-nums text-white">{quorum.present}</strong> anwesend
                {quorum.quorum !== null && (
                  <> · {quorum.met ? <span className="font-semibold text-green-400">beschlussfähig</span> : <span className="font-semibold text-red-400">nicht beschlussfähig</span>} (ab {quorum.quorum})</>
                )}
              </p>
            )}
            {assembly.closedAt && <p className="text-amber-300">Die Sitzung ist beendet.</p>}
          </div>
          <Clock />
        </header>

        {agenda?.announcement && <p className="rounded-xl bg-amber-400 px-[2vw] py-[1.5vh] font-semibold text-slate-950">📣 {agenda.announcement}</p>}

        <div className="grid grow gap-[2.5vw] lg:grid-cols-5">
          <div className="space-y-[3vh] lg:col-span-2">
            {agenda && (
              <section aria-labelledby="board-agenda">
                <h2 id="board-agenda" className="mb-[1vh] text-[0.8em] font-bold uppercase tracking-wide text-sky-300">Tagesordnung</h2>
                {agendaShown.length === 0 ? <p className="text-slate-300">{agenda.items.length ? 'Alle Punkte sind erledigt.' : 'Die Tagesordnung folgt.'}</p> : (
                  <ol className="space-y-[1vh]" data-testid="board-agenda">
                    {agendaShown.map(item => {
                      const isNow = agenda.items.indexOf(item) === nowIndex
                      return (
                        <li key={item.id} className={`flex items-baseline gap-[1.5vw] rounded-lg ${isNow ? 'bg-slate-800 px-[1vw] py-[1vh] text-[1.25em] font-bold' : 'text-slate-200'} ${item.status === 'cancelled' ? 'line-through text-slate-500' : ''}`}>
                          <span className="shrink-0 tabular-nums">{item.approximate ? '~' : ''}{agendaClock(item.start, agenda.timezone)}</span>
                          <span className="min-w-0">{item.title}{isNow && <span className="ml-3 text-[0.6em] uppercase tracking-wide text-sky-300">jetzt</span>}</span>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>
            )}

            {assembly.speakerList && (
              <section aria-labelledby="board-speakers">
                <h2 id="board-speakers" className="mb-[1vh] text-[0.8em] font-bold uppercase tracking-wide text-sky-300">Rednerliste</h2>
                {speakers.length === 0 ? <p className="text-slate-400">Niemand auf der Liste.</p> : (
                  <ol className="space-y-[0.8vh]" data-testid="board-speakers">
                    {speakers.map(s => (
                      <li key={s.id} className={s.calledAt ? 'text-[1.2em] font-bold text-green-400' : 'text-slate-200'}>
                        {s.calledAt ? '🎤 ' : ''}{s.member.name}{s.kind === 'GO' ? <span className="text-[0.75em] text-amber-300"> GO-Antrag</span> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
          </div>

          <div className="space-y-[3vh] lg:col-span-3">
            {open.length > 0 && (
              <section aria-labelledby="board-open" className="space-y-[1.5vh]">
                <h2 id="board-open" className="text-[0.8em] font-bold uppercase tracking-wide text-sky-300">Abstimmung läuft</h2>
                {open.map(poll => {
                  const votes = voterCounts.get(poll.id) ?? 0
                  return (
                    <div key={poll.id} className="rounded-xl bg-slate-800 px-[2vw] py-[2vh]" data-testid="board-open">
                      <p className="text-[1.4em] font-bold leading-tight">{poll.title}</p>
                      <p className="mt-[0.5vh] text-slate-300">
                        <strong className="tabular-nums text-white">{votes}</strong>{quorum.present !== null ? ` von ${quorum.present}` : ''} abgestimmt · {poll.secretBallot ? 'geheim' : 'namentlich'}
                      </p>
                      {quorum.present ? (
                        <div className="mt-[1vh] h-[1.2vh] min-h-2 overflow-hidden rounded-full bg-slate-700" aria-hidden>
                          <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.min(100, Math.round((votes / quorum.present) * 100))}%` }} />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </section>
            )}

            {latest?.result && (
              <section aria-labelledby="board-result" className="space-y-[1.5vh]">
                <h2 id="board-result" className="text-[0.8em] font-bold uppercase tracking-wide text-sky-300">Ergebnis</h2>
                <div className="rounded-xl bg-slate-900 px-[2vw] py-[2vh]" data-testid="board-result">
                  <p className="text-[1.3em] font-bold leading-tight">{latest.poll.title}</p>
                  <ul className="mt-[1.5vh] space-y-[1.2vh]">
                    {latest.result.options.map(o => {
                      const share = latest.result!.voters > 0 ? Math.round((o.votes / latest.result!.voters) * 100) : 0
                      const names = latest.names[o.id]
                      return (
                        <li key={o.id}>
                          <div className="flex items-baseline justify-between gap-4">
                            <span className="font-semibold">{o.label}</span>
                            <span className="tabular-nums"><strong className="text-[1.2em]">{o.votes}</strong> <span className="text-slate-400">({share} %)</span></span>
                          </div>
                          <div className="mt-[0.5vh] h-[1.2vh] min-h-2 overflow-hidden rounded-full bg-slate-800" aria-hidden>
                            <div className="h-full rounded-full bg-sky-400" style={{ width: `${share}%` }} />
                          </div>
                          {names?.length ? <p className="mt-[0.5vh] text-[0.7em] text-slate-300">{names.map(n => n.name).join(', ')}</p> : null}
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-[1.5vh] text-[0.75em] text-slate-400">
                    {[`${latest.result.voters} abgestimmt`, latest.poll.assemblyPresent !== null ? `${latest.poll.assemblyPresent} anwesend` : null,
                      latest.poll.assemblyQuorumMet === true ? 'beschlussfähig' : latest.poll.assemblyQuorumMet === false ? 'nicht beschlussfähig' : null,
                      latest.poll.secretBallot ? 'geheim' : 'namentlich'].filter(Boolean).join(' · ')}
                  </p>
                  <VerdictLine verdict={verdictFor(latest.poll, latest.result.options)} board />
                </div>
              </section>
            )}

            {earlier.length > 0 && (
              <section aria-labelledby="board-earlier">
                <h2 id="board-earlier" className="mb-[1vh] text-[0.8em] font-bold uppercase tracking-wide text-sky-300">Frühere Ergebnisse</h2>
                <ul className="space-y-[1vh] text-[0.85em]" data-testid="board-earlier">
                  {earlier.map(({ poll, result }) => result && (
                    <li key={poll.id} className="text-slate-200">
                      <span className="font-semibold">{poll.title}:</span>{' '}
                      <span className="text-slate-300">{result.options.map(o => `${o.label} ${o.votes}`).join(' · ')}</span>
                      {(() => { const verdict = verdictFor(poll, result.options); return verdict && <span className="text-slate-300"> – {OUTCOME_LABEL[verdict.outcome]}</span> })()}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {open.length === 0 && !latest && <p className="text-slate-400">Noch keine Abstimmung.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
