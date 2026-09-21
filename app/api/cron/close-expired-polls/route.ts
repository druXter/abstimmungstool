// app/api/cron/close-expired-polls/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { safeEqual } from '../../../lib/permissions'
import { notifyRsvpAppOfResult } from '../../../lib/rsvp-notify'

/**
 * Automatischer Cron-Endpoint, gleiches Muster wie rsvp-apps /api/cron/reminders -
 * von einem externen Scheduler (Uptime Kuma) periodisch aufgerufen. Schließt jede
 * Abstimmung, deren closesAt erreicht ist, aber die noch niemand manuell geschlossen
 * hat, und löst danach dieselbe Ergebnis-Meldung an rsvp-app aus wie das manuelle
 * Schließen (siehe app/actions.ts closePoll).
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
    where: { closedAt: null, closesAt: { not: null, lt: now } }
  })

  for (const poll of expired) {
    await prisma.poll.update({ where: { id: poll.id }, data: { closedAt: now } })
    await notifyRsvpAppOfResult(poll.id)
  }

  return NextResponse.json({ success: true, closedCount: expired.length })
}
