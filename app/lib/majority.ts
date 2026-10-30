// app/lib/majority.ts
//
// Mehrheiten in Sitzungen (Idee L33, docs/KONZEPT-SITZUNG.md Abschnitt 9): Ist ein Antrag mit Ja/Nein/Enthaltung
// angenommen? Die Leitung wählt die Regel aus ihrer Satzung, das Tool rechnet nur. Reine Funktionen - die Seiten, die
// CSV und die Beschlüsse für rsvp-app rechnen alle hiermit.

/** Ja/Nein/Enthaltung - die übliche Beschlussabstimmung (auch von app/lib/assembly.ts weitergereicht). */
export const YES_NO_ABSTAIN = ['Ja', 'Nein', 'Enthaltung']

/** Worauf sich eine Mehrheit bezieht. */
export type MajorityBase = 'valid' | 'cast' | 'present' | 'members'

export const MAJORITY_RULES = {
  SIMPLE: { label: 'Einfache Mehrheit', short: 'einfache Mehrheit', share: 'simple', base: 'valid' },
  ABSOLUTE_CAST: { label: 'Absolute Mehrheit der abgegebenen Stimmen', short: 'absolute Mehrheit der abgegebenen Stimmen', share: 'half', base: 'cast' },
  ABSOLUTE_PRESENT: { label: 'Absolute Mehrheit der Anwesenden', short: 'absolute Mehrheit der Anwesenden', share: 'half', base: 'present' },
  ABSOLUTE_MEMBERS: { label: 'Absolute Mehrheit der Mitglieder', short: 'absolute Mehrheit der Mitglieder', share: 'half', base: 'members' },
  TWO_THIRDS_VALID: { label: 'Zwei Drittel der Ja- und Nein-Stimmen', short: '⅔ der Ja- und Nein-Stimmen', share: 'twoThirds', base: 'valid' },
  TWO_THIRDS_CAST: { label: 'Zwei Drittel der abgegebenen Stimmen', short: '⅔ der abgegebenen Stimmen', share: 'twoThirds', base: 'cast' },
  TWO_THIRDS_PRESENT: { label: 'Zwei Drittel der Anwesenden', short: '⅔ der Anwesenden', share: 'twoThirds', base: 'present' },
  TWO_THIRDS_MEMBERS: { label: 'Zwei Drittel der Mitglieder', short: '⅔ der Mitglieder', share: 'twoThirds', base: 'members' }
} as const satisfies Record<string, { label: string; short: string; share: 'simple' | 'half' | 'twoThirds'; base: MajorityBase }>

export type MajorityRule = keyof typeof MAJORITY_RULES

/** Erklärung je Regel fürs Formular - was genau gezählt wird. */
export const MAJORITY_HINTS: Record<MajorityRule, string> = {
  SIMPLE: 'mehr Ja als Nein, Enthaltungen zählen nicht',
  ABSOLUTE_CAST: 'mehr als die Hälfte aller Stimmen, Enthaltungen zählen wie Nein',
  ABSOLUTE_PRESENT: 'mehr als die Hälfte der Anwesenden beim Schließen',
  ABSOLUTE_MEMBERS: 'mehr als die Hälfte der Mitglieder',
  TWO_THIRDS_VALID: 'mindestens doppelt so viele Ja wie Nein, Enthaltungen zählen nicht',
  TWO_THIRDS_CAST: 'mindestens zwei Drittel aller Stimmen, Enthaltungen zählen wie Nein',
  TWO_THIRDS_PRESENT: 'mindestens zwei Drittel der Anwesenden beim Schließen',
  TWO_THIRDS_MEMBERS: 'mindestens zwei Drittel der Mitglieder'
}

export function parseMajorityRule(value: unknown): MajorityRule | null {
  return typeof value === 'string' && Object.hasOwn(MAJORITY_RULES, value) ? (value as MajorityRule) : null
}

export type YesNoCounts = { yes: number; no: number; abstain: number }

/**
 * Ja, Nein und Enthaltung aus den Optionen einer Abstimmung (Reihenfolge nach position). null, wenn es keine
 * Ja/Nein/Enthaltung-Abstimmung ist - eine Wahl mit eigenen Optionen hat keine Mehrheitsregel.
 */
export function yesNoCounts(options: { label: string; votes: number }[]): YesNoCounts | null {
  if (options.length !== YES_NO_ABSTAIN.length || options.some((o, i) => o.label !== YES_NO_ABSTAIN[i])) return null
  return { yes: options[0].votes, no: options[1].votes, abstain: options[2].votes }
}

/**
 * adopted/rejected nach der Regel; no-quorum, wenn die Sitzung beim Schließen nicht beschlussfähig war (dann gibt es
 * keinen Beschluss, egal wie abgestimmt wurde); unknown, wenn die Bezugsgröße fehlt (rsvp-app beim Schließen nicht
 * erreichbar bzw. keine Zahl der Mitglieder).
 */
export type Verdict = {
  rule: MajorityRule
  outcome: 'adopted' | 'rejected' | 'no-quorum' | 'unknown'
  yes: number
  /** Bezugsgröße (Ja + Nein, alle Stimmen, Anwesende, Mitglieder); null = unbekannt. */
  base: number | null
  /** So viele Ja-Stimmen braucht der Antrag; bei der einfachen Mehrheit: mehr als Nein. */
  needed: number | null
}

/** Mindestzahl Ja: absolute Mehrheit = mehr als die Hälfte, zwei Drittel = mindestens zwei Drittel (aufgerundet). */
export function neededYes(share: 'half' | 'twoThirds', base: number): number {
  return share === 'half' ? Math.floor(base / 2) + 1 : Math.ceil((2 * base) / 3)
}

export function decide(
  rule: MajorityRule,
  counts: YesNoCounts,
  snapshot: { present: number | null; members: number | null; quorumMet: boolean | null }
): Verdict {
  const { share, base: baseKind } = MAJORITY_RULES[rule]
  const base = baseKind === 'valid' ? counts.yes + counts.no
    : baseKind === 'cast' ? counts.yes + counts.no + counts.abstain
    : baseKind === 'present' ? snapshot.present
    : snapshot.members
  const needed = share === 'simple' ? counts.no + 1 : base === null ? null : neededYes(share, base)
  const verdict = { rule, yes: counts.yes, base, needed }
  if (snapshot.quorumMet === false) return { ...verdict, outcome: 'no-quorum' }
  if (needed === null) return { ...verdict, outcome: 'unknown' }
  // Ohne eine einzige Ja-Stimme ist nichts angenommen (auch nicht bei Bezugsgröße 0)
  return { ...verdict, outcome: counts.yes > 0 && counts.yes >= needed ? 'adopted' : 'rejected' }
}

export const OUTCOME_LABEL: Record<Verdict['outcome'], string> = {
  adopted: 'angenommen',
  rejected: 'abgelehnt',
  'no-quorum': 'kein Beschluss (nicht beschlussfähig)',
  unknown: 'Mehrheit nicht bestimmbar'
}

/** Eine Zeile wie "angenommen: 12 Ja, nötig 11 (absolute Mehrheit der Anwesenden, 20)" - für Seiten, CSV und Protokoll. */
export function verdictDetail(verdict: Verdict): string {
  const { short, share, base } = MAJORITY_RULES[verdict.rule]
  if (verdict.needed === null) return `${short}: ${base === 'members' ? 'Zahl der Mitglieder' : 'Zahl der Anwesenden'} unbekannt`
  if (share === 'simple') return `${short}: ${verdict.yes} Ja, ${verdict.needed - 1} Nein`
  return `${short}: ${verdict.yes} Ja, nötig ${verdict.needed} von ${verdict.base}`
}

/** Ergebnis einer geschlossenen Abstimmung, sofern sie eine Regel hat und Ja/Nein/Enthaltung ist. */
export function verdictFor(
  poll: { assemblyMajority: string | null; assemblyPresent: number | null; assemblyMembers: number | null; assemblyQuorumMet: boolean | null },
  options: { label: string; votes: number }[]
): Verdict | null {
  const rule = parseMajorityRule(poll.assemblyMajority)
  const counts = yesNoCounts(options)
  if (!rule || !counts) return null
  return decide(rule, counts, { present: poll.assemblyPresent, members: poll.assemblyMembers, quorumMet: poll.assemblyQuorumMet })
}
