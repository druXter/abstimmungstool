import { prisma } from '../../../../lib/prisma'
import { getCurrentUser } from '../../../../lib/auth'
import { describeResponse, formatNumber, getLiveLevel, isCorrectResponse, loadLiveResults } from '../../../../lib/live'
import { csvResponse } from '../../../../lib/csv'

const KIND_LABELS = { CHOICE: 'Auswahl', MULTI: 'Mehrfachauswahl', ESTIMATE: 'Schätzfrage', WORDCLOUD: 'Wortwolke', TEXT: 'Freitext' } as const

/**
 * CSV-Export einer Live-Runde für alle, die sie verwalten dürfen (getLiveLevel): je Frage die
 * Verteilung, die Rangliste und jede einzelne Antwort (Spitzname, Antwort, richtig, Punkte,
 * Antwortzeit). Gleiches Format wie der Export der Abstimmungen (app/lib/csv.ts, mit Schutz vor
 * CSV-Injection - Spitznamen und Wortbeiträge sind frei eingegeben).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await prisma.liveSession.findUnique({ where: { id }, select: { id: true, ownerId: true, title: true, _count: { select: { players: true } } } })
  if (!session || !(await getLiveLevel(await getCurrentUser(), session))) return new Response('Not found', { status: 404 })

  const { questions, standings } = await loadLiveResults(id)
  const rows: string[][] = [['Live-Runde', session.title], ['Teilnehmende', String(session._count.players)], []]

  rows.push(['Nr', 'Frage', 'Art', 'Antwort / Wert', 'Anzahl', 'Richtig'])
  for (const [i, q] of questions.entries()) {
    const nr = String(i + 1)
    if (q.kind === 'CHOICE' || q.kind === 'MULTI') {
      for (const a of q.answers) rows.push([nr, q.text, KIND_LABELS[q.kind], a.label, String(q.counts.get(a.id) ?? 0), a.isCorrect ? 'ja' : ''])
    } else if (q.kind === 'ESTIMATE') {
      const unit = q.unit ? ` ${q.unit}` : ''
      if (q.target !== null) rows.push([nr, q.text, KIND_LABELS[q.kind], `richtig: ${formatNumber(q.target)}${unit}`, '', 'ja'])
      if (q.estimate) {
        rows.push([nr, q.text, KIND_LABELS[q.kind], `Median: ${formatNumber(q.estimate.median)}${unit}`, String(q.estimate.count), ''])
        rows.push([nr, q.text, KIND_LABELS[q.kind], `Durchschnitt: ${formatNumber(q.estimate.mean)}${unit}`, String(q.estimate.count), ''])
      }
    } else if (q.kind === 'TEXT') {
      for (const a of q.answers.filter(a => a.isCorrect)) rows.push([nr, q.text, KIND_LABELS[q.kind], `richtig: ${a.label}`, '', 'ja'])
      for (const w of q.textAnswers) rows.push([nr, q.text, KIND_LABELS[q.kind], w.text, String(w.count), w.correct ? (w.judged ? 'ja (gewertet)' : 'ja') : ''])
    } else {
      for (const w of q.words) rows.push([nr, q.text, KIND_LABELS[q.kind], w.text, String(w.count), ''])
    }
  }

  if (standings.length > 0 && questions.some(q => q.quiz)) {
    rows.push([], ['Platz', 'Spitzname', 'Punkte'], ...standings.map(s => [String(s.rank), s.nickname, String(s.score)]))
  }

  rows.push([], ['Spitzname', 'Nr', 'Frage', 'Antwort', 'Richtig', 'Punkte', 'Antwortzeit (s)', 'Ausgeblendet'])
  for (const [i, q] of questions.entries()) {
    for (const r of [...q.responses].sort((a, b) => a.player.nickname.localeCompare(b.player.nickname, 'de'))) {
      rows.push([
        r.player.nickname, String(i + 1), q.text, describeResponse(q, r),
        q.quiz ? (isCorrectResponse(q, r) ? 'ja' : 'nein') : '', String(r.points),
        (r.elapsedMs / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }), r.hidden ? 'ja' : ''
      ])
    }
  }

  return csvResponse(rows, `live-runde-${session.id}.csv`)
}
