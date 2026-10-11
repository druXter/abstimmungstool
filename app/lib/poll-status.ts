import type { VoterIdentity } from '@prisma/client'
import type { Tone } from '../ui/kit'

/** Kurzform von "Wer darf abstimmen?" für Kopfzeilen und die Übersicht (ausführlich: poll-settings-fields.tsx). */
export const IDENTITY_SHORT: Record<VoterIdentity, string> = {
  COOKIE: 'offen für alle mit dem Link',
  LINK: 'persönliche Stimmlinks',
  EMAIL: 'mit bestätigter E-Mail-Adresse',
  ACCOUNT: 'nur mit Konto',
  RSVP: 'nur über rsvp-app'
}

export type PollStatus = { state: 'open' | 'expired' | 'closed'; badge: string; tone: Tone; text: string }

/**
 * Stand einer Abstimmung für die Anzeige: offen, abgelaufen (Schließdatum vorbei, der Cron hat sie noch nicht
 * geschlossen - der Schließen-Knopf bleibt dann, er löst die Meldungen aus) oder geschlossen.
 */
export function pollStatus(poll: { closedAt: Date | null; closesAt: Date | null }, now = new Date()): PollStatus {
  const format = (date: Date) => date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  if (poll.closedAt) return { state: 'closed', badge: 'geschlossen', tone: 'gray', text: `geschlossen am ${format(poll.closedAt)}` }
  if (poll.closesAt && poll.closesAt < now) return { state: 'expired', badge: 'abgelaufen', tone: 'amber', text: `abgelaufen am ${format(poll.closesAt)}` }
  if (poll.closesAt) return { state: 'open', badge: 'offen', tone: 'green', text: `endet am ${format(poll.closesAt)}` }
  return { state: 'open', badge: 'offen', tone: 'green', text: 'offen ohne Enddatum' }
}
