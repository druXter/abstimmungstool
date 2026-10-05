'use client'

import { useEffect, useMemo, useState } from 'react'
import { REVEAL_COLUMNS, REVEAL_ROWS, REVEAL_TILES, revealedTiles, revealOrder } from '../lib/live-reveal'

/**
 * Leinwand: Bild unter Kacheln, die nach und nach aufgehen (LiveQuestion.imageReveal) - mit
 * Zeitlimit von selbst, dazu per Knopf. `startedAt` ist Serverzeit, `offset` gleicht die Uhr dieses
 * Geräts daran an (useLiveView).
 */
export default function RevealImage({
  imageId, questionId, startedAt, steps, timeLimit, offset, className
}: {
  imageId: string
  questionId: string
  startedAt: number
  steps: number
  timeLimit: number | null
  offset: number
  className: string
}) {
  const order = useMemo(() => revealOrder(questionId), [questionId])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!timeLimit) return
    // Alle timeLimit/REVEAL_TILES Sekunden geht ein Stück auf - viermal so oft nachsehen reicht.
    const timer = setInterval(() => setNow(Date.now()), Math.max((timeLimit * 1000) / REVEAL_TILES / 4, 100))
    return () => clearInterval(timer)
  }, [timeLimit])
  const opened = new Set(order.slice(0, revealedTiles(now + offset - startedAt, timeLimit, steps)))

  return (
    <div className="flex justify-center">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element -- Bild aus dem eigenen, zugriffsgeschützten Speicher */}
        <img src={`/api/live/bild/${imageId}`} alt="Bild zur Frage, teilweise verdeckt" className={`${className} block w-auto rounded-lg`} />
        <div
          className="absolute inset-0 grid overflow-hidden rounded-lg" aria-hidden="true" data-testid="reveal-tiles"
          style={{ gridTemplateColumns: `repeat(${REVEAL_COLUMNS}, 1fr)`, gridTemplateRows: `repeat(${REVEAL_ROWS}, 1fr)` }}
        >
          {Array.from({ length: REVEAL_TILES }, (_, i) => (
            <span
              key={i} data-open={opened.has(i) || undefined}
              className={`border border-purple-950 bg-purple-700 transition-opacity duration-500 ${opened.has(i) ? 'opacity-0' : ''}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
