// app/lib/poll-types.ts
import type { PollType } from '@prisma/client'

/**
 * Abstimmungsarten (Poll.pollType, siehe schema.prisma): was eine Stimmabgabe je Art
 * bedeutet und wie das Formular gelesen wird. Die Auswertung liegt in app/lib/results.ts.
 */

export const POLL_TYPES: readonly PollType[] = ['CHOICE', 'YES_MAYBE_NO', 'RANKING', 'POINTS']

export const POLL_TYPE_LABELS: Record<PollType, { title: string; text: string }> = {
  CHOICE: { title: 'Auswahl', text: 'Eine Option wählen - oder mehrere, wenn Mehrfachauswahl erlaubt ist.' },
  YES_MAYBE_NO: { title: 'Ja / Vielleicht / Nein', text: 'Zu jeder Option antworten (wie bei Doodle). Gewinner: die meisten Ja, Vielleicht zählt halb.' },
  RANKING: { title: 'Rangfolge', text: 'Optionen nach Vorliebe ordnen. Auswertung nach Borda: Platz 1 von n Optionen bringt n-1 Punkte, Platz 2 n-2 usw.' },
  POINTS: { title: 'Punkte verteilen', text: 'Jede Person verteilt ein festes Punktebudget beliebig auf die Optionen.' }
}

/** Vote.value bei YES_MAYBE_NO. Nein wird mitgespeichert, damit sichtbar ist, wer geantwortet hat. */
export const ANSWER_VALUES = { yes: 2, maybe: 1, no: 0 } as const
export type Answer = keyof typeof ANSWER_VALUES

export const DEFAULT_POINTS_BUDGET = 10
export const MAX_POINTS_BUDGET = 1000

export function parsePollType(value: FormDataEntryValue | null): PollType {
  return POLL_TYPES.find(type => type === value) ?? 'CHOICE'
}

export type BallotEntry = { optionId: string; value: number }

/**
 * Ergebnis des Formular-Lesens: die zu speichernden Einträge - oder eine Ablehnung. `notice`
 * ist der Hinweis für ?hinweis= (siehe app/[pollId]/page.tsx); null heißt "still ignorieren",
 * weil die Oberfläche so etwas gar nicht erst anbietet (z.B. leeres Formular).
 */
export type BallotResult = { ok: true; entries: BallotEntry[] } | { ok: false; notice: string | null }

type BallotPoll = {
  pollType: PollType
  allowMultipleChoices: boolean
  pointsBudget: number | null
  options: { id: string }[]
}

function intField(formData: FormData, name: string): number | null {
  const raw = formData.get(name)
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isInteger(value) ? value : null
}

/**
 * Liest eine Stimmabgabe aus dem Formular - nur für Optionen dieser Abstimmung (manipulierte
 * IDs fallen weg, weil nur über `poll.options` gelesen wird). Grenzen bei der Mehrfachauswahl
 * prüft `limits` (siehe choiceLimits in app/lib/results.ts).
 */
export function parseBallot(poll: BallotPoll, formData: FormData, limits: { min: number; max: number }): BallotResult {
  const optionIds = poll.options.map(o => o.id)

  switch (poll.pollType) {
    case 'CHOICE': {
      const wanted = new Set(formData.getAll('optionId').filter((v): v is string => typeof v === 'string'))
      let selected = optionIds.filter(id => wanted.has(id))
      if (selected.length === 0) return { ok: false, notice: null }
      // Einzelauswahl: serverseitig auf eine Option kappen, auch bei manipuliertem Formular.
      if (!poll.allowMultipleChoices) selected = [selected[0]]
      else if (selected.length < limits.min || selected.length > limits.max) return { ok: false, notice: 'auswahl' }
      return { ok: true, entries: selected.map(optionId => ({ optionId, value: 1 })) }
    }
    case 'YES_MAYBE_NO': {
      const entries: BallotEntry[] = []
      for (const optionId of optionIds) {
        const answer = formData.get(`answer_${optionId}`)
        if (answer === 'yes' || answer === 'maybe' || answer === 'no') entries.push({ optionId, value: ANSWER_VALUES[answer] })
      }
      return entries.length > 0 ? { ok: true, entries } : { ok: false, notice: null }
    }
    case 'RANKING': {
      const ranked: { optionId: string; rank: number }[] = []
      for (const optionId of optionIds) {
        const rank = intField(formData, `rank_${optionId}`)
        if (rank !== null && rank >= 1 && rank <= optionIds.length) ranked.push({ optionId, rank })
      }
      if (ranked.length === 0) return { ok: false, notice: null }
      if (new Set(ranked.map(r => r.rank)).size !== ranked.length) return { ok: false, notice: 'rangfolge' }
      // Lücken schließen (Plätze 1 und 3 -> 1 und 2), damit Borda nur die Reihenfolge wertet.
      ranked.sort((a, b) => a.rank - b.rank)
      return { ok: true, entries: ranked.map((r, i) => ({ optionId: r.optionId, value: i + 1 })) }
    }
    case 'POINTS': {
      const budget = poll.pointsBudget ?? DEFAULT_POINTS_BUDGET
      const entries: BallotEntry[] = []
      for (const optionId of optionIds) {
        const points = intField(formData, `points_${optionId}`)
        if (points === null || points === 0) continue
        if (points < 0 || points > budget) return { ok: false, notice: 'punkte' }
        entries.push({ optionId, value: points })
      }
      if (entries.length === 0) return { ok: false, notice: null }
      if (entries.reduce((sum, e) => sum + e.value, 0) > budget) return { ok: false, notice: 'punkte' }
      return { ok: true, entries }
    }
  }
}

/** Wie ein einzelner Wert in Namenslisten und im Export heißt ("ja", "Platz 2", "3 Punkte"). */
export function formatVoteValue(pollType: PollType, value: number): string {
  switch (pollType) {
    case 'CHOICE': return 'gewählt'
    case 'YES_MAYBE_NO': return value === ANSWER_VALUES.yes ? 'ja' : value === ANSWER_VALUES.maybe ? 'vielleicht' : 'nein'
    case 'RANKING': return `Platz ${value}`
    case 'POINTS': return `${value} Punkt${value === 1 ? '' : 'e'}`
  }
}
