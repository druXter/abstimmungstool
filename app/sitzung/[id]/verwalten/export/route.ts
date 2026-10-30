import { csvResponse } from 'suite-kit/web'
import { prisma } from '../../../../lib/prisma'
import { getCurrentUser } from '../../../../lib/auth'
import { loadResult, loadVoterNames } from '../../../../lib/results'
import { getAssemblyLevel } from '../../../../lib/assembly'
import { OUTCOME_LABEL, verdictDetail, verdictFor } from '../../../../lib/majority'

/**
 * Beschlüsse einer Sitzung als CSV fürs Protokoll (docs/KONZEPT-SITZUNG.md): eine Zeile je Option jeder geschlossenen
 * Abstimmung, mit Zeitpunkt, Art, Stimmen, Zahl der Abstimmenden und der Anwesenden beim Schließen, beschlussfähig,
 * Ergebnis nach der Mehrheitsregel (Idee L33) und - nur bei namentlichen Abstimmungen - den Namen. Für alle, die die
 * Sitzung leiten dürfen.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assembly = await prisma.assembly.findUnique({ where: { id }, select: { id: true, ownerId: true, title: true } })
  if (!assembly || !(await getAssemblyLevel(await getCurrentUser(), assembly))) return new Response('Not found', { status: 404 })

  const polls = await prisma.poll.findMany({ where: { assemblyId: id, closedAt: { not: null } }, orderBy: { closedAt: 'asc' } })
  const time = (d: Date) => d.toLocaleString('de-DE', { timeZone: process.env.TZ || 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' })
  const rows: string[][] = [['Sitzung', assembly.title], [], ['Geschlossen', 'Abstimmung', 'Art', 'Option', 'Stimmen', 'Abgestimmt', 'Anwesend', 'Beschlussfähig', 'Ergebnis', 'Mehrheit', 'Namen']]
  for (const poll of polls) {
    const result = await loadResult(poll.id)
    if (!result) continue
    const names = poll.secretBallot ? {} : await loadVoterNames(poll.id)
    const quorum = poll.assemblyQuorumMet === null ? '' : poll.assemblyQuorumMet ? 'ja' : 'nein'
    const verdict = verdictFor(poll, result.options)
    for (const option of result.options) {
      rows.push([
        time(poll.closedAt!), poll.title, poll.secretBallot ? 'geheim' : 'namentlich', option.label, String(option.votes), String(result.voters),
        poll.assemblyPresent === null ? '' : String(poll.assemblyPresent), quorum,
        verdict ? OUTCOME_LABEL[verdict.outcome] : '', verdict ? verdictDetail(verdict) : '', (names[option.id] ?? []).map(n => n.name).join(', ')
      ])
    }
  }
  return csvResponse(rows, `beschluesse-${id}.csv`)
}
