// app/lib/poll-closed.ts
import { prisma } from './prisma'
import { baseUrl } from './base-url'
import { isMailConfigured, sendDecisionRequestEmail, sendPollResultEmail } from './mail'
import { needsDecision } from './final-date'
import { notifyRsvpAppOfResult } from './rsvp-notify'
import { sendPushToUser } from './push'
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
 * Ergebnis an rsvp-app melden und, falls gewünscht, dem besitzenden Konto mitteilen (Mail
 * und Push auf den Geräten, auf denen es Mitteilungen eingeschaltet hat) - bei einer
 * Terminabstimmung stattdessen die Bitte, den Termin festzulegen. Alles best-effort: Ein
 * Fehler darf das Schließen selbst nie rückgängig machen oder verhindern.
 */
export async function afterPollClosed(pollId: string): Promise<void> {
  await notifyRsvpAppOfResult(pollId).catch(() => {})
  await notifyOwnerOfResult(pollId).catch(error => console.error('Ergebnis-Mail fehlgeschlagen:', error))
}

async function notifyOwnerOfResult(pollId: string): Promise<void> {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: {
      id: true, notifyOwnerOnClose: true, confirmDate: true, optionKind: true, finalizedAt: true, closedAt: true,
      owner: { select: { id: true, email: true } }
    }
  })
  // Alt-Abstimmungen ohne Konto bekommen nichts: Ihr Verwaltungslink hängt am creatorToken,
  // den eine Mail nicht im Klartext verschicken soll.
  if (!poll || !poll.owner) return

  const result = await loadResult(poll.id)
  if (!result) return
  const link = `${baseUrl()}/${poll.id}/verwalten`

  // Terminabstimmung: Die Bitte zu bestätigen/entscheiden geht immer raus (sonst bliebe die
  // Festlegung liegen) - als Push, wenn ein Gerät Mitteilungen an hat, sonst als Mail. Sie
  // enthält das Ergebnis und ersetzt die normale Ergebnis-Mitteilung.
  if (needsDecision(poll, result)) {
    const tie = result.winners.length > 1
    const delivered = await sendPushToUser(poll.owner.id, {
      title: `${tie ? 'Termin entscheiden' : 'Termin bestätigen'}: ${result.poll.title}`,
      body: resultSummary(result),
      url: `/${poll.id}/verwalten`
    })
    if (delivered === 0 && isMailConfigured()) await sendDecisionRequestEmail(poll.owner.email, result.poll.title, resultSummary(result), link, tie)
    return
  }

  if (!poll.notifyOwnerOnClose) return
  await sendPushToUser(poll.owner.id, { title: `Abstimmung beendet: ${result.poll.title}`, body: resultSummary(result), url: `/${poll.id}/verwalten` })
  if (!isMailConfigured()) return
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
    link
  )
}
