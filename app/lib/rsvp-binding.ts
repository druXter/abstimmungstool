// app/lib/rsvp-binding.ts
import { prisma } from './prisma'

/**
 * Bindung einer Abstimmung an EINEN Termin in rsvp-app (Poll.rsvpEventId). Klick-Token (`poll-access`) und Zu-/Absage
 * (`poll-attendance`) tragen die `eventId` des Termins, der sie ausstellt. Den Abstimmungs-Link trägt dort die
 * Verwaltung des Termins frei ein - zugestimmt hat damit nur sie, nie, wem die Abstimmung gehört. Ohne Bindung könnte
 * jede Verwaltung eines beliebigen Termins Nachweise für fremde Abstimmungen ausstellen (Stimmen abgeben, per Absage
 * Stimmen löschen) und die Ergebnis-Meldung auf ihren Termin umlenken (rsvp-app docs/AUDIT-2026-11.md, R-02/R-04).
 *
 * Der erste Termin, der eine Stimme abgibt oder eine Zu-/Absage meldet, bindet die Abstimmung (bedingtes Update, auch
 * bei gleichzeitigen Anfragen genau einer). Danach gilt nur noch dieser Termin; lösen kann die Bindung, wer die
 * Abstimmung besitzt (unlinkRsvpEvent in app/actions.ts) - dann bindet der nächste Termin.
 *
 * `bind: false` (bloßes Anzeigen): bindet nicht, eine ungebundene Abstimmung gilt als passend.
 */
export async function matchesRsvpEvent(pollId: string, eventId: string, { bind }: { bind: boolean }): Promise<boolean> {
  if (bind) await prisma.poll.updateMany({ where: { id: pollId, rsvpEventId: null }, data: { rsvpEventId: eventId } })
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, select: { rsvpEventId: true } })
  if (!poll) return false
  return poll.rsvpEventId === null ? !bind : poll.rsvpEventId === eventId
}
