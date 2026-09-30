// app/[pollId]/poll-results.tsx
import type { PollResult } from '../lib/results'
import { ANSWER_VALUES, formatVoteValue } from '../lib/poll-types'

/**
 * Geteilte Ergebnis-Darstellung für die öffentliche Abstimmungsseite und die
 * Verwaltungsseite, je nach Art (Poll.pollType, Auswertung in app/lib/results.ts):
 *
 * - Auswahl: Stimmen und Anteil. Der Prozentwert bezieht sich bewusst auf die Zahl
 *   abstimmender PERSONEN, nicht auf die Summe der Options-Stimmen - bei Mehrfachauswahl
 *   kann die Summe daher über 100% liegen ("X% der Teilnehmenden haben diese Option gewählt").
 * - Ja/Vielleicht/Nein: Antworten je Kategorie, Balken Ja (voll) + Vielleicht (hell).
 * - Rangfolge und Punkte: score, Balken relativ zur besten Option.
 *
 * `names` (nur bei showVoterNames bzw. für die Verwaltung) zeigt pro Option, wer wie
 * gestimmt hat (Vote.voterName). Stimmen ohne Namen (Cookie-Modus) fehlen dort, zählen aber mit.
 */
export default function PollResults({
  result,
  names = {},
  myVotes = {},
  showVoterNames = false,
  closed = false
}: {
  result: PollResult
  names?: Record<string, { name: string; value: number }[]>
  /** Eigene Stimme: Option -> Vote.value. */
  myVotes?: Record<string, number>
  showVoterNames?: boolean
  closed?: boolean
}) {
  const { pollType, voters, quorum } = result
  const quorumMissing = quorum !== null ? Math.max(quorum - voters, 0) : 0
  const maxScore = Math.max(1, ...result.options.map(o => o.score))
  const pct = (n: number) => (voters > 0 ? Math.round((n / voters) * 100) : 0)

  return (
    <div className="space-y-3">
      {quorum !== null && (
        closed && quorumMissing > 0 ? (
          <p className="text-sm font-medium text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            Nicht beschlussfähig: {voters} von mindestens {quorum} Teilnehmenden.
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            Mindestbeteiligung: {quorum} Teilnehmende{quorumMissing > 0 ? ` - es fehlen noch ${quorumMissing}.` : ' - erreicht.'}
          </p>
        )
      )}
      {pollType === 'RANKING' && <p className="text-xs text-gray-500">Borda-Punkte: Platz 1 bringt am meisten, nicht eingeordnet nichts.</p>}

      {result.options.map(option => {
        const mine = myVotes[option.id]
        const isMine = mine !== undefined && (pollType !== 'YES_MAYBE_NO' || mine > ANSWER_VALUES.no)
        const optionNames = showVoterNames ? names[option.id] ?? [] : []

        let summary: string
        let full: number
        let partial = 0
        switch (pollType) {
          case 'CHOICE':
            summary = `${option.votes} · ${pct(option.votes)}%`
            full = pct(option.votes)
            break
          case 'YES_MAYBE_NO':
            summary = `${option.answers!.yes} ja · ${option.answers!.maybe} vielleicht · ${option.answers!.no} nein`
            full = pct(option.answers!.yes)
            partial = pct(option.answers!.maybe)
            break
          default:
            summary = `${option.score} Punkt${option.score === 1 ? '' : 'e'}`
            full = Math.round((option.score / maxScore) * 100)
        }

        return (
          <div key={option.id}>
            <div className="flex justify-between gap-3 text-sm mb-1">
              <span className={`font-medium ${isMine ? 'text-blue-700' : 'text-gray-800'}`}>
                {option.label}
                {mine !== undefined && (pollType === 'CHOICE' ? ' ✓' : ` (du: ${formatVoteValue(pollType, mine)})`)}
              </span>
              <span className="text-gray-500 text-right">{summary}</span>
            </div>
            <div className="w-full bg-gray-100 rounded h-2 overflow-hidden flex">
              <div className="bg-blue-500 h-2" style={{ width: `${full}%` }}></div>
              {partial > 0 && <div className="bg-blue-200 h-2" style={{ width: `${partial}%` }}></div>}
            </div>
            {optionNames.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {optionNames.map(n => (pollType === 'CHOICE' ? n.name : `${n.name} (${formatVoteValue(pollType, n.value)})`)).join(', ')}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
