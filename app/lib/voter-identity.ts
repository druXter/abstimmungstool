// app/lib/voter-identity.ts
import type { VoterIdentity } from '@prisma/client'
import { getOrCreateVoterToken, getVoterToken } from './voter'
import { verifyRsvpToken } from './rsvp-verification'

/**
 * Die EINE Stelle, die aus einer Anfrage die Identität einer abstimmenden Person macht -
 * je nach Poll.voterIdentity (siehe schema.prisma). Abstimmungsseite und castVote gehen
 * beide hierüber, damit "wer darf abstimmen, und als wer" nur einmal entschieden wird.
 */

export type Voter = {
  kind: VoterIdentity
  /** Eindeutig pro Person und Abstimmung, mit der Art als Präfix (siehe voterKey). */
  key: string
  /** Wird bei showVoterNames bzw. auf der Verwaltungsseite angezeigt. Im Cookie-Modus null (castVote setzt ggf. den Pflichtnamen). */
  name: string | null
}

/**
 * Warum (noch) nicht abgestimmt werden kann bzw. was die Oberfläche dazu sagen soll.
 * - rsvp-missing:  Modus RSVP, aber kein gültiger Token (direkter Aufruf ohne rsvp-app)
 * - rsvp-declined: Modus RSVP, Person hat für den Termin abgesagt
 * - unavailable:   Modus ist vorgesehen, aber noch nicht umgesetzt (fail-closed)
 */
export type VoterBlock = 'rsvp-missing' | 'rsvp-declined' | 'unavailable'

export type VoterState = {
  /** Bereits bekannte Identität - für "deine Auswahl" und die Stimmabgabe. */
  voter: Voter | null
  /** null = darf abstimmen (im Cookie-Modus auch ohne bisherige Identität, siehe resolveVoter). */
  block: VoterBlock | null
}

/** Die Modi, die man beim Anlegen/Bearbeiten wählen kann (die übrigen sind noch nicht umgesetzt). */
export const OFFERED_IDENTITIES: readonly VoterIdentity[] = ['COOKIE', 'RSVP']

/** Liest den gewählten Modus aus einem Formular - alles Unbekannte fällt auf den Cookie-Standard zurück. */
export function parseVoterIdentity(value: FormDataEntryValue | null): VoterIdentity {
  return OFFERED_IDENTITIES.find(kind => kind === value) ?? 'COOKIE'
}

/**
 * Der gespeicherte Schlüssel einer Identität. Das Präfix macht Schlüssel verschiedener
 * Arten unverwechselbar - eine E-Mail aus rsvp-app und eine selbst bestätigte E-Mail sind
 * bewusst verschiedene Identitäten. Muss zu scripts/migrate-db.js passen.
 */
export function voterKey(kind: VoterIdentity, raw: string): string {
  return `${kind.toLowerCase()}:${raw}`
}

/**
 * Löst die Identität der aktuellen Anfrage für eine Abstimmung auf.
 *
 * `create`: nur beim tatsächlichen Abstimmen (Server Action) true - dann darf im
 * Cookie-Modus ein neues Cookie entstehen. Beim bloßen Anzeigen der Seite nicht (Server
 * Components dürfen keine Cookies setzen, und ein Besuch allein soll keins hinterlassen);
 * dort ist `voter` im Cookie-Modus null, solange noch nicht abgestimmt wurde.
 */
export async function resolveVoter(
  poll: { id: string; voterIdentity: VoterIdentity },
  input: { verifyToken?: string | null },
  { create }: { create: boolean }
): Promise<VoterState> {
  switch (poll.voterIdentity) {
    case 'COOKIE': {
      const token = create ? await getOrCreateVoterToken() : await getVoterToken()
      return { voter: token ? { kind: 'COOKIE', key: voterKey('COOKIE', token), name: null } : null, block: null }
    }
    case 'RSVP': {
      // Nur der Modus entscheidet, nie die bloße Anwesenheit eines ?verify=-Parameters - bei
      // anderen Modi wird ein mitgeschickter Token ignoriert. Kein Token -> keine Stimme,
      // bewusst ohne Cookie-Fallback (siehe schema.prisma).
      const identity = verifyRsvpToken(input.verifyToken, poll.id)
      if (!identity) return { voter: null, block: 'rsvp-missing' }
      const voter: Voter = { kind: 'RSVP', key: voterKey('RSVP', identity.email), name: identity.email }
      return { voter, block: identity.attending ? null : 'rsvp-declined' }
    }
    case 'LINK':
    case 'EMAIL':
    case 'ACCOUNT':
      return { voter: null, block: 'unavailable' }
  }
}
