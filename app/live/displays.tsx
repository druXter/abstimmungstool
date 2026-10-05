import type { EstimateStats, WordCount } from '../lib/live'

/**
 * Anzeige-Bausteine für Leinwand, Handy und Verwaltungsseite (dunkler oder heller Hintergrund
 * über `tone`). Reine Darstellung - die Zahlen kommen fertig aus app/lib/live.ts.
 */

const WORD_COLORS = ['text-red-400', 'text-blue-400', 'text-amber-300', 'text-green-400', 'text-purple-400', 'text-teal-300']
const WORD_COLORS_LIGHT = ['text-red-700', 'text-blue-700', 'text-amber-700', 'text-green-700', 'text-purple-700', 'text-teal-700']

export function formatDe(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

/**
 * Wortwolke: Schriftgröße nach Häufigkeit (zwischen `min` und `max` rem). `onPick` macht die Wörter
 * anklickbar (Leinwand: ausblenden).
 */
export function WordCloud({
  words,
  max = 4.5,
  min = 1,
  tone = 'dark',
  onPick
}: {
  words: WordCount[]
  max?: number
  min?: number
  tone?: 'dark' | 'light'
  onPick?: (word: WordCount) => void
}) {
  if (words.length === 0) return <p className={tone === 'dark' ? 'text-gray-400' : 'text-gray-500'}>Noch keine Beiträge.</p>
  const top = Math.max(...words.map(w => w.count))
  const colors = tone === 'dark' ? WORD_COLORS : WORD_COLORS_LIGHT
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2" aria-label="Wortwolke">
      {words.map((w, i) => {
        const size = min + (max - min) * (top === 1 ? 0.5 : (w.count - 1) / (top - 1))
        const content = <span>{w.text}<span className="sr-only"> ({w.count})</span></span>
        return (
          <li key={w.key} className={`${colors[i % colors.length]} font-bold leading-tight`} style={{ fontSize: `${size}rem` }} title={`${w.count}×`}>
            {onPick ? (
              <button type="button" onClick={() => onPick(w)} className="hover:line-through">{content}</button>
            ) : content}
          </li>
        )
      })}
    </ul>
  )
}

/** Kennzahlen einer Schätzfrage in einer Zeile. */
export function EstimateSummary({ stats, unit }: { stats: EstimateStats | null; unit: string | null }) {
  if (!stats) return <span>Keine Schätzungen.</span>
  const u = unit ? ` ${unit}` : ''
  return (
    <span>
      {stats.count} Schätzung{stats.count === 1 ? '' : 'en'} · Median {formatDe(stats.median)}{u} · Durchschnitt {formatDe(stats.mean)}{u} ·
      von {formatDe(stats.min)} bis {formatDe(stats.max)}{u}
    </span>
  )
}

/** Zahlenstrahl der Schätzungen mit dem richtigen Wert als Markierung (Leinwand). */
export function EstimateLine({ values, target, unit }: { values: number[]; target: number | null; unit: string | null }) {
  const all = target !== null ? [...values, target] : values
  if (all.length === 0) return null
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const pos = (v: number) => (hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100)
  return (
    <div className="relative h-24 mx-4" aria-label="Verteilung der Schätzungen">
      <div className="absolute top-12 left-0 right-0 h-1 bg-white/30 rounded" />
      {values.map((v, i) => (
        <span key={i} className="absolute top-10 w-3 h-3 -ml-1.5 rounded-full bg-amber-300/80" style={{ left: `${pos(v)}%`, top: `${2.25 + (i % 3) * 0.35}rem` }} />
      ))}
      {target !== null && (
        <div className="absolute top-0 -ml-px h-20 w-0.5 bg-green-400" style={{ left: `${pos(target)}%` }}>
          <span className="absolute -top-1 left-2 whitespace-nowrap text-green-300 font-bold">{formatDe(target)}{unit ? ` ${unit}` : ''}</span>
        </div>
      )}
      <span className="absolute top-16 left-0 text-sm text-gray-400">{formatDe(lo)}</span>
      <span className="absolute top-16 right-0 text-sm text-gray-400">{formatDe(hi)}</span>
    </div>
  )
}

/** Bild zur Frage (app/api/live/bild/[imageId]); Größe per className. */
export function QuestionImage({ imageId, className }: { imageId: string | null; className: string }) {
  if (!imageId) return null
  // eslint-disable-next-line @next/next/no-img-element -- Bild aus dem eigenen, zugriffsgeschützten Speicher
  return <img src={`/api/live/bild/${imageId}`} alt="Bild zur Frage" className={`${className} object-contain rounded-lg`} />
}

/**
 * Freitext: die richtigen Antworten (falls eingetragen) und die gegebenen, gleiche zusammengefasst,
 * häufigste zuerst, passende mit Haken. `onPick` macht sie anklickbar (Leinwand: ausblenden).
 */
export function TextAnswerList({
  accepted,
  answers,
  tone = 'dark',
  onPick
}: {
  accepted: string[]
  answers: (WordCount & { correct: boolean })[]
  tone?: 'dark' | 'light'
  onPick?: (word: WordCount) => void
}) {
  const dark = tone === 'dark'
  return (
    <div className="space-y-3">
      {accepted.length > 0 && (
        <p className={dark ? 'text-3xl md:text-4xl font-bold text-center text-green-300' : 'text-sm font-semibold text-green-800'}>
          Richtig: {accepted.join(' / ')}
        </p>
      )}
      {answers.length > 0 && (
        <ul className={`flex flex-wrap gap-2 ${dark ? 'justify-center' : ''}`} aria-label="Gegebene Antworten">
          {answers.map(a => {
            const style = a.correct
              ? (dark ? 'bg-green-600 text-white' : 'bg-green-100 text-green-900')
              : (dark ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-800')
            const content = <>{a.text}{a.correct && <span aria-label="richtig"> ✓</span>}<span className="ml-2 tabular-nums opacity-75">{a.count}</span></>
            return (
              <li key={a.key} className={`${style} rounded-full ${dark ? 'px-4 py-1.5 text-xl' : 'px-3 py-1 text-sm'} font-semibold`}>
                {onPick ? <button type="button" onClick={() => onPick(a)} className="hover:line-through">{content}</button> : content}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
