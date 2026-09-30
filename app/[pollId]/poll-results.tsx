// app/[pollId]/poll-results.tsx

/**
 * Geteilte Live-Ergebnis-Darstellung, sowohl auf der öffentlichen Abstimmungsseite
 * als auch der privaten Verwaltungsseite verwendet. Der Prozentwert bezieht sich
 * bewusst auf `distinctVoters` (Anzahl abstimmender Personen), nicht auf die Summe
 * aller Options-Stimmen - bei Einzelauswahl-Abstimmungen ist das identisch (jede
 * Person hat höchstens eine Stimme), bei Mehrfachauswahl können die Prozentwerte
 * dadurch korrekt in Summe über 100% liegen, was für "X% der Teilnehmenden haben
 * diese Option gewählt" das erwartbare, verständliche Verhalten ist.
 *
 * `showVoterNames` zeigt zusätzlich pro Option, wer dafür gestimmt hat (Vote.voterName,
 * je nach Modus ein Name oder eine E-Mail - siehe app/lib/voter-identity.ts). Stimmen
 * ohne Namen (Cookie-Modus) tauchen dort nicht auf, zählen aber natürlich mit.
 */
export default function PollResults({
  options,
  distinctVoters,
  myVoteOptionIds = [],
  showVoterNames = false,
  quorum = null,
  closed = false
}: {
  options: { id: string; label: string; _count: { votes: number }; votes?: { voterName: string | null }[] }[]
  distinctVoters: number
  myVoteOptionIds?: string[]
  showVoterNames?: boolean
  /** Poll.quorum - Mindestbeteiligung, siehe app/lib/results.ts. */
  quorum?: number | null
  closed?: boolean
}) {
  const quorumMissing = quorum !== null ? Math.max(quorum - distinctVoters, 0) : 0
  return (
    <div className="space-y-3">
      {quorum !== null && (
        closed && quorumMissing > 0 ? (
          <p className="text-sm font-medium text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            Nicht beschlussfähig: {distinctVoters} von mindestens {quorum} Teilnehmenden.
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            Mindestbeteiligung: {quorum} Teilnehmende{quorumMissing > 0 ? ` - es fehlen noch ${quorumMissing}.` : ' - erreicht.'}
          </p>
        )
      )}
      {options.map(option => {
        const count = option._count.votes
        const pct = distinctVoters > 0 ? Math.round((count / distinctVoters) * 100) : 0
        const isMine = myVoteOptionIds.includes(option.id)
        const voterNames = showVoterNames
          ? (option.votes || []).map(v => v.voterName).filter((n): n is string => !!n)
          : []
        return (
          <div key={option.id}>
            <div className="flex justify-between text-sm mb-1">
              <span className={`font-medium ${isMine ? 'text-blue-700' : 'text-gray-800'}`}>
                {option.label}{isMine ? ' ✓' : ''}
              </span>
              <span className="text-gray-500">{count} · {pct}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded h-2 overflow-hidden">
              <div className="bg-blue-500 h-2 rounded" style={{ width: `${pct}%` }}></div>
            </div>
            {voterNames.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">{voterNames.join(', ')}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
