'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { LiveView } from '../../lib/live'
import { answerLive, type LiveAnswerInput } from '../../live-actions'
import { useCountdown, useLiveView } from '../use-live-view'
import { ANSWER_STYLES, AnswerShape } from '../shapes'
import { EstimateSummary, formatDe, QuestionImage, WordCloud } from '../displays'

/**
 * Ansicht der Teilnehmenden (Handy): warten, antworten, danach das eigene Ergebnis. Je nach Art:
 * farbige Knöpfe wie auf der Leinwand (Auswahl), Knöpfe zum An-/Abwählen und Abschicken
 * (Mehrfachauswahl), Zahlenfeld (Schätzfrage) oder Textfeld (Wortwolke, Freitext). Die Frage steht klein
 * mit, damit man auch ohne Blick nach vorn antworten kann.
 */
export default function Player({ sessionId, initial }: { sessionId: string; initial: LiveView }) {
  const { view, status, offset, refresh } = useLiveView(sessionId, false, initial)
  const [pending, startTransition] = useTransition()
  // Sofortige Rückmeldung nach dem Abschicken, bevor die neue Ansicht da ist.
  const [sent, setSent] = useState<{ index: number; ids: string[] } | null>(null)
  const [late, setLate] = useState<number | null>(null)
  const [invalid, setInvalid] = useState(false)
  // Eingaben der aktuellen Frage (Mehrfachauswahl, Zahl, Wort) - beim Fragewechsel zurückgesetzt.
  const [draft, setDraft] = useState<{ index: number; ids: string[]; value: string; text: string }>({ index: -1, ids: [], value: '', text: '' })
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

  const submit = (input: LiveAnswerInput, ids: string[] = []) => {
    setSent({ index: view.index, ids })
    setInvalid(false)
    startTransition(async () => {
      const result = await answerLive(sessionId, view.index, input)
      if (!result.ok) {
        setSent(null)
        if (result.reason === 'late') setLate(view.index)
        if (result.reason === 'invalid') setInvalid(true)
      }
      refresh()
    })
  }

  const q = view.question
  const current = draft.index === view.index ? draft : { index: view.index, ids: [], value: '', text: '' }
  const setCurrent = (change: Partial<typeof current>) => setDraft({ ...current, ...change })
  const answered = me.answered || sent?.index === view.index
  const myIds = me.answered ? me.answerIds : sent?.index === view.index ? sent.ids : []
  const estimateValue = Number(current.value.replace(/\s/g, '').replace(',', '.'))

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
          answered ? (
            <div className="text-center space-y-4">
              {myIds.length > 0 && (
                <div className="flex justify-center gap-2">
                  {myIds.map(id => {
                    const i = q.answers.findIndex(a => a.id === id)
                    return i < 0 ? null : (
                      <span key={id} className={`${ANSWER_STYLES[i % ANSWER_STYLES.length].bg} inline-flex rounded-lg p-4`}>
                        <AnswerShape index={i} className="w-10 h-10" />
                      </span>
                    )
                  })}
                </div>
              )}
              <p className="text-2xl font-semibold">Antwort gespeichert</p>
              {me.answerText && q.kind !== 'CHOICE' && <p className="text-lg">{me.answerText}</p>}
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
              {q.imageOnScreen
                ? <p className="text-center text-gray-300">Schau auf die Leinwand - dort wird das Bild nach und nach aufgedeckt.</p>
                : <QuestionImage imageId={q.imageId} className="max-h-40 mx-auto" />}
              {invalid && <p className="text-amber-300 text-sm" role="alert">Das hat nicht geklappt - bitte prüfe deine Eingabe.</p>}

              {(q.kind === 'CHOICE' || q.kind === 'MULTI') && (
                <div className="grid grid-cols-2 gap-3 grow max-h-[60vh]">
                  {q.answers.map((a, i) => {
                    const picked = current.ids.includes(a.id)
                    return (
                      <button
                        key={a.id} type="button" disabled={pending} aria-pressed={q.kind === 'MULTI' ? picked : undefined}
                        onClick={() => q.kind === 'CHOICE'
                          ? submit({ answerId: a.id }, [a.id])
                          : setCurrent({ ids: picked ? current.ids.filter(id => id !== a.id) : [...current.ids, a.id] })}
                        className={`${ANSWER_STYLES[i % ANSWER_STYLES.length].bg} rounded-lg p-3 flex flex-col items-center justify-center gap-2 text-lg font-semibold active:scale-95 transition disabled:opacity-70 ${q.answers.length % 2 === 1 && i === q.answers.length - 1 ? 'col-span-2' : ''} ${q.kind === 'MULTI' && !picked ? 'opacity-60' : ''} ${picked ? 'ring-4 ring-white' : ''}`}
                      >
                        <AnswerShape index={i} className="w-10 h-10" />
                        <span className="break-words">{a.label}{picked ? ' ✓' : ''}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {q.kind === 'MULTI' && (
                <button
                  type="button" disabled={pending || current.ids.length === 0} onClick={() => submit({ answerIds: current.ids }, current.ids)}
                  className="rounded-lg bg-white text-gray-900 font-bold text-lg py-3 disabled:opacity-50"
                >
                  {current.ids.length === 0 ? 'Mehrere Antworten möglich' : `${current.ids.length} Antwort${current.ids.length === 1 ? '' : 'en'} abschicken`}
                </button>
              )}

              {q.kind === 'ESTIMATE' && (
                <form onSubmit={e => { e.preventDefault(); if (Number.isFinite(estimateValue) && current.value.trim()) submit({ value: estimateValue }) }} className="space-y-3">
                  <label className="block">
                    <span className="sr-only">Deine Schätzung</span>
                    <span className="flex items-center gap-2">
                      <input
                        inputMode="decimal" autoComplete="off" value={current.value} onChange={e => setCurrent({ value: e.target.value })}
                        placeholder="Deine Schätzung" aria-label="Deine Schätzung"
                        className="w-full rounded-lg p-4 text-2xl bg-white text-gray-900 text-center placeholder:text-gray-400"
                      />
                      {q.unit && <span className="text-xl">{q.unit}</span>}
                    </span>
                  </label>
                  <button type="submit" disabled={pending || !current.value.trim() || !Number.isFinite(estimateValue)} className="w-full rounded-lg bg-white text-gray-900 font-bold text-lg py-3 disabled:opacity-50">
                    Schätzung abschicken
                  </button>
                </form>
              )}

              {(q.kind === 'WORDCLOUD' || q.kind === 'TEXT') && (
                <form onSubmit={e => { e.preventDefault(); if (current.text.trim()) submit({ text: current.text }) }} className="space-y-3">
                  <input
                    maxLength={q.kind === 'TEXT' ? 100 : 40} autoComplete="off" autoCorrect="off" spellCheck={false} value={current.text} onChange={e => setCurrent({ text: e.target.value })}
                    placeholder={q.kind === 'TEXT' ? 'Deine Antwort' : 'Dein Begriff'} aria-label={q.kind === 'TEXT' ? 'Deine Antwort' : 'Dein Begriff'}
                    className="w-full rounded-lg p-4 text-2xl bg-white text-gray-900 text-center placeholder:text-gray-400"
                  />
                  <button type="submit" disabled={pending || !current.text.trim()} className="w-full rounded-lg bg-white text-gray-900 font-bold text-lg py-3 disabled:opacity-50">
                    Abschicken
                  </button>
                </form>
              )}
            </>
          )
        )}

        {view.phase === 'REVEAL' && q && (
          q.quiz ? (
            me.correct ? (
              <Result tone="bg-green-600" title={q.kind === 'ESTIMATE' ? 'Gut geschätzt!' : 'Richtig!'} text={`+${me.points ?? 0} Punkte`} />
            ) : (
              <Result
                tone="bg-red-600"
                title={!me.answered ? 'Keine Antwort' : q.kind === 'ESTIMATE' ? 'Leider zu weit weg' : 'Leider falsch'}
                text={q.kind === 'ESTIMATE'
                  ? `Richtig: ${formatDe(q.estimate?.target ?? 0)}${q.unit ? ` ${q.unit}` : ''}${me.answerText ? ` - du: ${me.answerText}` : ''}`
                  : q.kind === 'TEXT'
                    ? `Richtig war: ${q.textResult?.accepted.join(' / ') ?? ''}${me.answerText ? ` - du: ${me.answerText}` : ''}`
                    : `Richtig war: ${q.answers.filter(a => a.correct).map(a => a.label).join(q.kind === 'MULTI' ? ' + ' : ' / ')}`}
              />
            )
          ) : q.kind === 'WORDCLOUD' ? (
            <div className="space-y-4 text-center">
              <p className="text-xl font-bold">{me.answered ? 'Danke für deinen Beitrag!' : 'Keine Antwort'}</p>
              <WordCloud words={q.words ?? []} max={2.5} min={0.9} />
            </div>
          ) : (
            <Center
              title={me.answered ? 'Danke für deine Antwort!' : 'Keine Antwort'}
              text={q.kind === 'ESTIMATE' && q.estimate?.stats ? '' : 'Das Ergebnis siehst du auf der Leinwand.'}
            >
              {q.kind === 'ESTIMATE' && <p className="text-gray-300 text-sm"><EstimateSummary stats={q.estimate?.stats ?? null} unit={q.unit} /></p>}
            </Center>
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

function Center({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="text-center space-y-3">
      <p className="text-2xl font-bold">{title}</p>
      {text && <p className="text-gray-300">{text}</p>}
      {children}
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
