'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { LiveView } from '../../lib/live'
import { answerLive } from '../../live-actions'
import { useCountdown, useLiveView } from '../use-live-view'
import { ANSWER_STYLES, AnswerShape } from '../shapes'

/**
 * Ansicht der Teilnehmenden (Handy): warten, antworten (farbige Knöpfe wie auf der Leinwand),
 * danach das eigene Ergebnis. Die Frage selbst steht groß auf der Leinwand; hier steht sie klein
 * mit, damit man auch ohne Blick nach vorn antworten kann.
 */
export default function Player({ sessionId, initial }: { sessionId: string; initial: LiveView }) {
  const { view, status, offset, refresh } = useLiveView(sessionId, false, initial)
  const [pending, startTransition] = useTransition()
  // Sofortige Rückmeldung nach dem Tippen, bevor die neue Ansicht da ist.
  const [chosen, setChosen] = useState<{ index: number; answerId: string } | null>(null)
  const [late, setLate] = useState<number | null>(null)
  const remaining = useCountdown(view.question?.endsAt ?? null, offset)
  const me = view.me

  if (status === 'gone' || !me) {
    return (
      <Shell>
        <div className="text-center space-y-4">
          <p className="text-xl font-semibold">Du bist nicht (mehr) Teil dieser Live-Runde.</p>
          <p className="text-gray-300">Vielleicht wurde sie neu gestartet oder du wurdest entfernt.</p>
          <Link href="/live" className="inline-block rounded-lg bg-white text-gray-900 font-bold px-6 py-3">Neu beitreten</Link>
        </div>
      </Shell>
    )
  }

  const answer = (answerId: string) => {
    setChosen({ index: view.index, answerId })
    startTransition(async () => {
      const result = await answerLive(sessionId, view.index, answerId)
      if (!result.ok) {
        setChosen(null)
        if (result.reason === 'late') setLate(view.index)
      }
      refresh()
    })
  }

  const q = view.question
  const myAnswer = me.answerId ?? (chosen?.index === view.index ? chosen.answerId : null)
  const myAnswerIndex = q?.answers.findIndex(a => a.id === myAnswer) ?? -1

  return (
    <Shell>
      <header className="flex items-center justify-between gap-3 text-sm text-gray-300">
        <span className="font-semibold text-white truncate">{me.nickname}</span>
        <span className="flex gap-3">
          {view.index >= 0 && view.phase !== 'FINISHED' && <span>Frage {view.index + 1}/{view.questionCount}</span>}
          {view.hasQuiz && view.phase !== 'LOBBY' && view.phase !== 'QUESTION' && <span className="tabular-nums">{me.score} Punkte</span>}
        </span>
      </header>
      {status === 'offline' && <p className="text-center text-amber-300 text-sm">Verbindung unterbrochen - versuche es weiter …</p>}

      <div className="grow flex flex-col justify-center gap-4 py-6">
        {view.phase === 'LOBBY' && (
          <Center title={`Du bist dabei, ${me.nickname}!`} text="Gleich geht es los - schau nach vorn auf die Leinwand." />
        )}

        {view.phase === 'QUESTION' && q && (
          myAnswer ? (
            <div className="text-center space-y-4">
              {myAnswerIndex >= 0 && (
                <div className={`${ANSWER_STYLES[myAnswerIndex % ANSWER_STYLES.length].bg} inline-flex rounded-lg p-4`}>
                  <AnswerShape index={myAnswerIndex} className="w-12 h-12" />
                </div>
              )}
              <p className="text-2xl font-semibold">Antwort gespeichert</p>
              <p className="text-gray-300">Warte auf die anderen …</p>
            </div>
          ) : late === view.index ? (
            <Center title="Zu spät" text="Die Zeit für diese Frage ist leider um." />
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="text-lg font-semibold">{q.text}</p>
                {remaining !== null && <span className="shrink-0 rounded-full bg-purple-700 px-3 py-1 font-bold tabular-nums">{remaining}</span>}
              </div>
              <div className="grid grid-cols-2 gap-3 grow max-h-[60vh]">
                {q.answers.map((a, i) => (
                  <button
                    key={a.id} type="button" disabled={pending} onClick={() => answer(a.id)}
                    className={`${ANSWER_STYLES[i % ANSWER_STYLES.length].bg} rounded-lg p-3 flex flex-col items-center justify-center gap-2 text-lg font-semibold active:scale-95 transition disabled:opacity-70 ${q.answers.length % 2 === 1 && i === q.answers.length - 1 ? 'col-span-2' : ''}`}
                  >
                    <AnswerShape index={i} className="w-10 h-10" />
                    <span className="break-words">{a.label}</span>
                  </button>
                ))}
              </div>
            </>
          )
        )}

        {view.phase === 'REVEAL' && q && (
          q.quiz ? (
            me.correct ? (
              <Result tone="bg-green-600" title="Richtig!" text={`+${me.points ?? 0} Punkte`} />
            ) : (
              <Result
                tone="bg-red-600"
                title={me.answerId ? 'Leider falsch' : 'Keine Antwort'}
                text={`Richtig war: ${q.answers.filter(a => a.correct).map(a => a.label).join(' / ')}`}
              />
            )
          ) : (
            <Center title={me.answerId ? 'Danke für deine Antwort!' : 'Keine Antwort'} text="Das Ergebnis siehst du auf der Leinwand." />
          )
        )}

        {view.phase === 'LEADERBOARD' && (
          <Center title={`Platz ${me.rank} von ${view.playerCount}`} text={`${me.score} Punkte`} />
        )}

        {view.phase === 'FINISHED' && (
          view.hasQuiz ? (
            <div className="text-center space-y-4">
              <p className="text-4xl font-black">Platz {me.rank}</p>
              <p className="text-xl">{me.score} Punkte</p>
              {view.leaderboard && view.leaderboard.length > 0 && (
                <ol className="max-w-xs mx-auto space-y-1 text-left">
                  {view.leaderboard.map(row => (
                    <li key={row.playerId} className="flex justify-between rounded bg-white/10 px-3 py-2">
                      <span>{row.rank}. {row.nickname}</span>
                      <span className="tabular-nums">{row.score}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <Center title="Danke fürs Mitmachen!" text="Die Live-Runde ist beendet." />
          )
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-[85vh] bg-gray-900 text-white px-4 py-4 flex flex-col max-w-xl mx-auto w-full rounded-none sm:rounded-lg">{children}</main>
}

function Center({ title, text }: { title: string; text: string }) {
  return (
    <div className="text-center space-y-3">
      <p className="text-2xl font-bold">{title}</p>
      <p className="text-gray-300">{text}</p>
    </div>
  )
}

function Result({ tone, title, text }: { tone: string; title: string; text: string }) {
  return (
    <div className={`${tone} rounded-lg p-8 text-center space-y-2`} role="status">
      <p className="text-3xl font-black">{title}</p>
      <p className="text-lg">{text}</p>
    </div>
  )
}
