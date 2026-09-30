// app/lib/voter-links.ts
import { createHash } from 'node:crypto'
import { prisma } from './prisma'
import { generateToken, hashToken } from './auth'
import { baseUrl } from './base-url'
import { normalizeEmail } from './form'
import { voterKey } from './voter-identity'

/**
 * Persönliche Stimmlinks (Modus LINK, siehe VoterLink in schema.prisma).
 *
 * Normalfall: Die Stimme hängt am Link (voterKey = link:<VoterLink.id>) und trägt dessen
 * Namen - so sieht die Verwaltung, wer was gewählt hat, und "neu ausstellen" behält die
 * bisherige Stimme.
 *
 * Geheime Wahl (Poll.secretBallot, "nur Teilnahme speichern"): Die Stimme hängt an einem
 * Schlüssel, der sich NUR aus dem Link-Token ableiten lässt (secretBallotKey). Die
 * Datenbank kennt den Token nie (nur tokenHash, eine andere Ableitung), kann eine Stimme
 * also keinem Link zuordnen; am Link steht nur hasVoted. Ehrliche Grenze: Wer die Links
 * verteilt hat, kennt die Tokens und damit die Zuordnung - das steht so auch in der
 * Oberfläche und im README.
 */

export const MAX_LINKS_PER_POLL = 500
export const MAX_LINK_LABEL_LENGTH = 100

export function issueLinkToken(): { token: string; tokenHash: string } {
  const token = generateToken()
  return { token, tokenHash: hashToken(token) }
}

export function voterLinkUrl(pollId: string, token: string): string {
  return `${baseUrl()}/${pollId}?k=${encodeURIComponent(token)}`
}

/** Der Link zu einem Token - nur, wenn er zu GENAU dieser Abstimmung gehört. */
export async function findVoterLink(pollId: string, token: string | null | undefined) {
  if (!token || token.length > 100) return null
  const link = await prisma.voterLink.findUnique({ where: { tokenHash: hashToken(token) } })
  return link && link.pollId === pollId ? link : null
}

/**
 * Schlüssel einer geheimen Stimme. Bewusst eine andere Ableitung als tokenHash (eigenes
 * Präfix): Aus dem gespeicherten tokenHash lässt sich dieser Schlüssel nicht berechnen.
 */
export function secretBallotKey(token: string): string {
  return voterKey('LINK', createHash('sha256').update(`ballot\u0000${token}`).digest('base64url'))
}

/**
 * Liest die Namensliste der Verwaltung: eine Person pro Zeile, optional mit E-Mail -
 * "Anna", "Anna <anna@example.org>", "Anna; anna@example.org", "Anna, anna@example.org"
 * oder nur "anna@example.org". Leere Zeilen zählen nicht.
 */
export function parseLinkList(text: string): { label: string; email: string | null }[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => {
      const angle = line.match(/^(.*?)\s*<([^<>]+)>$/)
      if (angle) {
        const email = normalizeEmail(angle[2])
        if (email) return { label: (angle[1].trim() || email).slice(0, MAX_LINK_LABEL_LENGTH), email }
      }
      const separator = Math.max(line.lastIndexOf(';'), line.lastIndexOf(','), line.lastIndexOf('\t'))
      if (separator > 0) {
        const email = normalizeEmail(line.slice(separator + 1))
        if (email) return { label: line.slice(0, separator).trim().slice(0, MAX_LINK_LABEL_LENGTH) || email, email }
      }
      const email = normalizeEmail(line)
      return { label: line.slice(0, MAX_LINK_LABEL_LENGTH), email }
    })
}
