import { agendaClock, type Agenda } from '../lib/timeline'

/**
 * Tagesordnung aus dem Zeitplan (app/lib/timeline.ts) für Mitglieder und Sitzungsleitung: der laufende Punkt
 * hervorgehoben, Erledigtes blass, Ausgefallenes durchgestrichen, Uhrzeiten mit Prognose aus dem Zeitplan.
 */
export default function AgendaList({ agenda }: { agenda: Agenda }) {
  if (agenda.items.length === 0) return <p className="text-sm text-gray-600 dark:text-gray-400">Die Tagesordnung folgt.</p>
  return (
    <ol className="space-y-1 text-sm" data-testid="agenda">
      {agenda.items.map(item => (
        <li key={item.id} data-status={item.status} className={`flex gap-3 rounded-md px-2 py-1 ${item.status === 'now' ? 'bg-blue-50 font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-100' : item.status === 'past' ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
          <span className={`w-12 shrink-0 tabular-nums ${item.status === 'cancelled' ? 'line-through' : ''}`}>{item.approximate ? '~' : ''}{agendaClock(item.start, agenda.timezone)}</span>
          <span className={`min-w-0 ${item.status === 'cancelled' ? 'line-through' : ''}`}>
            {item.title}
            {item.status === 'now' && <span className="ml-2 text-xs font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300">jetzt</span>}
            {item.status === 'cancelled' && <span className="ml-2 text-xs no-underline">entfällt</span>}
            {item.status !== 'past' && item.delayMin ? <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">{item.delayMin > 0 ? `+${item.delayMin}` : item.delayMin} Min</span> : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Der laufende Punkt, sonst der nächste - für eine Zeile über allem. */
export function currentAgendaItem(agenda: Agenda | null): { title: string; now: boolean } | null {
  if (!agenda) return null
  const now = agenda.items.find(i => i.status === 'now')
  if (now) return { title: now.title, now: true }
  const next = agenda.items.find(i => i.status === 'upcoming')
  return next ? { title: next.title, now: false } : null
}
