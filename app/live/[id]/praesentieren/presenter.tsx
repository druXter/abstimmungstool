'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { LiveAnswerView, LiveView } from '../../../lib/live'
import { controlLiveAction, hideLiveWord, kickLivePlayer } from '../../../live-actions'
import { useCountdown, useLiveView } from '../../use-live-view'
import { ANSWER_STYLES, AnswerShape } from '../../shapes'
import QrCode from '../../../ui/qr-code'
import { EstimateLine, EstimateSummary, QuestionImage, WordCloud } from '../../displays'
import RevealImage from '../../reveal-image'

/**
 * Leinwand einer Live-Runde (für Beamer/Bildschirm im Raum): Lobby mit PIN und QR-Code, Frage
 * mit Countdown, Auflösung, Rangliste, Siegertreppchen. Weiterschalten nur hier; die Antwort auf
 * jeden Klick kommt über das Long-Polling zurück (useLiveView).
 */
export default function Presenter({ sessionId, initial, joinUrl }: { sessionId: string; initial: LiveView; joinUrl: string }) {
  const { view, status, offset, refresh } = useLiveView(sessionId, true, initial)
  const [pending, startTransition] = useTransition()
  const [confirmKick, setConfirmKick] = useState<string | null>(null)
  const remaining = useCountdown(view.question?.endsAt ?? null, offset)

  const control = (op: 'next' | 'finish' | 'lock' | 'unlock' | 'uncover') =>
    startTransition(async () => {
      await controlLiveAction(sessionId, op, view.version)
      refresh()
    })

  const kick = (playerId: string) =>
    startTransition(async () => {
      await kickLivePlayer(sessionId, playerId)
      setConfirmKick(null)
      refresh()
    })

  const hideWord = (questionId: string, key: string, text: string) => {
    if (!confirm(`"${text}" aus der Wortwolke ausblenden?`)) return
    startTransition(async () => {
      await hideLiveWord(sessionId, questionId, key)
      refresh()
    })
  }

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen().catch(() => {})
  }

  if (status === 'gone') {
    return <Shell><p className="text-2xl text-center">Diese Live-Runde gibt es nicht mehr.</p></Shell>
  }

  const q = view.question
  const isLast = view.index >= view.questionCount - 1
  const nextLabel =
    view.phase === 'LOBBY' ? 'Starten'
    : view.phase === 'QUESTION' ? 'Jetzt auflösen'
    : view.phase === 'REVEAL' && q?.quiz ? 'Rangliste'
    : isLast ? 'Zum Ergebnis'
    : 'Nächste Frage'

  return (
    <Shell>
      <header className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-300">
        <span className="font-semibold text-white truncate">{view.title}</span>
        <span className="flex items-center gap-3">
          {view.index >= 0 && view.phase !== 'FINISHED' && <span>Frage {view.index + 1} von {view.questionCount}</span>}
          <span>{view.playerCount} dabei</span>
          {status === 'offline' && <span className="text-amber-300">Verbindung unterbrochen …</span>}
          <button type="button" onClick={fullscreen} className="rounded bg-white/10 px-2 py-1 hover:bg-white/20">Vollbild</button>
          <Link href={`/live/${sessionId}/verwalten`} className="rounded bg-white/10 px-2 py-1 hover:bg-white/20">Verwaltung</Link>
        </span>
      </header>

      <div className="grow flex flex-col justify-center gap-6 py-6">
        {view.phase === 'LOBBY' && (
          <div className="grid gap-8 md:grid-cols-[1fr_auto] items-center">
            <div className="space-y-4">
              <p className="text-xl text-gray-300">Mitmachen auf <span className="font-semibold text-white">{joinUrl.replace(/^https?:\/\//, '')}</span> mit der PIN</p>
              <p className="text-7xl md:text-9xl font-black tracking-widest" aria-label="PIN">{view.pin?.replace(/(\d{3})(\d{3})/, '$1 $2') ?? '…'}</p>
              {view.joinLocked && <p className="text-amber-300 font-semibold">Beitritt ist gesperrt.</p>}
            </div>
            {view.pin && (
              <div className="rounded-lg bg-white p-3 justify-self-center">
                <QrCode value={`${joinUrl}?pin=${view.pin}`} label="QR-Code zum Beitreten" size={220} />
              </div>
            )}
            <div className="md:col-span-2">
              <h2 className="text-lg font-semibold mb-2">{view.playerCount === 0 ? 'Warte auf Teilnehmende …' : `${view.playerCount} Teilnehmende`}</h2>
              <ul className="flex flex-wrap gap-2" aria-label="Teilnehmende">
                {view.players?.map(p => (
                  <li key={p.id}>
                    {confirmKick === p.id ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-700 px-3 py-1 font-semibold">
                        {p.nickname} entfernen?
                        <button type="button" disabled={pending} onClick={() => kick(p.id)} className="underline">Ja</button>
                        <button type="button" onClick={() => setConfirmKick(null)} className="underline">Nein</button>
                      </span>
                    ) : (
                      <button
                        type="button" onClick={() => setConfirmKick(p.id)} title="Antippen zum Entfernen"
                        className="rounded-full bg-white/15 px-3 py-1 font-semibold hover:bg-red-700/60"
                      >
                        {p.nickname}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {q && (view.phase === 'QUESTION' || view.phase === 'REVEAL') && (
          <>
            <div className="flex items-start justify-between gap-6">
              <h1 className="text-3xl md:text-5xl font-bold leading-tight">{q.text}</h1>
              {view.phase === 'QUESTION' && remaining !== null && (
                <div className="shrink-0 grid place-items-center w-24 h-24 rounded-full bg-purple-700 text-4xl font-black" aria-label="Verbleibende Sekunden">
                  {remaining}
                </div>
              )}
            </div>
            <p className="text-lg text-gray-300">
              {view.phase === 'QUESTION'
                ? `${q.answeredCount} von ${view.playerCount} haben geantwortet`
                : `${q.answeredCount} Antwort${q.answeredCount === 1 ? '' : 'en'}`}
              {q.kind === 'MULTI' && ' · mehrere Antworten möglich'}
            </p>
            {q.reveal && q.imageId ? (
              <RevealImage
                imageId={q.imageId} questionId={q.id} startedAt={q.reveal.startedAt} steps={q.reveal.steps}
                timeLimit={q.timeLimit} offset={offset} className="max-h-[45vh]"
              />
            ) : (
              <QuestionImage imageId={q.imageId} className="max-h-[35vh] mx-auto" />
            )}
            {(q.kind === 'CHOICE' || q.kind === 'MULTI') && (
              <AnswerGrid answers={q.answers} revealed={view.phase === 'REVEAL'} total={q.answeredCount} />
            )}
            {q.kind === 'ESTIMATE' && (view.phase === 'QUESTION' ? (
              <p className="text-3xl text-center font-semibold">Schätzt jetzt auf dem Handy{q.unit ? ` (in ${q.unit})` : ''}!</p>
            ) : (
              <div className="space-y-4">
                <EstimateLine values={q.estimate?.values ?? []} target={q.estimate?.target ?? null} unit={q.unit} />
                <p className="text-xl text-center text-gray-200"><EstimateSummary stats={q.estimate?.stats ?? null} unit={q.unit} /></p>
              </div>
            ))}
            {q.kind === 'WORDCLOUD' && (
              <div className="space-y-2">
                <WordCloud words={q.words ?? []} onPick={w => hideWord(q.id, w.key, w.text)} />
                <p className="text-xs text-center text-gray-500">Ein Wort antippen, um es auszublenden.</p>
              </div>
            )}
          </>
        )}

        {view.phase === 'LEADERBOARD' && (
          <div className="max-w-2xl w-full mx-auto space-y-4">
            <h1 className="text-4xl font-bold text-center">Rangliste</h1>
            <Ranking rows={view.leaderboard ?? []} />
          </div>
        )}

        {view.phase === 'FINISHED' && (
          <div className="max-w-3xl w-full mx-auto space-y-6 text-center">
            <h1 className="text-4xl font-bold">{view.hasQuiz ? 'Siegertreppchen' : 'Danke fürs Mitmachen!'}</h1>
            {view.hasQuiz && <Podium rows={view.leaderboard ?? []} />}
            {view.hasQuiz && (view.leaderboard?.length ?? 0) > 3 && <Ranking rows={(view.leaderboard ?? []).slice(3)} />}
            <p className="text-gray-300">
              Alle Ergebnisse stehen auf der <Link href={`/live/${sessionId}/verwalten`} className="underline">Verwaltungsseite</Link>.
            </p>
          </div>
        )}
      </div>

      {view.phase !== 'FINISHED' && (
        <footer className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              type="button" disabled={pending} onClick={() => control(view.joinLocked ? 'unlock' : 'lock')}
              className="rounded bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-50"
            >
              {view.joinLocked ? 'Beitritt öffnen' : 'Beitritt sperren'}
            </button>
            {view.phase !== 'LOBBY' && (
              <button
                type="button" disabled={pending}
                onClick={() => { if (confirm('Live-Runde jetzt beenden?')) control('finish') }}
                className="rounded bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-50"
              >
                Beenden
              </button>
            )}
          </div>
          <span className="flex flex-wrap gap-2">
            {q?.reveal && (
              <button
                type="button" disabled={pending} onClick={() => control('uncover')}
                className="rounded-lg bg-purple-700 font-bold text-xl px-6 py-3 hover:bg-purple-600 disabled:opacity-50"
              >
                Stück aufdecken
              </button>
            )}
            <button
              type="button" disabled={pending || (view.phase === 'LOBBY' && view.playerCount === 0)} onClick={() => control('next')}
              className="rounded-lg bg-white text-gray-900 font-bold text-xl px-8 py-3 hover:bg-gray-200 disabled:opacity-50"
            >
              {nextLabel}
            </button>
          </span>
        </footer>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  // Deckt Kopfzeile und Fußzeile des Layouts ab - auf dem Beamer zählt jeder Pixel.
  return <main className="fixed inset-0 z-50 overflow-auto bg-gray-900 text-white px-4 md:px-10 py-4 flex flex-col">{children}</main>
}

function AnswerGrid({ answers, revealed, total }: { answers: LiveAnswerView[]; revealed: boolean; total: number }) {
  const max = Math.max(1, ...answers.map(a => a.count ?? 0))
  const quiz = answers.some(a => a.correct)
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {answers.map((a, i) => {
        const style = ANSWER_STYLES[i % ANSWER_STYLES.length]
        const dim = revealed && quiz && !a.correct
        return (
          <li key={a.id} className={`${style.bg} rounded-lg p-4 flex items-center gap-4 text-xl md:text-2xl font-semibold transition ${dim ? 'opacity-40' : ''}`}>
            <AnswerShape index={i} className="w-8 h-8" />
            <span className="grow">{a.label}</span>
            {revealed && (
              <span className="flex items-center gap-3">
                <span className="hidden md:block w-32 h-3 rounded bg-black/20 overflow-hidden">
                  <span className="block h-full bg-white" style={{ width: `${((a.count ?? 0) / max) * 100}%` }} />
                </span>
                <span aria-label={`${a.count ?? 0} von ${total}`}>{a.count ?? 0}</span>
                {a.correct && <span aria-label="richtig">✓</span>}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Ranking({ rows }: { rows: NonNullable<LiveView['leaderboard']> }) {
  if (rows.length === 0) return <p className="text-center text-gray-300">Noch keine Punkte.</p>
  return (
    <ol className="space-y-2 text-left" aria-label="Rangliste">
      {rows.map(row => (
        <li key={row.playerId} className="flex items-center gap-4 rounded-lg bg-white/10 px-4 py-3 text-xl">
          <span className="w-10 text-right font-black">{row.rank}.</span>
          <span className="grow font-semibold">{row.nickname}</span>
          <span className="tabular-nums">{row.score}</span>
        </li>
      ))}
    </ol>
  )
}

function Podium({ rows }: { rows: NonNullable<LiveView['leaderboard']> }) {
  const top = rows.slice(0, 3)
  // Platz 2 links, 1 in der Mitte, 3 rechts.
  const order = [top[1], top[0], top[2]]
  const heights = ['h-32', 'h-44', 'h-24']
  return (
    <div className="flex items-end justify-center gap-3" aria-label="Siegertreppchen">
      {order.map((row, i) =>
        row ? (
          <div key={row.playerId} className="w-40 text-center">
            <p className="font-bold text-xl truncate">{row.nickname}</p>
            <p className="text-gray-300 tabular-nums">{row.score} Punkte</p>
            <div className={`${heights[i]} mt-2 rounded-t-lg bg-purple-700 grid place-items-center text-5xl font-black`}>{row.rank}</div>
          </div>
        ) : (
          <div key={i} className="w-40" />
        )
      )}
    </div>
  )
}
