import type { SurveyQuestionKind } from '@prisma/client'

/**
 * Nummern im Fragebogen (docs/KONZEPT-FRAGEBOGEN.md) - ohne Server-Abhängigkeiten, weil auch der Editor im Browser
 * sie braucht. Regeln:
 * - Jede Frage mit sichtbarem Titel bekommt die nächste Nummer.
 * - Eine Überschrift (INFO mit Überschrift), auf die direkt Fragen mit ausgeblendetem Titel folgen, ist deren Titel:
 *   Sie bekommt die Nummer, die Gruppe zählt als EINE Frage (z.B. "4. Wie ist dein Eindruck?" über dem UEQ-S).
 * - Fragen mit ausgeblendetem Titel bekommen keine eigene Nummer, sondern gehören zur Nummer davor (group).
 * - Andere Überschrift/Text-Blöcke bleiben ohne Nummer und beenden eine Gruppe.
 * Mit numbered = false gibt es gar keine Nummern.
 */

export type NumberedItem = { id: string; kind: SurveyQuestionKind; hideTitle: boolean; text: string; hint?: string | null }

export function questionNumbers(items: NumberedItem[], numbered = true): { shown: Map<string, number>; group: Map<string, number> } {
  const shown = new Map<string, number>()
  const group = new Map<string, number>()
  if (!numbered) return { shown, group }
  let next = 1
  let current: number | null = null
  items.forEach((item, i) => {
    if (item.kind === 'INFO') {
      const following = items[i + 1]
      current = item.text && following && following.kind !== 'INFO' && following.hideTitle ? next++ : null
      if (current !== null) shown.set(item.id, current)
    } else if (!item.hideTitle) {
      current = next++
      shown.set(item.id, current)
      group.set(item.id, current)
    } else if (current !== null) {
      group.set(item.id, current)
    }
  })
  return { shown, group }
}

/**
 * Woran eine Frage mit ausgeblendetem Titel (und ohne Hinweis) optisch anschließt: an eine Überschrift (gewollt),
 * einen reinen Text-Block, eine normale Frage (sieht dann aus wie ein Teil davon) oder an nichts (ganz oben).
 * `index` ist die Position dieses Blocks. Für den Hinweis im Editor.
 */
export function attachment(items: Pick<NumberedItem, 'kind' | 'hideTitle' | 'text'>[], index: number): { to: 'heading' | 'text' | 'question' | 'start'; index: number } {
  for (let j = index - 1; j >= 0; j--) {
    const item = items[j]
    if (item.kind === 'INFO') return { to: item.text ? 'heading' : 'text', index: j }
    if (!item.hideTitle) return { to: 'question', index: j }
  }
  return { to: 'start', index: -1 }
}
