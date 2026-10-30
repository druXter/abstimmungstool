// app/sitzung/verdict.tsx
import { Badge, type Tone } from '../ui/kit'
import { OUTCOME_LABEL, verdictDetail, type Verdict } from '../lib/majority'

const TONE: Record<Verdict['outcome'], Tone> = { adopted: 'green', rejected: 'red', 'no-quorum': 'amber', unknown: 'gray' }
const BOARD_TONE: Record<Verdict['outcome'], string> = {
  adopted: 'text-green-400', rejected: 'text-red-400', 'no-quorum': 'text-amber-300', unknown: 'text-slate-300'
}

/**
 * Ergebnis nach der Mehrheitsregel (Idee L33): "angenommen" bzw. "abgelehnt" mit der Rechnung dahinter. In
 * Sitzungsleitung und Mitgliederansicht als Badge, auf der dunklen Tafel als farbiger Text.
 */
export default function VerdictLine({ verdict, board = false }: { verdict: Verdict | null; board?: boolean }) {
  if (!verdict) return null
  if (board) {
    return (
      <p className="mt-[1vh]" data-testid="verdict">
        <strong className={`text-[1.2em] ${BOARD_TONE[verdict.outcome]}`}>{OUTCOME_LABEL[verdict.outcome]}</strong>{' '}
        <span className="text-[0.75em] text-slate-400">{verdictDetail(verdict)}</span>
      </p>
    )
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400" data-testid="verdict">
      <Badge tone={TONE[verdict.outcome]}>{OUTCOME_LABEL[verdict.outcome]}</Badge>
      <span>{verdictDetail(verdict)}</span>
    </p>
  )
}
