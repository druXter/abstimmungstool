// app/lib/voter-identity.ts
import type { VoterIdentity } from '@prisma/client'
import { getOrCreateVoterToken, getVoterToken } from './voter'
import { verifyRsvpToken } from './rsvp-verification'
import { getCurrentUser } from './auth'
import { getCurrentParticipant } from './participant'
import { prisma } from './prisma'
import { findVoterLink, secretBallotKey } from './voter-links'
import { getConfirmedEmail, isEmailAllowed } from './email-voters'
import { isMailConfigured } from './mail'

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
  /** Nur Modus LINK: der zugehörige VoterLink (für hasVoted). */
  linkId?: string
  /** Nur geheime Wahl: Stimme ohne Zeitstempel/zeitlich sortierbare ID speichern (siehe replaceVotes). */
  secret?: boolean
  /** Nur Modus ACCOUNT mit Teilnehmendenkonto: Anzeigename des Anbieters ("über rsvp-app"). */
  via?: string
}

/**
 * Warum (noch) nicht abgestimmt werden kann bzw. was die Oberfläche dazu sagen soll.
 * - rsvp-missing:  Modus RSVP, aber kein gültiger Token (direkter Aufruf ohne rsvp-app)
 * - rsvp-declined: Modus RSVP, Person hat für den Termin abgesagt
 * - account-missing: Modus ACCOUNT, niemand angemeldet
 * - link-missing:  Modus LINK, kein gültiger persönlicher Link
 * - email-missing: Modus EMAIL, Adresse in diesem Browser (noch) nicht bestätigt
 * - email-not-allowed: Modus EMAIL, bestätigte Adresse steht (inzwischen) nicht auf der Liste
 * - link-used:     geheime Wahl, mit diesem Link wurde schon abgestimmt, aber mit einem
 *                  inzwischen neu ausgestellten Token - die alte Stimme ist nicht mehr
 *                  auffindbar und darf nicht verdoppelt werden
 */
export type VoterBlock =
  | 'rsvp-missing' | 'rsvp-declined' | 'account-missing' | 'link-missing' | 'link-used'
  | 'email-missing' | 'email-not-allowed'

export type VoterState = {
  /** Bereits bekannte Identität - für "deine Auswahl" und die Stimmabgabe. */
  voter: Voter | null
  /** null = darf abstimmen (im Cookie-Modus auch ohne bisherige Identität, siehe resolveVoter). */
  block: VoterBlock | null
}

/** Die Modi in der Reihenfolge der Auswahl beim Anlegen/Bearbeiten. */
const ALL_IDENTITIES: readonly VoterIdentity[] = ['COOKIE', 'LINK', 'EMAIL', 'ACCOUNT', 'RSVP']

/** Was man wählen kann - EMAIL nur mit Mailversand (SMTP_HOST), sonst käme nie ein Bestätigungslink an. */
export function offeredIdentities(): readonly VoterIdentity[] {
  return isMailConfigured() ? ALL_IDENTITIES : ALL_IDENTITIES.filter(kind => kind !== 'EMAIL')
}

/** Liest den gewählten Modus aus einem Formular - alles Unbekannte fällt auf den Cookie-Standard zurück. */
export function parseVoterIdentity(value: FormDataEntryValue | null): VoterIdentity {
  return offeredIdentities().find(kind => kind === value) ?? 'COOKIE'
}

/**
 * Der gespeicherte Schlüssel einer Identität. Das Präfix macht Schlüssel verschiedener
 * Arten unverwechselbar - eine E-Mail aus rsvp-app und eine selbst bestätigte E-Mail sind
 * bewusst verschiedene Identitäten. Muss zu scripts/migrate-db.js passen.
 */
export function voterKey(kind: VoterIdentity, raw: string): string {
  return `${kind.toLowerCase()}:${raw}`
}

/** Schlüssel einer Stimme mit Teilnehmendenkonto (Modus ACCOUNT, siehe schema.prisma Participant). */
export function participantVoterKey(participantId: string): string {
  return `participant:${participantId}`
}

/** Was eine Anfrage an Identitäts-Nachweisen mitbringt (URL-Parameter bzw. versteckte Formularfelder). */
export type IdentityParams = { verifyToken?: string | null; linkToken?: string | null }

/**
 * Löst die Identität der aktuellen Anfrage für eine Abstimmung auf.
 *
 * `create`: nur beim tatsächlichen Abstimmen (Server Action) true - dann darf im
 * Cookie-Modus ein neues Cookie entstehen. Beim bloßen Anzeigen der Seite nicht (Server
 * Components dürfen keine Cookies setzen, und ein Besuch allein soll keins hinterlassen);
 * dort ist `voter` im Cookie-Modus null, solange noch nicht abgestimmt wurde.
 */
export async function resolveVoter(
  poll: { id: string; voterIdentity: VoterIdentity; secretBallot: boolean; allowedEmails: string | null },
  input: IdentityParams,
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
    case 'ACCOUNT': {
      // Jedes Konto dieses Tools, auch ein über den Verbund angelegtes (siehe README "Konten").
      // Schlüssel ist die Konto-ID, nie die E-Mail - die lässt sich ändern.
      const user = await getCurrentUser()
      if (user) return { voter: { kind: 'ACCOUNT', key: voterKey('ACCOUNT', user.id), name: user.name || user.email }, block: null }
      // Sonst ein Teilnehmendenkonto aus dem Verbund (app/lib/participant.ts). Gleiche Art ACCOUNT,
      // aber eigenes Präfix - Konto-IDs und Teilnehmenden-IDs können so nie zusammenfallen.
      const participant = await getCurrentParticipant()
      if (participant) {
        return { voter: { kind: 'ACCOUNT', key: participantVoterKey(participant.id), name: participant.name, via: participant.providerLabel }, block: null }
      }
      return { voter: null, block: 'account-missing' }
    }
    case 'LINK': {
      const link = await findVoterLink(poll.id, input.linkToken)
      if (!link || !input.linkToken) return { voter: null, block: 'link-missing' }
      if (!poll.secretBallot) {
        return { voter: { kind: 'LINK', key: voterKey('LINK', link.id), name: link.label, linkId: link.id }, block: null }
      }
      const voter: Voter = { kind: 'LINK', key: secretBallotKey(input.linkToken), name: null, linkId: link.id, secret: true }
      const reissuedAfterVoting = link.hasVoted && (await prisma.vote.count({ where: { pollId: poll.id, voterKey: voter.key } })) === 0
      return { voter, block: reissuedAfterVoting ? 'link-used' : null }
    }
    case 'EMAIL': {
      const email = await getConfirmedEmail(poll.id)
      if (!email) return { voter: null, block: 'email-missing' }
      const voter: Voter = { kind: 'EMAIL', key: voterKey('EMAIL', email), name: email }
      return { voter, block: isEmailAllowed(email, poll.allowedEmails) ? null : 'email-not-allowed' }
    }
  }
}
