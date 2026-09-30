// app/api/cron/close-expired-polls/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { safeEqual } from '../../../lib/permissions'
import { afterPollClosed } from '../../../lib/poll-closed'

/**
 * Automatischer Cron-Endpoint, gleiches Muster wie rsvp-apps /api/cron/reminders -
 * von einem externen Scheduler (Uptime Kuma) periodisch aufgerufen. Schließt jede
 * Abstimmung, deren closesAt erreicht ist, aber die noch niemand manuell geschlossen
 * hat, und löst danach dasselbe aus wie das manuelle Schließen (Meldung an rsvp-app,
 * ggf. Ergebnis-Mail - siehe app/lib/poll-closed.ts).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')
  const expected = process.env.CRON_SECRET

  // Ein leeres/fehlendes CRON_SECRET (z.B. der leere Platzhalter aus .env.example) darf den
  // Endpunkt NICHT freischalten - sonst würde "?secret=" (ebenfalls leer) den Vergleich bestehen.
  if (!expected || !secret || !safeEqual(secret, expected)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const now = new Date()
  const expired = await prisma.poll.findMany({
    where: { closedAt: null, closesAt: { not: null, lt: now } },
    select: { id: true }
  })

  let closedCount = 0
  for (const poll of expired) {
    // Wie closePoll: nur schließen (und melden), wenn nicht gerade jemand anderes schneller war.
    const closed = await prisma.poll.updateMany({ where: { id: poll.id, closedAt: null }, data: { closedAt: now } })
    if (closed.count === 0) continue
    closedCount++
    await afterPollClosed(poll.id)
  }

  return NextResponse.json({ success: true, closedCount })
}
