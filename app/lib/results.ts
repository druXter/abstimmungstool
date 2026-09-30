// app/lib/results.ts
import { prisma } from './prisma'

/**
 * Die Auswertung einer Abstimmung an EINER Stelle - Abstimmungs- und Verwaltungsseite,
 * CSV-Export, Ergebnis-Mail und die Meldung an rsvp-app rechnen alle hiermit.
 *
 * Gewinner = alle Optionen mit der höchsten Stimmenzahl (mehrere bei Gleichstand, keine bei
 * 0 Stimmen). Teilnehmende = verschiedene voterKeys, nicht die Summe der Options-Stimmen
 * (bei Mehrfachauswahl zählt eine Person mehrfach, siehe app/[pollId]/poll-results.tsx).
 */

export type OptionCount = { id: string; label: string; votes: number }

export type PollResult = {
  options: OptionCount[]
  winners: OptionCount[]
  voters: number
  quorum: number | null
  /** false = Mindestbeteiligung verfehlt, das Ergebnis ist "nicht beschlussfähig". */
  quorumMet: boolean
}

export function summarize(options: OptionCount[], voters: number, quorum: number | null): PollResult {
  const maxVotes = Math.max(0, ...options.map(o => o.votes))
  return {
    options,
    winners: maxVotes > 0 ? options.filter(o => o.votes === maxVotes) : [],
    voters,
    quorum,
    quorumMet: quorum === null || voters >= quorum
  }
}

/** Lädt Zählstände und Teilnehmendenzahl einer Abstimmung frisch aus der Datenbank. */
export async function loadResult(pollId: string): Promise<(PollResult & { poll: { id: string; title: string } }) | null> {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: {
      id: true, title: true, quorum: true,
      options: { where: { approved: true }, orderBy: { position: 'asc' }, select: { id: true, label: true, _count: { select: { votes: true } } } }
    }
  })
  if (!poll) return null
  const voters = (await prisma.vote.groupBy({ by: ['voterKey'], where: { pollId } })).length
  const options = poll.options.map(o => ({ id: o.id, label: o.label, votes: o._count.votes }))
  return { ...summarize(options, voters, poll.quorum), poll: { id: poll.id, title: poll.title } }
}

/**
 * Wirksame Grenzen einer Mehrfachauswahl. Gelöschte Optionen könnten ein gespeichertes
 * Minimum unerfüllbar machen - deshalb nie mehr verlangen, als es Optionen gibt.
 */
export function choiceLimits(poll: { minChoices: number | null; maxChoices: number | null; options: unknown[] }): { min: number; max: number } {
  const count = poll.options.length
  return { min: Math.min(poll.minChoices ?? 1, count), max: Math.min(poll.maxChoices ?? count, count) }
}

/** Darf die öffentliche Seite das Ergebnis gerade zeigen? (Poll.resultsVisibility) */
export function resultsVisible(visibility: 'ALWAYS' | 'AFTER_VOTE' | 'AFTER_CLOSE' | 'MANAGERS', state: { hasVoted: boolean; closed: boolean }): boolean {
  switch (visibility) {
    case 'ALWAYS': return true
    case 'AFTER_VOTE': return state.hasVoted || state.closed
    case 'AFTER_CLOSE': return state.closed
    case 'MANAGERS': return false
  }
}
