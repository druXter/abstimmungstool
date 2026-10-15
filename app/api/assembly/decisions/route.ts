// app/api/assembly/decisions/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { loadResult, loadVoterNames } from '../../../lib/results'
import { signDecisions, verifyDecisionsRequest, type Decision } from '../../../lib/assembly-coupling'

export const dynamic = 'force-dynamic'

/** So viele Beschlüsse gehen höchstens heraus - für eine Sitzung mehr als genug. */
const MAX_DECISIONS = 200

/**
 * Beschlüsse einer Sitzung für das Protokoll im Zeitplan-Rückblick (docs/KONZEPT-SITZUNG.md, Nachricht
 * `assembly-decisions`): rsvp-app fragt signiert an, wenn der Termin die Beschlüsse freigibt. Geantwortet wird nur für
 * den Termin, mit dem die Sitzung verknüpft ist (sonst 404), mit Zeitpunkt, Ergebnis, Anwesenden und - nur bei
 * namentlichen Abstimmungen - den Namen. Laufende Abstimmungen gehen nicht heraus.
 */
export async function POST(request: Request) {
  const message = verifyDecisionsRequest((await request.text()).slice(0, 10_000))
  if (!message) return NextResponse.json({ ok: false, error: 'invalid' }, { status: 401 })

  const assembly = await prisma.assembly.findUnique({ where: { id: message.assemblyId }, select: { id: true, rsvpEventId: true } })
  if (!assembly || assembly.rsvpEventId !== message.eventId) return NextResponse.json({ ok: false, error: 'unknown' }, { status: 404 })

  const polls = await prisma.poll.findMany({
    where: { assemblyId: assembly.id, closedAt: { not: null } }, orderBy: { closedAt: 'asc' }, take: MAX_DECISIONS,
    select: { id: true, title: true, secretBallot: true, createdAt: true, closedAt: true, assemblyPresent: true, assemblyQuorumMet: true }
  })
  const decisions: Decision[] = []
  for (const poll of polls) {
    const result = await loadResult(poll.id)
    if (!result) continue
    const names = poll.secretBallot ? null : await loadVoterNames(poll.id)
    decisions.push({
      title: poll.title,
      secret: poll.secretBallot,
      openedAt: poll.createdAt.toISOString(),
      closedAt: poll.closedAt!.toISOString(),
      voters: result.voters,
      present: poll.assemblyPresent,
      quorumMet: poll.assemblyQuorumMet,
      options: result.options.map(o => ({ label: o.label, votes: o.votes, ...(names ? { names: (names[o.id] ?? []).map(n => n.name) } : {}) }))
    })
  }
  const reply = signDecisions(assembly.id, message.eventId, decisions)
  if (!reply) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 404 })
  return new Response(reply, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}
