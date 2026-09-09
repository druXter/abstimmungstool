// app/[pollId]/poll-results.tsx

/**
 * Geteilte Live-Ergebnis-Darstellung, sowohl auf der öffentlichen Abstimmungsseite
 * als auch der privaten Verwaltungsseite verwendet. Der Prozentwert bezieht sich
 * bewusst auf `distinctVoters` (Anzahl abstimmender Personen), nicht auf die Summe
 * aller Options-Stimmen - bei Einzelauswahl-Abstimmungen ist das identisch (jede
 * Person hat höchstens eine Stimme), bei Mehrfachauswahl können die Prozentwerte
 * dadurch korrekt in Summe über 100% liegen, was für "X% der Teilnehmenden haben
 * diese Option gewählt" das erwartbare, verständliche Verhalten ist.
 */
export default function PollResults({
  options,
  distinctVoters,
  myVoteOptionIds = []
}: {
  options: { id: string; label: string; _count: { votes: number } }[]
  distinctVoters: number
  myVoteOptionIds?: string[]
}) {
  return (
    <div className="space-y-3">
      {options.map(option => {
        const count = option._count.votes
        const pct = distinctVoters > 0 ? Math.round((count / distinctVoters) * 100) : 0
        const isMine = myVoteOptionIds.includes(option.id)
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
          </div>
        )
      })}
    </div>
  )
}
