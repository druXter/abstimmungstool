// app/lib/rsvp-notify.ts
import { prisma } from './prisma'
import { signResultWebhookPayload } from './rsvp-verification'

function rsvpAppBaseUrl(): string | null {
  const url = process.env.RSVP_APP_BASE_URL
  return url ? url.replace(/\/+$/, '') : null
}

/**
 * Meldet das Ergebnis einer geschlossenen Abstimmung an rsvp-app, damit es auf der
 * zugehörigen Event-Seite angezeigt werden kann (Gegenstück zu dessen
 * verifyResultWebhookPayload in app/lib/poll-verification.ts) - aufgerufen sowohl
 * vom manuellen closePoll (app/actions.ts) als auch vom automatischen
 * Schließen-Cronjob (app/api/cron/close-expired-polls/route.ts).
 *
 * No-op ohne poll.rsvpEventId (noch nie ein rsvp-webhook für diese Abstimmung
 * empfangen, siehe app/api/rsvp-webhook/route.ts - z.B. weil requireRsvpVerification
 * nie genutzt wurde) oder ohne konfiguriertes RSVP_APP_BASE_URL/
 * RSVP_VERIFICATION_SECRET. Gewinner = alle Optionen mit der höchsten Stimmenzahl
 * (kann mehrere sein bei Gleichstand, oder keine bei 0 Stimmen insgesamt). Bewusst
 * best-effort mit kurzem Timeout, wie das Gegenstück in rsvp-app - ein nicht
 * erreichbares rsvp-app darf das Schließen der Abstimmung selbst nie verhindern.
 */
export async function notifyRsvpAppOfResult(pollId: string): Promise<void> {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: { options: { include: { _count: { select: { votes: true } } } } }
  })
  if (!poll || !poll.rsvpEventId || !poll.closedAt) return

  const base = rsvpAppBaseUrl()
  if (!base) return

  const maxVotes = Math.max(0, ...poll.options.map(o => o._count.votes))
  const winners = maxVotes > 0
    ? poll.options.filter(o => o._count.votes === maxVotes).map(o => ({ label: o.label, votes: o._count.votes }))
    : []

  const signed = signResultWebhookPayload({
    eventId: poll.rsvpEventId,
    pollId: poll.id,
    pollTitle: poll.title,
    winners,
    closedAt: poll.closedAt.toISOString()
  })
  if (!signed) return

  try {
    await fetch(`${base}/api/poll-result-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: signed,
      signal: AbortSignal.timeout(5000)
    })
  } catch {
    // Best-effort - siehe Doku-Kommentar oben.
  }
}
