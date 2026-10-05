/**
 * Bild aufdecken (LiveQuestion.imageReveal): Wie viele Kacheln offen sind und in welcher Reihenfolge
 * sie aufgehen. Ohne Server-Abhängigkeiten, weil die Leinwand (app/live/reveal-image.tsx) im Browser
 * mitrechnet.
 */

/** Das Bild liegt unter REVEAL_COLUMNS × REVEAL_ROWS Stücken. */
export const REVEAL_COLUMNS = 5
export const REVEAL_ROWS = 5
export const REVEAL_TILES = REVEAL_COLUMNS * REVEAL_ROWS

/**
 * Wie viele Stücke offen sind: mit Zeitlimit gleichmäßig über die Zeit (am Ende alle), dazu die von
 * Hand aufgedeckten (`steps`, Knopf auf der Leinwand). Ohne Zeitlimit nur von Hand.
 */
export function revealedTiles(elapsedMs: number, timeLimit: number | null, steps: number): number {
  const byTime = timeLimit ? Math.floor((REVEAL_TILES * Math.max(elapsedMs, 0)) / (timeLimit * 1000)) : 0
  return Math.min(REVEAL_TILES, byTime + steps)
}

/**
 * Reihenfolge, in der die Stücke aufgehen: zufällig, aber fest pro Frage (aus ihrer ID) - so zeigen
 * zwei Leinwände und ein Neuladen dasselbe.
 */
export function revealOrder(seed: string): number[] {
  // FNV-1a als Startwert, dann mulberry32 als kleiner Zufallsgenerator.
  let state = 2166136261
  for (const ch of seed) state = Math.imul(state ^ ch.charCodeAt(0), 16777619)
  const next = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const order = Array.from({ length: REVEAL_TILES }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}
