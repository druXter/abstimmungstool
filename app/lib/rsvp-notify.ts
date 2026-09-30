// app/lib/rsvp-notify.ts
import { prisma } from './prisma'
import { signResultWebhookPayload } from './rsvp-verification'
import { loadResult } from './results'

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
 * empfangen, siehe app/api/rsvp-webhook/route.ts - z.B. weil der Modus RSVP nie
 * genutzt wurde) oder ohne konfiguriertes RSVP_APP_BASE_URL/
 * RSVP_VERIFICATION_SECRET. Gewinner siehe app/lib/results.ts. Ebenfalls no-op, wenn
 * die Mindestbeteiligung (Poll.quorum) verfehlt ist: rsvp-app kennt "nicht beschlussfähig"
 * noch nicht und würde eine leere Gewinnerliste als "keine Stimme abgegeben" anzeigen - und
 * bei Poll.resultsVisibility = MANAGERS, weil das Ergebnis dann nicht öffentlich ist. Bewusst
 * best-effort mit kurzem Timeout, wie das Gegenstück in rsvp-app - ein nicht
 * erreichbares rsvp-app darf das Schließen der Abstimmung selbst nie verhindern.
 */
export async function notifyRsvpAppOfResult(pollId: string): Promise<void> {
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, select: { id: true, title: true, rsvpEventId: true, closedAt: true, resultsVisibility: true } })
  // "Nur Verwaltung": Auf der Event-Seite in rsvp-app stünde das Ergebnis sonst öffentlich.
  if (!poll || !poll.rsvpEventId || !poll.closedAt || poll.resultsVisibility === 'MANAGERS') return

  const base = rsvpAppBaseUrl()
  if (!base) return

  const result = await loadResult(poll.id)
  if (!result || !result.quorumMet) return
  const winners = result.winners.map(o => ({ label: o.label, votes: o.votes }))

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
