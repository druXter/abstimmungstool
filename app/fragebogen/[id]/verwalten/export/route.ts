import { prisma } from '../../../../lib/prisma'
import { getCurrentUser } from '../../../../lib/auth'
import { csvResponse } from '../../../../lib/csv'
import { describeAnswer, formatDecimal, getSurveyLevel, KIND_LABELS, loadSurveyResults } from '../../../../lib/survey'

/**
 * CSV-Export eines Fragebogens für alle, die ihn verwalten dürfen (getSurveyLevel): oben die Auswertung je Frage,
 * darunter jede Abgabe als Zeile mit einer Spalte je Frage (Mehrfachauswahl durch Komma getrennt). Gleiches Format
 * wie die anderen Exporte (app/lib/csv.ts, mit Schutz vor CSV-Injection - Freitexte sind frei eingegeben).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const survey = await prisma.survey.findUnique({ where: { id }, select: { id: true, ownerId: true, title: true } })
  if (!survey || !(await getSurveyLevel(await getCurrentUser(), survey))) return new Response('Not found', { status: 404 })

  const { questions, responses } = await loadSurveyResults(id)
  const rows: string[][] = [['Fragebogen', survey.title], ['Antworten', String(responses.length)], []]

  rows.push(['Nr', 'Frage', 'Art', 'Antwort / Wert', 'Anzahl', 'Anteil'])
  for (const [i, q] of questions.entries()) {
    const nr = String(i + 1)
    const share = (count: number) => (q.answered > 0 ? `${Math.round((count / q.answered) * 100)} %` : '')
    if (q.kind === 'SINGLE' || q.kind === 'MULTI') {
      for (const o of q.options) rows.push([nr, q.text, KIND_LABELS[q.kind], o.label, String(q.counts.get(o.id) ?? 0), share(q.counts.get(o.id) ?? 0)])
    } else if (q.kind === 'SCALE' && q.scale) {
      for (const d of q.scale.distribution) rows.push([nr, q.text, KIND_LABELS[q.kind], String(d.value), String(d.count), share(d.count)])
      rows.push([nr, q.text, KIND_LABELS[q.kind], `Durchschnitt: ${formatDecimal(q.scale.mean)}`, String(q.scale.count), ''])
      rows.push([nr, q.text, KIND_LABELS[q.kind], `Median: ${formatDecimal(q.scale.median)}`, String(q.scale.count), ''])
    } else if (q.kind === 'TEXT') {
      rows.push([nr, q.text, KIND_LABELS[q.kind], '(einzelne Antworten unten)', String(q.answered), ''])
    }
  }

  rows.push([], ['Abgegeben', 'Zuletzt geändert', ...questions.map((q, i) => `${i + 1}. ${q.text}`)])
  const at = (d: Date) => d.toLocaleString('de-DE')
  for (const r of responses) {
    rows.push([at(r.createdAt), r.updatedAt.getTime() - r.createdAt.getTime() > 1000 ? at(r.updatedAt) : '', ...questions.map(q => describeAnswer(q, r.answers))])
  }

  return csvResponse(rows, `fragebogen-${survey.id}.csv`)
}
