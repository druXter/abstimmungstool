import { describe, expect, it } from 'vitest'
import { decide, verdictFor, YES_NO_ABSTAIN } from '../../app/lib/majority'

// Sicherheitsprüfung November 2026 (docs/AUDIT-2026-11.md), Logik. Jeder Test beginnt mit einer Gegenprobe (der
// erlaubte Fall geht durch) und scheitert erst an der Zeile, die den Fund zeigt. Rechte, Sitzungen und Routen:
// tests/e2e/audit-2026-11.spec.ts.

describe('V-03 Mehrheit der Anwesenden bzw. Mitglieder', () => {
  const noQuorum = { quorumMet: null }

  it('V-03 Mehrheit: ein Antrag mit mehr Nein als Ja ist nie angenommen, auch wenn die Bezugsgröße kleiner ist als die Zahl der Stimmen', () => {
    // Gegenprobe: 10 anwesend, 6 Ja, 4 Nein - absolute Mehrheit der Anwesenden (nötig 6) erreicht.
    expect(decide('ABSOLUTE_PRESENT', { yes: 6, no: 4, abstain: 0 }, { present: 10, members: null, ...noQuorum }).outcome).toBe('adopted')
    // Gegenprobe: dieselben Stimmen bei einfacher Mehrheit - 4 Ja gegen 6 Nein ist abgelehnt.
    expect(decide('SIMPLE', { yes: 4, no: 6, abstain: 0 }, { present: 4, members: null, ...noQuorum }).outcome).toBe('rejected')

    // Fund: 10 haben abgestimmt (4 Ja, 6 Nein). Danach gehen sechs (oder werden ausgecheckt), beim Schließen sind noch
    // 4 anwesend. Bezugsgröße 4, nötig 3 - der Antrag gilt als angenommen, obwohl die Mehrheit dagegen gestimmt hat.
    const afterLeaving = decide('ABSOLUTE_PRESENT', { yes: 4, no: 6, abstain: 0 }, { present: 4, members: null, ...noQuorum })
    expect(afterLeaving.outcome).not.toBe('adopted')

    // Dasselbe mit zwei Dritteln und mit der Zahl der Mitglieder aus den Einstellungen (zu klein eingetragen).
    expect(decide('TWO_THIRDS_PRESENT', { yes: 4, no: 6, abstain: 0 }, { present: 4, members: null, ...noQuorum }).outcome).not.toBe('adopted')
    expect(decide('ABSOLUTE_MEMBERS', { yes: 4, no: 6, abstain: 0 }, { present: null, members: 5, ...noQuorum }).outcome).not.toBe('adopted')
  })

  it('V-03 Mehrheit: niemand (mehr) anwesend - eine einzelne Ja-Stimme ist keine Mehrheit der Anwesenden', () => {
    const options = (yes: number, no: number, abstain: number) => YES_NO_ABSTAIN.map((label, i) => ({ label, votes: [yes, no, abstain][i] }))
    const poll = (present: number) => ({ assemblyMajority: 'ABSOLUTE_PRESENT', assemblyPresent: present, assemblyMembers: 30, assemblyQuorumMet: null })
    // Gegenprobe: 3 anwesend, 2 Ja.
    expect(verdictFor(poll(3), options(2, 1, 0))?.outcome).toBe('adopted')
    // Fund: Termin ohne QR-Einlass bzw. alle ausgecheckt - 0 Anwesende, 1 Ja gegen 5 Nein, "nötig 1 von 0".
    expect(verdictFor(poll(0), options(1, 5, 0))?.outcome).not.toBe('adopted')
  })
})
