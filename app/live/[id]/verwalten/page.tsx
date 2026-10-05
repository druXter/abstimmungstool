import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import { formatNumber, getLiveLevel, loadLiveResults } from '../../../lib/live'
import { deleteLive, resetLive, shareLive, unshareLive } from '../../../live-actions'
import CopyableField from '../../../ui/copyable-field'
import ConfirmForm from '../../../ui/confirm-form'
import Notice from '../../../ui/notice'
import QrCode from '../../../ui/qr-code'
import { ANSWER_STYLES, AnswerShape } from '../../shapes'
import { EstimateSummary, QuestionImage, TextAnswerList, WordCloud } from '../../displays'

export const dynamic = 'force-dynamic'

const PHASE_LABELS = { LOBBY: 'Lobby', QUESTION: 'läuft', REVEAL: 'läuft', LEADERBOARD: 'läuft', FINISHED: 'beendet' } as const
const KIND_LABELS = { CHOICE: 'Auswahl', MULTI: 'Mehrfachauswahl', ESTIMATE: 'Schätzfrage', WORDCLOUD: 'Wortwolke', TEXT: 'Freitext' } as const
const SHARE_ERRORS: Record<string, string> = {
  unbekannt: 'Zu dieser E-Mail-Adresse gibt es kein Konto. Lade die Person zuerst unter "Konten" ein.',
  owner: 'Diese Person besitzt die Live-Runde bereits.'
}

/**
 * Verwaltung einer Live-Runde: Leinwand öffnen, Beitrittsdaten, Ergebnisse, CSV-Export, neu starten -
 * für Owner, Admins und Konten mit Freigabe. Löschen und Teilen nur Owner und Admins (getLiveLevel).
 */
export default async function ManageLivePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ angelegt?: string; gespeichert?: string; neu?: string; fehler?: string; geteilt?: string; teilenFehler?: string }>
}) {
  const { id } = await params
  const { angelegt, gespeichert, neu, fehler, geteilt, teilenFehler } = await searchParams
  const session = await prisma.liveSession.findUnique({
    where: { id },
    include: {
      _count: { select: { players: true } },
      owner: { select: { email: true, name: true } },
      access: { select: { id: true, user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } }
    }
  })
  if (!session) notFound()

  const user = await getCurrentUser()
  const level = await getLiveLevel(user, session)
  if (!level) {
    if (!user) redirect(`/anmelden?next=${encodeURIComponent(`/live/${id}/verwalten`)}`)
    notFound()
  }
  const isOwner = level === 'owner'

  const { questions, standings } = await loadLiveResults(id)
  const played = questions.some(q => q.responses.length > 0)
  const hasQuiz = questions.some(q => q.quiz)
  const joinUrl = `${baseUrl()}/live`
  const hidden = <input type="hidden" name="sessionId" value={id} />

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-6 text-gray-900">
        {angelegt === '1' && <Notice tone="success">Live-Runde angelegt. Öffne die Leinwand, sobald alle im Raum sind.</Notice>}
        {gespeichert === '1' && <Notice tone="success">Änderungen gespeichert.</Notice>}
        {neu === '1' && <Notice tone="success">Zurück in der Lobby - mit neuer PIN, ohne Teilnehmende und Antworten.</Notice>}
        {geteilt === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}
        {teilenFehler && Object.hasOwn(SHARE_ERRORS, teilenFehler) && <Notice tone="error">{SHARE_ERRORS[teilenFehler]}</Notice>}
        {fehler === 'gespielt' && <Notice tone="warning">Es wurde schon geantwortet - Fragen lassen sich erst nach &quot;Neu starten&quot; wieder ändern.</Notice>}

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold">{session.title}</h1>
            <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${session.phase === 'FINISHED' ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-800'}`}>
              Live · {PHASE_LABELS[session.phase]}
            </span>
          </div>
          {!isOwner && (
            <p className="text-xs text-gray-500">
              Du moderierst diese Live-Runde von {session.owner.name || session.owner.email}: Präsentieren, Bearbeiten, Neu starten und
              Exportieren sind erlaubt, Löschen und Teilen nicht.
            </p>
          )}
          <p className="text-sm text-gray-600">
            {questions.length} Frage{questions.length === 1 ? '' : 'n'}{hasQuiz ? ' (Quiz mit Punkten)' : ''} · {session._count.players} Teilnehmende
          </p>

          {session.pin && (
            <>
              <CopyableField label="Zum Beitreten (oder PIN auf der Leinwand)" value={`${joinUrl}?pin=${session.pin}`} />
              <details className="text-xs text-gray-600">
                <summary className="cursor-pointer">QR-Code zum Beitreten</summary>
                <div className="mt-2"><QrCode value={`${joinUrl}?pin=${session.pin}`} label="QR-Code zum Beitreten" /></div>
              </details>
            </>
          )}

          <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100">
            {session.phase !== 'FINISHED' && (
              <Link href={`/live/${id}/praesentieren`} className="text-sm bg-blue-600 text-white font-bold hover:bg-blue-700 px-3 py-1.5 rounded transition">
                ▶ Leinwand öffnen
              </Link>
            )}
            {!played && (
              <Link href={`/live/${id}/bearbeiten`} className="text-sm bg-blue-100 text-blue-800 hover:bg-blue-200 px-3 py-1.5 rounded transition">
                ✏️ Bearbeiten
              </Link>
            )}
            {played && (
              <a href={`/live/${id}/verwalten/export`} className="text-sm bg-gray-100 text-gray-800 hover:bg-gray-200 px-3 py-1.5 rounded transition">
                ⬇️ CSV-Export
              </a>
            )}
            {(session.phase !== 'LOBBY' || session._count.players > 0) && (
              <ConfirmForm action={resetLive} message="Neu starten? Teilnehmende und alle Antworten dieser Runde werden gelöscht, es gibt eine neue PIN.">
                {hidden}
                <button type="submit" className="text-sm bg-amber-100 text-amber-800 hover:bg-amber-200 px-3 py-1.5 rounded transition">↺ Neu starten</button>
              </ConfirmForm>
            )}
            {isOwner && (
              <ConfirmForm action={deleteLive} message="Live-Runde inklusive aller Antworten unwiderruflich löschen?">
                {hidden}
                <button type="submit" className="text-sm text-red-700 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded transition">🗑️ Löschen</button>
              </ConfirmForm>
            )}
          </div>
        </div>

        {isOwner && (
          <div className="bg-white p-6 rounded-lg shadow space-y-3">
            <h2 className="font-bold">Gemeinsam moderieren</h2>
            <p className="text-sm text-gray-600">
              Andere Konten dürfen dann präsentieren, bearbeiten, neu starten und exportieren - nicht löschen oder weiter teilen.
            </p>
            {session.access.length > 0 && (
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded text-sm" aria-label="Freigaben">
                {session.access.map(a => (
                  <li key={a.id} className="flex items-center justify-between gap-3 p-2">
                    <span className="truncate">{a.user.name ? `${a.user.name} (${a.user.email})` : a.user.email}</span>
                    <form action={unshareLive}>
                      <input type="hidden" name="accessId" value={a.id} />
                      <button type="submit" className="text-xs text-red-700 hover:underline">Entfernen</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={shareLive} className="flex gap-2">
              {hidden}
              <label htmlFor="live-share-email" className="sr-only">E-Mail-Adresse des Kontos</label>
              <input id="live-share-email" type="email" name="email" required placeholder="E-Mail-Adresse eines Kontos" className="grow border border-gray-300 p-2 rounded text-sm" />
              <button type="submit" className="bg-blue-600 text-white text-sm font-bold px-4 rounded hover:bg-blue-700 transition">Teilen</button>
            </form>
          </div>
        )}

        {hasQuiz && standings.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow space-y-3">
            <h2 className="font-bold">Rangliste</h2>
            <ol className="divide-y text-sm">
              {standings.map(row => (
                <li key={row.playerId} className="py-1.5 flex justify-between gap-3">
                  <span>{row.rank}. {row.nickname}</span>
                  <span className="tabular-nums text-gray-600">{row.score} Punkte</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="bg-white p-6 rounded-lg shadow space-y-5">
          <h2 className="font-bold">{played ? 'Ergebnisse' : 'Fragen'}</h2>
          {questions.map((q, i) => {
            const total = q.responses.length
            return (
              <section key={q.id} className="space-y-2">
                <h3 className="font-medium">
                  {i + 1}. {q.text}
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {KIND_LABELS[q.kind]} · {q.timeLimit ? `${q.timeLimit} s` : 'ohne Zeitlimit'}{q.quiz ? ' · Quiz' : ''}{played ? ` · ${total} Antwort${total === 1 ? '' : 'en'}` : ''}
                  </span>
                </h3>
                <QuestionImage imageId={q.imageId} className="max-h-32" />

                {(q.kind === 'CHOICE' || q.kind === 'MULTI') && (
                  <ul className="space-y-1.5">
                    {q.answers.map((a, j) => {
                      const count = q.counts.get(a.id) ?? 0
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0
                      return (
                        <li key={a.id}>
                          <div className="flex items-center gap-2 text-sm">
                            <span className={`${ANSWER_STYLES[j % ANSWER_STYLES.length].bg} rounded p-1`}><AnswerShape index={j} className="w-3 h-3" /></span>
                            <span className={`grow ${a.isCorrect ? 'font-semibold text-green-800' : ''}`}>{a.label}{a.isCorrect && ' ✓'}</span>
                            {played && <span className="text-gray-500 tabular-nums">{count} · {pct}%</span>}
                          </div>
                          {played && (
                            <div className="ml-7 mt-1 w-[calc(100%-1.75rem)] bg-gray-100 rounded h-1.5 overflow-hidden">
                              <div className={`${ANSWER_STYLES[j % ANSWER_STYLES.length].bar} h-1.5`} style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}

                {q.kind === 'ESTIMATE' && (
                  <p className="text-sm text-gray-700">
                    {q.target !== null && <><span className="font-semibold text-green-800">Richtig: {formatNumber(q.target)}{q.unit ? ` ${q.unit}` : ''}</span>{played && ' · '}</>}
                    {played && <EstimateSummary stats={q.estimate} unit={q.unit} />}
                  </p>
                )}

                {q.kind === 'WORDCLOUD' && played && <WordCloud words={q.words} tone="light" max={2} min={0.85} />}

                {q.kind === 'TEXT' && (
                  <TextAnswerList accepted={q.answers.filter(a => a.isCorrect).map(a => a.label)} answers={q.textAnswers} tone="light" />
                )}
              </section>
            )
          })}
        </div>
      </div>
    </main>
  )
}
