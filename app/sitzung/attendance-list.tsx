'use client'

import { useState } from 'react'
import { chairPresence } from '../assembly-actions'
import { buttonClass, inputClass } from '../ui/kit'

export type AttendanceRow = { sub: string; name: string; present: boolean; left: boolean; joined: boolean }

/**
 * Anwesenheit für die Sitzungsleitung (docs/KONZEPT-SITZUNG.md Abschnitt 6): alle Zusagen aus rsvp-app mit Knopf zum
 * Ein- und Auschecken, ohne Scan. Suche nach Namen und Filter bleiben beim Aktualisieren der Seite erhalten.
 */
export default function AttendanceList({ assemblyId, people, trackPresence, disabled }: { assemblyId: string; people: AttendanceRow[]; trackPresence: boolean; disabled: boolean }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'present' | 'absent'>('all')
  const needle = query.trim().toLocaleLowerCase('de')
  const shown = people.filter(p => (!needle || p.name.toLocaleLowerCase('de').includes(needle))
    && (filter === 'all' || (filter === 'present') === p.present))
  const present = people.filter(p => p.present).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="attendance-search" className="sr-only">Name suchen</label>
        <input id="attendance-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name suchen" className={inputClass.replace('w-full', 'min-w-0 grow sm:max-w-xs')} />
        <div className="flex gap-1 text-sm" role="group" aria-label="Filter">
          {([['all', `Alle (${people.length})`], ['present', `Da (${present})`], ['absent', `Nicht da (${people.length - present})`]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
              className={`rounded-full px-3 py-1 ${filter === value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-400">Niemand gefunden.</p> : (
        <ul className="max-h-[28rem] divide-y divide-gray-100 overflow-y-auto dark:divide-gray-700" data-testid="attendance">
          {shown.map(p => (
            <li key={p.sub} className="flex items-center justify-between gap-3 py-1.5" data-present={p.present}>
              <span className="min-w-0">
                <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${p.present ? 'bg-green-500' : p.left ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600'}`} aria-hidden />
                <span className="font-medium">{p.name}</span>
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  {p.present ? 'da' : p.left ? 'gegangen' : 'nicht da'}{p.joined ? ' · 📱 beigetreten' : ''}
                </span>
              </span>
              <form action={chairPresence}>
                <input type="hidden" name="assemblyId" value={assemblyId} />
                <input type="hidden" name="sub" value={p.sub} />
                <input type="hidden" name="present" value={p.present ? '0' : '1'} />
                <button type="submit" disabled={disabled} aria-label={`${p.name} ${p.present ? (trackPresence ? 'auschecken (geht)' : 'austragen') : 'einchecken'}`}
                  className={buttonClass(p.present ? 'secondary' : 'primary', 'sm')}>
                  {p.present ? (trackPresence ? 'Geht' : 'Austragen') : p.left ? 'Kommt wieder' : 'Einchecken'}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
