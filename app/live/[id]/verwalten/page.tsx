import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import { formatNumber, getLiveLevel, loadLiveResults } from '../../../lib/live'
import { deleteLive, resetLive, shareLive, unshareLive } from '../../../live-actions'
import QrCode from '../../../ui/qr-code'
import { buttonClass, Card, inputClass, Stat, CopyableField, ConfirmForm, Notice } from '../../../ui/kit'
import LiveFrame from '../live-frame'
import { ANSWER_STYLES, AnswerShape } from '../../shapes'
import { EstimateSummary, QuestionImage, TextAnswerList, WordCloud } from '../../displays'

export const dynamic = 'force-dynamic'

const KIND_LABELS = { CHOICE: 'Auswahl', MULTI: 'Mehrfachauswahl', ESTIMATE: 'Schätzfrage', WORDCLOUD: 'Wortwolke', TEXT: 'Freitext' } as const
const SHARE_ERRORS: Record<string, string> = {
  unbekannt: 'Zu dieser E-Mail-Adresse gibt es kein Konto. Lade die Person zuerst unter "Konten" ein.',
  owner: 'Diese Person besitzt die Live-Runde bereits.'
}

/**
 * Übersicht einer Live-Runde (docs/KONZEPT-OBERFLAECHE.md): Kennzahlen, Beitrittsdaten, Rangliste, Ergebnisse mit
 * CSV-Export, darunter gemeinsam moderieren, neu starten und löschen - für Owner, Admins und Konten mit Freigabe.
 * Löschen und Teilen nur Owner und Admins (getLiveLevel). Leinwand und Reiter im Rahmen (live-frame.tsx).
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
    <LiveFrame session={session} isOwner={isOwner} editable={!played}>
      <div className="space-y-6">
        {angelegt === '1' && <Notice tone="success">Live-Runde angelegt. Öffne die Leinwand, sobald alle im Raum sind.</Notice>}
        {gespeichert === '1' && <Notice tone="success">Änderungen gespeichert.</Notice>}
        {neu === '1' && <Notice tone="success">Zurück in der Lobby - mit neuer PIN, ohne Teilnehmende und Antworten.</Notice>}
        {geteilt === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}
        {teilenFehler && Object.hasOwn(SHARE_ERRORS, teilenFehler) && <Notice tone="error">{SHARE_ERRORS[teilenFehler]}</Notice>}
        {fehler === 'gespielt' && <Notice tone="warning">Es wurde schon geantwortet - Fragen lassen sich erst nach &quot;Neu starten&quot; wieder ändern.</Notice>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Fragen" value={questions.length} hint={hasQuiz ? 'Quiz mit Punkten' : 'ohne Punkte'} />
          <Stat label="Teilnehmende" value={session._count.players} testId="stat-players" />
          <Stat label="Antworten" value={questions.reduce((sum, q) => sum + q.responses.length, 0)} />
          <Stat label="PIN" value={session.pin ? <span className="tabular-nums">{session.pin.replace(/(\d{3})(\d{3})/, '$1 $2')}</span> : '–'} hint={session.pin ? undefined : 'Runde beendet'} />
        </div>

        {session.pin && (
          <Card className="space-y-4">
            <h2 className="font-semibold">Zum Beitreten</h2>
            <CopyableField label="Zum Beitreten (oder PIN auf der Leinwand)" value={`${joinUrl}?pin=${session.pin}`} />
            <details className="text-sm text-gray-600 dark:text-gray-400">
              <summary className="cursor-pointer">QR-Code zum Beitreten</summary>
              <div className="mt-2"><QrCode value={`${joinUrl}?pin=${session.pin}`} label="QR-Code zum Beitreten" /></div>
            </details>
          </Card>
        )}

        {hasQuiz && standings.length > 0 && (
          <Card className="space-y-3">
            <h2 className="font-semibold">Rangliste</h2>
            <ol className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
              {standings.map(row => (
                <li key={row.playerId} className="py-1.5 flex justify-between gap-3">
                  <span>{row.rank}. {row.nickname}</span>
                  <span className="tabular-nums text-gray-600 dark:text-gray-400">{row.score} Punkte</span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        <Card className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{played ? 'Ergebnisse' : 'Fragen'}</h2>
            {played && <a href={`/live/${id}/verwalten/export`} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">CSV-Export ↓</a>}
          </div>
          {questions.map((q, i) => {
            const total = q.responses.length
            return (
              <section key={q.id} className="space-y-2">
                <h3 className="font-medium">
                  {i + 1}. {q.text}
                  <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
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
                            <span className={`grow ${a.isCorrect ? 'font-semibold text-green-800 dark:text-green-200' : ''}`}>{a.label}{a.isCorrect && ' ✓'}</span>
                            {played && <span className="text-gray-500 dark:text-gray-400 tabular-nums">{count} · {pct}%</span>}
                          </div>
                          {played && (
                            <div className="ml-7 mt-1 w-[calc(100%-1.75rem)] bg-gray-100 dark:bg-gray-700 rounded h-1.5 overflow-hidden">
                              <div className={`${ANSWER_STYLES[j % ANSWER_STYLES.length].bar} h-1.5`} style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}

                {q.kind === 'ESTIMATE' && (
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {q.target !== null && <><span className="font-semibold text-green-800 dark:text-green-200">Richtig: {formatNumber(q.target)}{q.unit ? ` ${q.unit}` : ''}</span>{played && ' · '}</>}
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
        </Card>

        {isOwner && (
          <Card className="space-y-3">
            <h2 className="font-semibold">Gemeinsam moderieren</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Andere Konten dürfen dann präsentieren, bearbeiten, neu starten und exportieren - nicht löschen oder weiter teilen.
            </p>
            {session.access.length > 0 && (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" aria-label="Freigaben">
                {session.access.map(a => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="truncate">{a.user.name ? `${a.user.name} (${a.user.email})` : a.user.email}</span>
                    <form action={unshareLive}>
                      <input type="hidden" name="accessId" value={a.id} />
                      <button type="submit" className="text-sm font-medium text-red-700 dark:text-red-300 hover:underline">Entfernen</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={shareLive} className="flex gap-2">
              {hidden}
              <label htmlFor="live-share-email" className="sr-only">E-Mail-Adresse des Kontos</label>
              <input id="live-share-email" type="email" name="email" required placeholder="E-Mail-Adresse eines Kontos" className={inputClass.replace('w-full', 'min-w-0 grow')} />
              <button type="submit" className={buttonClass('primary')}>Teilen</button>
            </form>
          </Card>
        )}

        {((session.phase !== 'LOBBY' || session._count.players > 0) || isOwner) && (
          <Card className="space-y-3">
            <h2 className="font-semibold">Weitere Aktionen</h2>
            <div className="flex flex-wrap gap-3">
              {(session.phase !== 'LOBBY' || session._count.players > 0) && (
                <ConfirmForm action={resetLive} message="Neu starten? Teilnehmende und alle Antworten dieser Runde werden gelöscht, es gibt eine neue PIN.">
                  {hidden}
                  <button type="submit" className={buttonClass('secondary')}>↺ Neu starten</button>
                </ConfirmForm>
              )}
              {isOwner && (
                <ConfirmForm action={deleteLive} message="Live-Runde inklusive aller Antworten unwiderruflich löschen?">
                  {hidden}
                  <button type="submit" className={buttonClass('danger')}>Löschen</button>
                </ConfirmForm>
              )}
            </div>
            {(session.phase !== 'LOBBY' || session._count.players > 0) && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Neu starten führt zurück in die Lobby: neue PIN, Teilnehmende und Antworten werden gelöscht, die Fragen bleiben.
              </p>
            )}
          </Card>
        )}
      </div>
    </LiveFrame>
  )
}
