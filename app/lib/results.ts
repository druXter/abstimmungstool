// app/lib/results.ts
import type { PollType } from '@prisma/client'
import { prisma } from './prisma'
import { ANSWER_VALUES } from './poll-types'

/**
 * Die Auswertung einer Abstimmung an EINER Stelle - Abstimmungs- und Verwaltungsseite,
 * CSV-Export, Ergebnis-Mail und die Meldung an rsvp-app rechnen alle hiermit.
 *
 * Gewinner = alle Optionen mit dem höchsten score (mehrere bei Gleichstand, keine ohne
 * Stimmen), score je Art siehe evaluate. Teilnehmende = verschiedene voterKeys, nicht die
 * Summe der Options-Stimmen (bei Mehrfachauswahl zählt eine Person mehrfach).
 */

export type OptionCount = {
  id: string
  label: string
  /** Personen, die die Option unterstützen: gewählt, mit Ja geantwortet, eingeordnet bzw. Punkte gegeben. */
  votes: number
  /** Wonach der Gewinner bestimmt wird (je Art, siehe evaluate). Bei CHOICE = votes. */
  score: number
  /** Nur YES_MAYBE_NO: Antworten je Kategorie. */
  answers?: { yes: number; maybe: number; no: number }
}

export type PollResult = {
  pollType: PollType
  options: OptionCount[]
  winners: OptionCount[]
  voters: number
  quorum: number | null
  /** false = Mindestbeteiligung verfehlt, das Ergebnis ist "nicht beschlussfähig". */
  quorumMet: boolean
}

/** Stimmen-Zeilen gruppiert nach Option und Wert (prisma.vote.groupBy). */
export type ValueCount = { optionId: string; value: number; count: number }

/**
 * Wertet eine Abstimmung je Art aus (Bedeutung von Vote.value siehe PollType in schema.prisma):
 * - CHOICE:       score = Anzahl Stimmen
 * - YES_MAYBE_NO: score = 2 x Ja + 1 x Vielleicht (Vielleicht zählt halb), votes = Ja
 * - RANKING:      Borda - Platz p von n Optionen bringt n - p Punkte (Platz 1: n - 1). Nicht
 *                 eingeordnete Optionen bekommen nichts. n ist die Zahl der Optionen JETZT;
 *                 wurden seither welche ergänzt, zählen alle Plätze entsprechend mehr - die
 *                 Reihenfolge bleibt gleich.
 * - POINTS:       score = Summe der Punkte
 */
export function evaluate(pollType: PollType, options: { id: string; label: string }[], counts: ValueCount[], voters: number, quorum: number | null): PollResult {
  const n = options.length
  const evaluated: OptionCount[] = options.map(option => {
    const rows = counts.filter(c => c.optionId === option.id)
    const sum = (pick: (value: number) => number) => rows.reduce((total, row) => total + row.count * pick(row.value), 0)
    switch (pollType) {
      case 'CHOICE': {
        const votes = sum(() => 1)
        return { id: option.id, label: option.label, votes, score: votes }
      }
      case 'YES_MAYBE_NO': {
        const answers = {
          yes: sum(v => (v === ANSWER_VALUES.yes ? 1 : 0)),
          maybe: sum(v => (v === ANSWER_VALUES.maybe ? 1 : 0)),
          no: sum(v => (v === ANSWER_VALUES.no ? 1 : 0))
        }
        return { id: option.id, label: option.label, votes: answers.yes, score: 2 * answers.yes + answers.maybe, answers }
      }
      case 'RANKING':
        return { id: option.id, label: option.label, votes: sum(() => 1), score: sum(v => Math.max(n - v, 0)) }
      case 'POINTS':
        return { id: option.id, label: option.label, votes: sum(() => 1), score: sum(v => v) }
    }
  })
  const maxScore = Math.max(0, ...evaluated.map(o => o.score))
  return {
    pollType,
    options: evaluated,
    winners: maxScore > 0 ? evaluated.filter(o => o.score === maxScore) : [],
    voters,
    quorum,
    quorumMet: quorum === null || voters >= quorum
  }
}

/** Lädt Zählstände und Teilnehmendenzahl einer Abstimmung frisch aus der Datenbank (nur freigegebene Optionen). */
export async function loadResult(pollId: string): Promise<(PollResult & { poll: { id: string; title: string } }) | null> {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: {
      id: true, title: true, quorum: true, pollType: true,
      options: { where: { approved: true }, orderBy: { position: 'asc' }, select: { id: true, label: true } }
    }
  })
  if (!poll) return null
  const [grouped, voterKeys] = await Promise.all([
    prisma.vote.groupBy({ by: ['optionId', 'value'], where: { pollId }, _count: { _all: true } }),
    prisma.vote.groupBy({ by: ['voterKey'], where: { pollId } })
  ])
  const counts = grouped.map(g => ({ optionId: g.optionId, value: g.value, count: g._count._all }))
  return { ...evaluate(poll.pollType, poll.options, counts, voterKeys.length, poll.quorum), poll: { id: poll.id, title: poll.title } }
}

/** Wer was gewählt hat, je Option - nur Stimmen mit Namen (siehe Vote.voterName), für die namentliche Anzeige. */
export async function loadVoterNames(pollId: string): Promise<Record<string, { name: string; value: number }[]>> {
  const votes = await prisma.vote.findMany({
    where: { pollId, voterName: { not: null } },
    select: { optionId: true, voterName: true, value: true },
    orderBy: [{ value: 'asc' }, { voterName: 'asc' }]
  })
  const byOption: Record<string, { name: string; value: number }[]> = {}
  for (const vote of votes) (byOption[vote.optionId] ??= []).push({ name: vote.voterName!, value: vote.value })
  return byOption
}

/** Punkte bzw. Stimmen einer Option als Text, passend zur Art. */
export function formatScore(pollType: PollType, option: OptionCount): string {
  switch (pollType) {
    case 'CHOICE': return `${option.votes} Stimme${option.votes === 1 ? '' : 'n'}`
    case 'YES_MAYBE_NO': return `${option.answers!.yes} ja, ${option.answers!.maybe} vielleicht, ${option.answers!.no} nein`
    case 'RANKING': return `${option.score} Borda-Punkt${option.score === 1 ? '' : 'e'}`
    case 'POINTS': return `${option.score} Punkt${option.score === 1 ? '' : 'e'}`
  }
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
