// app/api/rsvp-poll-link/route.ts
import { NextResponse } from 'next/server'
import { readLimitedText } from 'suite-kit/web'
import { prisma } from '../../lib/prisma'
import { verifyPollLink } from '../../lib/rsvp-verification'
import { bindRsvpEvent, isOwnersEvent, rememberCandidate } from '../../lib/rsvp-binding'

/**
 * Ein Termin in rsvp-app hat den Link dieser Abstimmung gespeichert (`poll-link`, Gegenstück dort:
 * announcePollLink in app/lib/poll-notify.ts). Nur für Abstimmungen im Modus RSVP ohne Sitzung (alle anderen brauchen
 * keine Bindung, die Meldung wird ignoriert):
 * - schon an diesen Termin gebunden: neuer Titel,
 * - noch frei und der Termin gehört dem über den Verbund verknüpften Konto der Besitzerin: bindet,
 * - sonst: als Kandidat vormerken, die Besitzerin bestätigt ihn auf der Verwaltungsseite (docs/AUDIT-2026-11.md, V-01 b).
 * Antwortet immer gleich (außer bei unbekannter Abstimmung) - rsvp-app speichert den Link in jedem Fall.
 */
const MAX_BODY = 10_000

export async function POST(request: Request) {
  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return NextResponse.json({ ok: false, error: 'too large' }, { status: 413 })
  const message = verifyPollLink(body)
  if (!message) return NextResponse.json({ ok: false, error: 'invalid' }, { status: 401 })

  const poll = await prisma.poll.findUnique({
    where: { id: message.pollId }, select: { id: true, ownerId: true, voterIdentity: true, assemblyId: true, rsvpEventId: true }
  })
  if (!poll) return NextResponse.json({ ok: false, error: 'unknown' }, { status: 404 })
  if (poll.voterIdentity !== 'RSVP' || poll.assemblyId) return NextResponse.json({ ok: true, state: 'not-needed' })

  const title = message.eventTitle || null
  if (poll.rsvpEventId === message.eventId || (!poll.rsvpEventId && (await isOwnersEvent(poll.ownerId, message.owner)))) {
    if (await bindRsvpEvent(poll.id, message.eventId, title)) return NextResponse.json({ ok: true, state: 'linked' })
  }
  if (!poll.rsvpEventId) await rememberCandidate(poll.id, message.eventId, title)
  return NextResponse.json({ ok: true, state: 'pending' })
}
