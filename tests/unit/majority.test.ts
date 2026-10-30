import { describe, expect, it } from 'vitest'
import { decide, neededYes, parseMajorityRule, verdictDetail, verdictFor, yesNoCounts } from '../../app/lib/majority'

// Mehrheiten in Sitzungen (Idee L33): jede Regel an ihrer Grenze, Bezugsgrößen, Beschlussfähigkeit, unbekannte Zahlen.
const snap = (present: number | null = 20, members: number | null = 30, quorumMet: boolean | null = true) => ({ present, members, quorumMet })
const counts = (yes: number, no: number, abstain = 0) => ({ yes, no, abstain })

describe('neededYes', () => {
  it('absolute Mehrheit = mehr als die Hälfte', () => {
    expect(neededYes('half', 20)).toBe(11)
    expect(neededYes('half', 21)).toBe(11)
    expect(neededYes('half', 1)).toBe(1)
  })
  it('zwei Drittel = mindestens zwei Drittel, aufgerundet', () => {
    expect(neededYes('twoThirds', 30)).toBe(20)
    expect(neededYes('twoThirds', 31)).toBe(21)
    expect(neededYes('twoThirds', 3)).toBe(2)
  })
})

describe('decide', () => {
  it('einfache Mehrheit: mehr Ja als Nein, Enthaltungen zählen nicht, Gleichstand ist abgelehnt', () => {
    expect(decide('SIMPLE', counts(5, 4, 10), snap()).outcome).toBe('adopted')
    expect(decide('SIMPLE', counts(5, 5), snap()).outcome).toBe('rejected')
    expect(decide('SIMPLE', counts(0, 0, 7), snap()).outcome).toBe('rejected')
  })
  it('absolute Mehrheit der abgegebenen Stimmen: Enthaltungen zählen wie Nein', () => {
    expect(decide('ABSOLUTE_CAST', counts(6, 4, 1), snap()).outcome).toBe('adopted')
    expect(decide('ABSOLUTE_CAST', counts(6, 4, 2), snap()).outcome).toBe('rejected')
  })
  it('absolute Mehrheit der Anwesenden und der Mitglieder: Bezug sind die Zahlen beim Schließen', () => {
    expect(decide('ABSOLUTE_PRESENT', counts(11, 0), snap(20)).outcome).toBe('adopted')
    expect(decide('ABSOLUTE_PRESENT', counts(10, 0), snap(20)).outcome).toBe('rejected')
    expect(decide('ABSOLUTE_MEMBERS', counts(15, 0), snap(20, 30)).outcome).toBe('rejected')
    expect(decide('ABSOLUTE_MEMBERS', counts(16, 0), snap(20, 30)).outcome).toBe('adopted')
  })
  it('zwei Drittel: Ja-und-Nein, abgegebene, Anwesende, Mitglieder', () => {
    expect(decide('TWO_THIRDS_VALID', counts(10, 5, 9), snap()).outcome).toBe('adopted')
    expect(decide('TWO_THIRDS_VALID', counts(9, 5), snap()).outcome).toBe('rejected')
    expect(decide('TWO_THIRDS_CAST', counts(10, 5, 1), snap()).outcome).toBe('rejected')
    expect(decide('TWO_THIRDS_PRESENT', counts(14, 0), snap(21)).outcome).toBe('adopted')
    expect(decide('TWO_THIRDS_PRESENT', counts(13, 0), snap(21)).outcome).toBe('rejected')
    expect(decide('TWO_THIRDS_MEMBERS', counts(20, 0), snap(20, 30)).outcome).toBe('adopted')
  })
  it('nicht beschlussfähig: kein Beschluss, auch bei klarer Mehrheit', () => {
    expect(decide('SIMPLE', counts(10, 0), snap(20, 30, false)).outcome).toBe('no-quorum')
    expect(decide('SIMPLE', counts(10, 0), snap(20, 30, null)).outcome).toBe('adopted')
  })
  it('unbekannte Bezugsgröße: nicht bestimmbar statt geraten', () => {
    expect(decide('ABSOLUTE_PRESENT', counts(10, 0), snap(null)).outcome).toBe('unknown')
    expect(decide('TWO_THIRDS_MEMBERS', counts(10, 0), snap(20, null)).outcome).toBe('unknown')
  })
  it('ohne Ja nie angenommen, auch bei Bezugsgröße 0', () => {
    expect(decide('ABSOLUTE_PRESENT', counts(0, 0), snap(0)).outcome).toBe('rejected')
  })
})

describe('yesNoCounts und verdictFor', () => {
  const options = [{ label: 'Ja', votes: 12 }, { label: 'Nein', votes: 3 }, { label: 'Enthaltung', votes: 2 }]
  it('nur Ja/Nein/Enthaltung in dieser Reihenfolge', () => {
    expect(yesNoCounts(options)).toEqual({ yes: 12, no: 3, abstain: 2 })
    expect(yesNoCounts([{ label: 'Anna', votes: 1 }, { label: 'Ben', votes: 2 }, { label: 'Enthaltung', votes: 0 }])).toBeNull()
    expect(yesNoCounts(options.slice(0, 2))).toBeNull()
  })
  it('ohne gültige Regel oder bei einer Wahl kein Ergebnis', () => {
    const poll = { assemblyMajority: 'ABSOLUTE_PRESENT', assemblyPresent: 20, assemblyMembers: 30, assemblyQuorumMet: true }
    expect(verdictFor(poll, options)?.outcome).toBe('adopted')
    expect(verdictFor({ ...poll, assemblyMajority: null }, options)).toBeNull()
    expect(verdictFor({ ...poll, assemblyMajority: 'toString' }, options)).toBeNull()
    expect(verdictFor(poll, [{ label: 'Anna', votes: 1 }, { label: 'Ben', votes: 2 }])).toBeNull()
  })
  it('parseMajorityRule nimmt nur bekannte Regeln', () => {
    expect(parseMajorityRule('SIMPLE')).toBe('SIMPLE')
    expect(parseMajorityRule('constructor')).toBeNull()
    expect(parseMajorityRule('')).toBeNull()
  })
  it('Rechnung als Text', () => {
    expect(verdictDetail(decide('ABSOLUTE_PRESENT', counts(12, 3), snap(20)))).toBe('absolute Mehrheit der Anwesenden: 12 Ja, nötig 11 von 20')
    expect(verdictDetail(decide('SIMPLE', counts(5, 4), snap()))).toBe('einfache Mehrheit: 5 Ja, 4 Nein')
    expect(verdictDetail(decide('TWO_THIRDS_MEMBERS', counts(5, 4), snap(20, null)))).toBe('⅔ der Mitglieder: Zahl der Mitglieder unbekannt')
  })
})
