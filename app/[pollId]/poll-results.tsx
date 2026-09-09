// app/[pollId]/poll-results.tsx

/**
 * Geteilte Live-Ergebnis-Darstellung, sowohl auf der öffentlichen Abstimmungsseite
 * als auch der privaten Verwaltungsseite verwendet.
 */
export default function PollResults({
  options,
  totalVotes,
  myVoteOptionId
}: {
  options: { id: string; label: string; _count: { votes: number } }[]
  totalVotes: number
  myVoteOptionId?: string | null
}) {
  return (
    <div className="space-y-3">
      {options.map(option => {
        const count = option._count.votes
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0
        const isMine = myVoteOptionId === option.id
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
