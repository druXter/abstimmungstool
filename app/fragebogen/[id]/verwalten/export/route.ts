import { prisma } from '../../../../lib/prisma'
import { getCurrentUser } from '../../../../lib/auth'
import { csvResponse } from '../../../../lib/csv'
import {
  csvColumns, formatDecimal, getSurveyLevel, gridKey, isGrid, isQuestion, KIND_LABELS, loadSurveyResults, questionNumbers, scaleCenter, scaleRange,
  scaleRowLabel
} from '../../../../lib/survey'

/**
 * CSV-Export eines Fragebogens für alle, die ihn verwalten dürfen (getSurveyLevel): oben die Auswertung je Frage,
 * darunter jede Abgabe als Zeile mit einer Spalte je Frage (Mehrfachauswahl durch Komma getrennt, Raster als
 * "Zeile: Spalte; Zeile: Spalte", Skalen-Raster mit einer Spalte je Zeile). Überschrift/Text-Blöcke fehlen. Gleiches Format
 * wie die anderen Exporte (app/lib/csv.ts, mit Schutz vor CSV-Injection - Freitexte sind frei eingegeben).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const survey = await prisma.survey.findUnique({ where: { id }, select: { id: true, ownerId: true, title: true, numbered: true } })
  if (!survey || !(await getSurveyLevel(await getCurrentUser(), survey))) return new Response('Not found', { status: 404 })

  const { questions, responses } = await loadSurveyResults(id)
  const rows: string[][] = [['Fragebogen', survey.title], ['Antworten', String(responses.length)], []]

  rows.push(['Nr', 'Frage', 'Art', 'Antwort / Wert', 'Anzahl', 'Anteil'])
  const { shown, group } = questionNumbers(questions, survey.numbered)
  const numberOf = (id: string) => shown.get(id) ?? group.get(id)
  for (const q of questions.filter(q => isQuestion(q.kind))) {
    const nr = String(numberOf(q.id) ?? '')
    const share = (count: number) => (q.answered > 0 ? `${Math.round((count / q.answered) * 100)} %` : '')
    if (isGrid(q.kind)) {
      // Je Feld "Zeile: Spalte", Anteil an den Antwortenden dieser Zeile.
      for (const row of q.rows) {
        const answered = q.rowAnswered.get(row.id) ?? 0
        for (const c of q.columns) {
          const count = q.counts.get(gridKey(row.id, c.id)) ?? 0
          rows.push([nr, q.text, KIND_LABELS[q.kind], `${row.label}: ${c.label}`, String(count), answered > 0 ? `${Math.round((count / answered) * 100)} %` : ''])
        }
      }
    } else if (q.kind === 'SINGLE' || q.kind === 'MULTI') {
      for (const o of q.columns) rows.push([nr, q.text, KIND_LABELS[q.kind], o.label, String(q.counts.get(o.id) ?? 0), share(q.counts.get(o.id) ?? 0)])
    } else if (q.kind === 'SCALE_GRID') {
      // Je Zeile Mittelwert (und zentriert: minus Skalenmitte, beim UEQ-S -3 bis +3), am Ende über alle Zeilen.
      const center = scaleCenter(scaleRange(q))
      const line = (label: string, stats: typeof q.scale) => stats
        ? [nr, q.text, KIND_LABELS[q.kind], `${label}: Durchschnitt ${formatDecimal(stats.mean)} (zentriert ${formatDecimal(stats.mean - center)})`, String(stats.count), '']
        : [nr, q.text, KIND_LABELS[q.kind], `${label}: keine Antwort`, '0', '']
      for (const row of q.rows) {
        rows.push(line(scaleRowLabel(row), q.rowScale.get(row.id) ?? null))
        // Ausweich-Antwort je Zeile getrennt gezählt, nicht im Mittelwert.
        if (q.optOutLabel) rows.push([nr, q.text, KIND_LABELS[q.kind], `${scaleRowLabel(row)}: ${q.optOutLabel}`, String(q.rowOptOut.get(row.id) ?? 0), ''])
      }
      rows.push(line('Gesamt', q.scale))
    } else if (q.kind === 'SCALE' && q.scale) {
      for (const d of q.scale.distribution) rows.push([nr, q.text, KIND_LABELS[q.kind], String(d.value), String(d.count), share(d.count)])
      rows.push([nr, q.text, KIND_LABELS[q.kind], `Durchschnitt: ${formatDecimal(q.scale.mean)}`, String(q.scale.count), ''])
      rows.push([nr, q.text, KIND_LABELS[q.kind], `Median: ${formatDecimal(q.scale.median)}`, String(q.scale.count), ''])
    } else if (q.kind === 'TEXT') {
      rows.push([nr, q.text, KIND_LABELS[q.kind], '(einzelne Antworten unten)', String(q.answered), ''])
    }
  }

  // Eine Spalte je Frage, beim Skalen-Raster eine je Zeile (Auswertung je Item, z.B. UEQ-S in der offiziellen Tabelle).
  const columns = questions.flatMap(q => csvColumns(q).map(c => ({ ...c, header: `${numberOf(q.id) ? `${numberOf(q.id)}. ` : ''}${c.header}` })))
  rows.push([], ['Abgegeben', 'Zuletzt geändert', ...columns.map(c => c.header)])
  const at = (d: Date) => d.toLocaleString('de-DE')
  for (const r of responses) {
    rows.push([at(r.createdAt), r.updatedAt.getTime() - r.createdAt.getTime() > 1000 ? at(r.updatedAt) : '', ...columns.map(c => c.value(r.answers))])
  }

  return csvResponse(rows, `fragebogen-${survey.id}.csv`)
}
