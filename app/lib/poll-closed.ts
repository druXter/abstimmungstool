// app/lib/poll-closed.ts
import { prisma } from './prisma'
import { baseUrl } from './base-url'
import { isMailConfigured, sendPollResultEmail } from './mail'
import { notifyRsvpAppOfResult } from './rsvp-notify'
import { formatScore, loadResult, type PollResult } from './results'

/** Eine Zeile Zusammenfassung für Mail und Seiten: Gewinner, Gleichstand oder nicht beschlussfähig. */
export function resultSummary(result: PollResult): string {
  if (!result.quorumMet) return `Nicht beschlussfähig: ${result.voters} von mindestens ${result.quorum} Teilnehmenden.`
  if (result.winners.length === 0) return 'Es wurde keine Stimme abgegeben.'
  const names = result.winners.map(w => `"${w.label}"`).join(', ')
  return result.winners.length > 1 ? `Gleichstand zwischen ${names}.` : `Ergebnis: ${names}.`
}

/**
 * Alles, was nach dem Schließen einer Abstimmung passiert - vom manuellen closePoll
 * (app/actions.ts) und vom Cron (app/api/cron/close-expired-polls) gleichermaßen aufgerufen:
 * Ergebnis an rsvp-app melden und, falls gewünscht, an das besitzende Konto mailen. Beides
 * best-effort: Ein Fehler darf das Schließen selbst nie rückgängig machen oder verhindern.
 */
export async function afterPollClosed(pollId: string): Promise<void> {
  await notifyRsvpAppOfResult(pollId).catch(() => {})
  await notifyOwnerOfResult(pollId).catch(error => console.error('Ergebnis-Mail fehlgeschlagen:', error))
}

async function notifyOwnerOfResult(pollId: string): Promise<void> {
  if (!isMailConfigured()) return
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { id: true, notifyOwnerOnClose: true, owner: { select: { email: true } } }
  })
  // Alt-Abstimmungen ohne Konto bekommen nichts: Ihr Verwaltungslink hängt am creatorToken,
  // den eine Mail nicht im Klartext verschicken soll.
  if (!poll || !poll.notifyOwnerOnClose || !poll.owner) return

  const result = await loadResult(poll.id)
  if (!result) return
  await sendPollResultEmail(
    poll.owner.email,
    {
      title: result.poll.title,
      summary: resultSummary(result),
      lines: [
        ...result.options.map(o => `${o.label}: ${formatScore(result.pollType, o)}`),
        `Teilnehmende: ${result.voters}`
      ]
    },
    `${baseUrl()}/${poll.id}/verwalten`
  )
}
