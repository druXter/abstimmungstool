// app/[pollId]/verwalten/export/route.ts
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { getPollLevel } from '../../../lib/permissions'
import { loadResult } from '../../../lib/results'
import { resultSummary } from '../../../lib/poll-closed'

/**
 * CSV-Export der Ergebnisse für alle, die die Abstimmung verwalten dürfen (dieselbe Prüfung
 * wie die Verwaltungsseite, bei Alt-Abstimmungen mit ?token=). Semikolon und UTF-8 mit BOM,
 * damit ein deutsches Excel die Datei ohne Import-Assistenten richtig öffnet.
 *
 * Teil 1: Zählstand pro Option. Teil 2 (nur wenn Stimmen Namen tragen, also nicht im
 * Cookie-Modus ohne Pflichtnamen und nicht bei geheimer Wahl): wer was gewählt hat - das
 * sieht die Verwaltung ohnehin auf ihrer Seite.
 */
export async function GET(request: Request, { params }: { params: Promise<{ pollId: string }> }) {
  const { pollId } = await params
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, select: { id: true, ownerId: true, creatorToken: true, title: true } })
  if (!poll) return new Response('Not found', { status: 404 })

  const token = new URL(request.url).searchParams.get('token')
  const level = await getPollLevel(poll, { user: await getCurrentUser(), token })
  if (!level) return new Response('Not found', { status: 404 })

  const result = await loadResult(poll.id)
  if (!result) return new Response('Not found', { status: 404 })

  const rows: string[][] = [
    ['Abstimmung', poll.title],
    ['Teilnehmende', String(result.voters)],
    ...(result.quorum !== null ? [['Mindestbeteiligung', String(result.quorum)]] : []),
    ['Ergebnis', resultSummary(result)],
    [],
    ['Option', 'Stimmen', 'Anteil der Teilnehmenden'],
    ...result.options.map(o => [o.label, String(o.votes), result.voters > 0 ? `${Math.round((o.votes / result.voters) * 100)} %` : '0 %'])
  ]

  const named = await prisma.vote.findMany({
    where: { pollId: poll.id, voterName: { not: null } },
    select: { voterName: true, option: { select: { label: true, position: true } } },
    orderBy: [{ voterName: 'asc' }, { option: { position: 'asc' } }]
  })
  if (named.length > 0) {
    rows.push([], ['Name', 'Option'], ...named.map(v => [v.voterName ?? '', v.option.label]))
  }

  const csv = '﻿' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n'
  const filename = `abstimmung-${poll.id}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  })
}

/**
 * Ein CSV-Feld: in Anführungszeichen, innere verdoppelt. Werte, die mit = + - @ (oder Tab/CR)
 * beginnen, bekommen ein Apostroph vorangestellt - Namen und Optionen sind frei eingegeben,
 * und Tabellenprogramme würden sie sonst als Formel ausführen (CSV-Injection).
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}
