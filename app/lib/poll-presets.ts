import type { Prisma } from '@prisma/client'

/**
 * Vorlagen beim Anlegen (docs/KONZEPT-OBERFLAECHE.md, wie die Event-Arten in rsvp-app): Wer anlegt, wählt nur, was
 * für eine Abstimmung es wird - die Vorlage setzt die passenden Einstellungen, alles Weitere geht danach unter
 * "Einstellungen". `optionKind` ist nur der Vorschlag für die Eingabe der Optionen (die Seite stellt bei
 * "Terminfindung" auf Tage um); gespeichert wird, was tatsächlich gewählt wurde.
 */
export type PollPreset = {
  title: string
  text: string
  /** Was die Vorlage einstellt, in Worten - für die Auswahl und den Hinweis nach dem Anlegen. */
  sets: string
  settings: Pick<Prisma.PollUncheckedCreateInput,
    'pollType' | 'voterIdentity' | 'secretBallot' | 'requireVoterName' | 'showVoterNames' | 'resultsVisibility' |
    'confirmDate' | 'allowVoterOptions' | 'voterOptionsNeedApproval' | 'pointsBudget' | 'notifyOwnerOnClose'>
  /** Wohin es nach dem Anlegen geht: die Übersicht oder direkt zu den Stimmlinks. */
  next: 'overview' | 'links'
  dateOptions?: boolean
}

const COMMON = { notifyOwnerOnClose: true, voterOptionsNeedApproval: true } as const

export const POLL_PRESETS = {
  umfrage: {
    title: 'Schnelle Umfrage',
    text: 'Eine Frage, ein Link für alle - z.B. "Wohin gehen wir am Mittwoch?".',
    sets: 'Auswahl, offen für alle mit dem Link, Ergebnis live sichtbar',
    settings: { ...COMMON, pollType: 'CHOICE', voterIdentity: 'COOKIE', resultsVisibility: 'ALWAYS' },
    next: 'overview'
  },
  termin: {
    title: 'Terminfindung',
    text: 'Wie bei Doodle: zu jedem Termin Ja, Vielleicht oder Nein, danach legst du den Termin fest.',
    sets: 'Ja/Vielleicht/Nein, Name beim Abstimmen, Namen sichtbar, Termin nach dem Ende festlegen (auch für rsvp-app)',
    settings: { ...COMMON, pollType: 'YES_MAYBE_NO', voterIdentity: 'COOKIE', requireVoterName: true, showVoterNames: true, confirmDate: true, resultsVisibility: 'ALWAYS' },
    next: 'overview',
    dateOptions: true
  },
  wahl: {
    title: 'Geheime Wahl',
    text: 'Jede Person bekommt einen eigenen Stimmlink und stimmt genau einmal ab, ohne dass jemand sieht, wie.',
    sets: 'Persönliche Stimmlinks, geheime Wahl, Ergebnis erst nach dem Ende',
    settings: { ...COMMON, pollType: 'CHOICE', voterIdentity: 'LINK', secretBallot: true, resultsVisibility: 'AFTER_CLOSE' },
    next: 'links'
  },
  ideen: {
    title: 'Ideen sammeln',
    text: 'Alle dürfen Vorschläge ergänzen und verteilen dann Punkte auf ihre Favoriten.',
    sets: 'Punkte verteilen (10 pro Person), Vorschläge von Teilnehmenden nach deiner Freigabe',
    settings: { ...COMMON, pollType: 'POINTS', pointsBudget: 10, voterIdentity: 'COOKIE', allowVoterOptions: true, resultsVisibility: 'ALWAYS' },
    next: 'overview'
  }
} satisfies Record<string, PollPreset>

export type PresetId = keyof typeof POLL_PRESETS
export const PRESET_IDS = Object.keys(POLL_PRESETS) as PresetId[]

/** Liest die gewählte Vorlage - Unbekanntes (auch "toString" o.ä.) fällt auf die schnelle Umfrage zurück. */
export function presetOf(value: FormDataEntryValue | null | undefined): PresetId {
  return typeof value === 'string' && Object.hasOwn(POLL_PRESETS, value) ? (value as PresetId) : 'umfrage'
}
