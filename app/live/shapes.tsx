/**
 * Farben und Formen der Antworten wie bei Kahoot: Auf der Leinwand und auf dem Handy erkennt man
 * dieselbe Antwort an Farbe UND Form (hilft auch bei Farbsehschwäche). Reihenfolge = Position.
 */
export const ANSWER_STYLES = [
  { name: 'Dreieck', bg: 'bg-red-600', ring: 'ring-red-600', bar: 'bg-red-500', path: 'M12 3 L22 21 L2 21 Z' },
  { name: 'Raute', bg: 'bg-blue-600', ring: 'ring-blue-600', bar: 'bg-blue-500', path: 'M12 2 L22 12 L12 22 L2 12 Z' },
  { name: 'Kreis', bg: 'bg-amber-500', ring: 'ring-amber-500', bar: 'bg-amber-400', path: 'M12 2 A10 10 0 1 0 12.01 2 Z' },
  { name: 'Quadrat', bg: 'bg-green-600', ring: 'ring-green-600', bar: 'bg-green-500', path: 'M3 3 H21 V21 H3 Z' },
  { name: 'Stern', bg: 'bg-purple-600', ring: 'ring-purple-600', bar: 'bg-purple-500', path: 'M12 2 L14.9 8.6 L22 9.3 L16.6 14 L18.2 21 L12 17.3 L5.8 21 L7.4 14 L2 9.3 L9.1 8.6 Z' },
  { name: 'Sechseck', bg: 'bg-teal-600', ring: 'ring-teal-600', bar: 'bg-teal-500', path: 'M7 3 H17 L22 12 L17 21 H7 L2 12 Z' }
] as const

export function AnswerShape({ index, className = 'w-6 h-6' }: { index: number; className?: string }) {
  const style = ANSWER_STYLES[index % ANSWER_STYLES.length]
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 fill-white`} role="img" aria-label={style.name}>
      <path d={style.path} />
    </svg>
  )
}
