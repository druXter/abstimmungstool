// app/lib/date-options.ts
import type { OptionKind } from '@prisma/client'

/**
 * Terminoptionen (Poll.optionKind DATE/DATETIME). Eingabe und Anzeige laufen in der Zeitzone
 * des Servers (TZ, siehe package.json und docker-compose.yml) - genau wie das automatische
 * Schließdatum. Das Label wird beim Speichern aus dem Termin formatiert, damit alle anderen
 * Stellen (Ergebnis, CSV, Mail, rsvp-app) wie bei Freitext-Optionen einfach das Label zeigen.
 */

export const OPTION_KINDS: readonly OptionKind[] = ['TEXT', 'DATE', 'DATETIME']

export function parseOptionKind(value: FormDataEntryValue | null): OptionKind {
  return OPTION_KINDS.find(kind => kind === value) ?? 'TEXT'
}

/** Typ des Eingabefelds für eine Optionsart. */
export function inputTypeFor(kind: OptionKind): 'text' | 'date' | 'datetime-local' {
  return kind === 'DATE' ? 'date' : kind === 'DATETIME' ? 'datetime-local' : 'text'
}

/** "Mi., 07.10.2026" bzw. "Mi., 07.10.2026, 19:00 Uhr" */
export function formatDateOption(date: Date, kind: OptionKind): string {
  const day = date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  if (kind !== 'DATETIME') return day
  return `${day}, ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
}

/** Liest einen Wert aus <input type="date|datetime-local">. Ungültiges -> null. */
export function parseDateOption(input: string, kind: OptionKind): { label: string; startsAt: Date } | null {
  const pattern = kind === 'DATE' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
  if (!pattern.test(input)) return null
  // Ohne Zeitzonenangabe liest JavaScript "YYYY-MM-DDTHH:mm" als Ortszeit, ein reines Datum
  // aber als UTC - deshalb für DATE ausdrücklich Mitternacht Ortszeit anhängen.
  const startsAt = new Date(kind === 'DATE' ? `${input}T00:00` : input)
  if (Number.isNaN(startsAt.getTime())) return null
  return { label: formatDateOption(startsAt, kind), startsAt }
}

/** Wert für das Eingabefeld (Bearbeiten-Seite). */
export function toInputValue(date: Date, kind: OptionKind): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return kind === 'DATE' ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
