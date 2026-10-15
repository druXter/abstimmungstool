// app/sitzung/quorum-line.tsx
import type { QuorumState } from '../lib/assembly'

/**
 * Anwesenheit und Beschlussfähigkeit einer Sitzung in einer Zeile ("12 anwesend von 20 Zusagen · beschlussfähig ab
 * 11"). Nichts, solange kein Termin verknüpft ist; ein Hinweis, wenn rsvp-app nicht erreichbar ist.
 */
export default function QuorumLine({ state }: { state: QuorumState }) {
  if (state.present === null) {
    return state.reachable ? null : <p className="text-sm text-amber-700 dark:text-amber-300" data-testid="quorum">Anwesenheit gerade nicht abrufbar</p>
  }
  return (
    <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="quorum">
      <strong className="tabular-nums">{state.present}</strong> anwesend{state.members !== null ? ` von ${state.members} Zusagen` : ''}
      {state.checkin === false && ' (Termin ohne QR-Einlass)'}
      {state.quorum !== null && (
        <> · {state.met
          ? <span className="font-medium text-green-700 dark:text-green-400">beschlussfähig</span>
          : <span className="font-medium text-red-700 dark:text-red-400">nicht beschlussfähig</span>} (ab {state.quorum})</>
      )}
    </p>
  )
}
