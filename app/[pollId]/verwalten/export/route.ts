// app/[pollId]/verwalten/export/route.ts
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { getPollLevel } from '../../../lib/permissions'
import { loadResult, type PollResult } from '../../../lib/results'
import { formatVoteValue } from '../../../lib/poll-types'
import { resultSummary } from '../../../lib/poll-closed'
import { csvResponse } from '../../../lib/csv'

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
    ...optionTable(result)
  ]

  const named = await prisma.vote.findMany({
    where: { pollId: poll.id, voterName: { not: null } },
    select: { voterName: true, value: true, option: { select: { label: true, position: true } } },
    orderBy: [{ voterName: 'asc' }, { option: { position: 'asc' } }]
  })
  if (named.length > 0) {
    rows.push([], ['Name', 'Option', 'Angabe'], ...named.map(v => [v.voterName ?? '', v.option.label, formatVoteValue(result.pollType, v.value)]))
  }

  return csvResponse(rows, `abstimmung-${poll.id}.csv`)
}

/** Tabelle je Option, Spalten passend zur Art (siehe evaluate in app/lib/results.ts). */
function optionTable(result: PollResult): string[][] {
  const share = (n: number) => (result.voters > 0 ? `${Math.round((n / result.voters) * 100)} %` : '0 %')
  switch (result.pollType) {
    case 'CHOICE':
      return [['Option', 'Stimmen', 'Anteil der Teilnehmenden'], ...result.options.map(o => [o.label, String(o.votes), share(o.votes)])]
    case 'YES_MAYBE_NO':
      return [['Option', 'Ja', 'Vielleicht', 'Nein', 'Wertung (2 x Ja + Vielleicht)'],
        ...result.options.map(o => [o.label, String(o.answers!.yes), String(o.answers!.maybe), String(o.answers!.no), String(o.score)])]
    case 'RANKING':
      return [['Option', 'Borda-Punkte', 'Eingeordnet von'], ...result.options.map(o => [o.label, String(o.score), String(o.votes)])]
    case 'POINTS':
      return [['Option', 'Punkte', 'Punkte von'], ...result.options.map(o => [o.label, String(o.score), String(o.votes)])]
  }
}
