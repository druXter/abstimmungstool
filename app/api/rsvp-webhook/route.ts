// app/api/rsvp-webhook/route.ts
import { NextResponse } from 'next/server'
import { readLimitedText } from 'suite-kit/web'
import { prisma } from '../../lib/prisma'
import { verifyRsvpWebhookPayload } from '../../lib/rsvp-verification'
import { voterKey } from '../../lib/voter-identity'

/**
 * Empfängt die aktive Zu-/Absage-Meldung von rsvp-app (Gegenstück zu dessen
 * notifyPollOfAttendanceChange in app/lib/poll-notify.ts) - der Body ist der
 * signierte Token selbst (text/plain, kein JSON-Umschlag nötig, siehe
 * verifyRsvpWebhookPayload für das Format).
 *
 * Bei attending=false wird eine bereits abgegebene Stimme dieser E-Mail für diesen
 * Poll sofort entfernt (alle Optionen, siehe Vote.@@unique) - das ist der einzige
 * Weg, wie eine Stimme aktiv verschwindet, ohne dass die Person die Abstimmung
 * selbst nochmal aufruft (der Klick-Token in rsvp-verification.ts löst das nur für
 * NEUE Stimmabgaben, nicht rückwirkend). Bei attending=true gibt es nichts zu
 * entfernen - eine neue Stimme entsteht erst durch einen tatsächlichen castVote-Aufruf
 * mit frischem, gültigem Token.
 *
 * Merkt sich außerdem beiläufig poll.rsvpEventId (falls noch nicht gesetzt), damit
 * beim Schließen dieser Abstimmung bekannt ist, welchem rsvp-app-Event das Ergebnis
 * gemeldet werden soll (siehe app/lib/rsvp-notify.ts).
 */
/** Größere Meldungen verschickt rsvp-app nie; alles darüber wird gar nicht erst gelesen. */
const MAX_BODY = 10_000

export async function POST(request: Request) {
  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return NextResponse.json({ error: 'too large' }, { status: 413 })
  const message = verifyRsvpWebhookPayload(body)
  if (!message) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const poll = await prisma.poll.findUnique({ where: { id: message.pollId } })
  if (!poll) {
    return NextResponse.json({ ok: true, note: 'poll not found, ignored' })
  }

  if (poll.rsvpEventId !== message.eventId) {
    await prisma.poll.update({ where: { id: poll.id }, data: { rsvpEventId: message.eventId } })
  }

  if (!message.attending) {
    await prisma.vote.deleteMany({ where: { pollId: poll.id, voterKey: voterKey('RSVP', message.email) } })
  }

  return NextResponse.json({ ok: true })
}
