// app/meine-abstimmungen/poll-row.tsx
import Link from 'next/link'
import { Badge, type Tone } from '../ui/kit'

export type RowData = {
  kind: 'poll' | 'live' | 'survey' | 'assembly'
  id: string
  href: string
  title: string
  /** Große Zahl links (Teilnehmende bzw. Spielende) mit Beschriftung. */
  count: number
  countLabel: string
  status: { label: string; tone: Tone }
  badges: { label: string; tone: Tone; title?: string }[]
  /** Zweite Zeile: Art, Stand, Besitz. */
  line: string
  /** Etwas ist zu tun (Termin festlegen, Vorschläge freigeben) - steht oben in "Aktuell". */
  attention: boolean
  sortDate: Date
}

/**
 * Eine Abstimmung, Live-Runde oder ein Fragebogen in der Übersicht (docs/KONZEPT-OBERFLAECHE.md, wie die Event-Zeile in
 * rsvp-app): Zahl der Teilnehmenden, Titel, Stand, Merkmale - als Ganzes ein Link zur Verwaltung. Live-Runden tragen die
 * lila Themenmarke, Fragebögen die indigo. `muted` für Beendetes.
 */
export default function PollRow({ row, muted = false }: { row: RowData; muted?: boolean }) {
  const box = row.kind === 'live'
    ? { bg: 'bg-purple-50 dark:bg-purple-950/50', text: 'text-purple-800 dark:text-purple-200' }
    : row.kind === 'survey'
      ? { bg: 'bg-indigo-50 dark:bg-indigo-950/50', text: 'text-indigo-800 dark:text-indigo-200' }
      : row.kind === 'assembly'
        ? { bg: 'bg-teal-50 dark:bg-teal-950/50', text: 'text-teal-800 dark:text-teal-200' }
        : { bg: 'bg-gray-50 dark:bg-gray-900', text: 'text-gray-900 dark:text-gray-100' }
  return (
    <Link
      href={row.href}
      className={`group flex gap-4 rounded-xl border bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow dark:bg-gray-800 dark:hover:border-blue-700 ${row.attention ? 'border-amber-300 dark:border-amber-800' : 'border-gray-200 dark:border-gray-700'} ${muted ? 'opacity-75' : ''}`}
      data-testid="poll-row"
    >
      <div className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-lg py-2 text-center ${box.bg}`}>
        <span className={`text-xl font-semibold leading-tight ${box.text}`}>{row.count}</span>
        <span className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400">{row.countLabel}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900 group-hover:text-blue-700 dark:text-gray-100 dark:group-hover:text-blue-300">{row.title}</span>
          <Badge tone={row.status.tone}>{row.status.label}</Badge>
          {row.badges.map(b => <Badge key={b.label} tone={b.tone} title={b.title}>{b.label}</Badge>)}
        </div>
        <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">{row.line}</p>
      </div>
    </Link>
  )
}
