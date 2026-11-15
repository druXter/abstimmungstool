// app/lib/rsvp-binding.ts
import { prisma } from './prisma'
import { rsvpAppBaseUrl } from './rsvp-date'

/**
 * Bindung einer Abstimmung an EINEN Termin in rsvp-app (Poll.rsvpEventId). Klick-Token (`poll-access`) und Zu-/Absage
 * (`poll-attendance`) tragen die `eventId` des Termins, der sie ausstellt. Den Abstimmungs-Link trägt dort die
 * Verwaltung des Termins frei ein - zugestimmt hat damit nur sie, nie, wem die Abstimmung gehört. Ohne Bindung könnte
 * jede Verwaltung eines beliebigen Termins Nachweise für fremde Abstimmungen ausstellen (Stimmen abgeben, per Absage
 * Stimmen löschen) und die Ergebnis-Meldung auf ihren Termin umlenken (rsvp-app docs/AUDIT-2026-11.md, R-02/R-04).
 *
 * Welcher Termin gilt, entscheidet die Besitzerin, nie die Reihenfolge (docs/AUDIT-2026-11.md, V-01 b): Jeder Termin,
 * der sich meldet (beim Speichern des Links in rsvp-app, beim Klick, bei einer Zu-/Absage), wird als Kandidat
 * vorgemerkt (RsvpEventCandidate); sie bestätigt einen auf der Verwaltungsseite. Ohne Rückfrage bindet nur die Meldung
 * beim Speichern des Links, wenn der Termin dem Konto gehört, das über den Suite-Verbund mit ihrem verknüpft ist
 * (bindIfOwnEvent). Lösen kann die Bindung, wer die Abstimmung besitzt (unlinkRsvpEvent in app/actions.ts) - danach
 * gilt wieder erst ein bestätigter Termin.
 *
 * Gebunden wird nur eine Abstimmung im Modus RSVP, die zu keiner Sitzung gehört: Alle anderen haben mit rsvp-app
 * nichts zu tun, eine Meldung dafür kommt von einem Termin, dessen Verwaltung den Link nur eingetragen hat - sie
 * bekäme sonst Titel und Ergebnis (auch hinter einem Zugangscode) auf ihre Event-Seite gemeldet (V-01 a).
 */

/** So viele unbestätigte Termine merkt sich eine Abstimmung höchstens - mehr meldet kein ehrlicher Termin. */
const MAX_CANDIDATES = 20

export type RsvpEventMatch = 'match' | 'other' | 'unconfirmed' | 'off'

type BindablePoll = { id: string; voterIdentity: string; assemblyId: string | null; rsvpEventId: string | null }

function bindable(poll: BindablePoll | null): poll is BindablePoll {
  return !!poll && poll.voterIdentity === 'RSVP' && !poll.assemblyId
}

/**
 * Passt ein Nachweis bzw. eine Meldung dieses Termins zur Abstimmung? `match` nur für den gebundenen Termin. Ist die
 * Abstimmung noch nicht gebunden, wird der Termin als Kandidat vorgemerkt (`unconfirmed`). `off`: kein Modus RSVP.
 */
export async function matchesRsvpEvent(pollId: string, eventId: string): Promise<RsvpEventMatch> {
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, select: { id: true, voterIdentity: true, assemblyId: true, rsvpEventId: true } })
  if (!bindable(poll)) return 'off'
  if (poll.rsvpEventId === eventId) return 'match'
  if (poll.rsvpEventId) return 'other'
  if (/^[A-Za-z0-9_-]{1,100}$/.test(eventId)) await rememberCandidate(poll.id, eventId, null)
  return 'unconfirmed'
}

/** Termin vormerken (Titel nur überschreiben, wenn einer mitkommt). Über der Höchstzahl wird nichts mehr vorgemerkt. */
export async function rememberCandidate(pollId: string, eventId: string, eventTitle: string | null): Promise<void> {
  const existing = await prisma.rsvpEventCandidate.findUnique({ where: { pollId_eventId: { pollId, eventId } }, select: { id: true } })
  if (existing) {
    if (eventTitle) await prisma.rsvpEventCandidate.update({ where: { id: existing.id }, data: { eventTitle } })
    return
  }
  if ((await prisma.rsvpEventCandidate.count({ where: { pollId } })) >= MAX_CANDIDATES) return
  // Gleichzeitige Meldungen desselben Termins: der Unique-Index hält es bei einem Eintrag
  await prisma.rsvpEventCandidate.create({ data: { pollId, eventId, eventTitle } }).catch(() => undefined)
}

/**
 * Bindet die Abstimmung an den Termin, wenn sie noch frei ist (bedingtes Update, auch bei gleichzeitigen Anfragen
 * genau einer). Ein schon gebundener Termin bekommt nur den neuen Titel. Gibt zurück, ob danach dieser Termin gilt.
 */
export async function bindRsvpEvent(pollId: string, eventId: string, eventTitle: string | null): Promise<boolean> {
  await prisma.poll.updateMany({
    where: { id: pollId, voterIdentity: 'RSVP', assemblyId: null, OR: [{ rsvpEventId: null }, { rsvpEventId: eventId }] },
    data: { rsvpEventId: eventId, ...(eventTitle ? { rsvpEventTitle: eventTitle } : {}) }
  })
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, select: { rsvpEventId: true } })
  if (poll?.rsvpEventId !== eventId) return false
  await prisma.rsvpEventCandidate.deleteMany({ where: { pollId, eventId } })
  return true
}

/**
 * Gehört der Termin dem Konto der Besitzerin? rsvp-app schickt die Konto-ID des Event-Owners dort (`rsvpUserId`) und,
 * falls dort über den Verbund verknüpft, seine Konto-ID hier (`toolUserId`). Zählt nur über eine Verbund-Verknüpfung,
 * nie über die E-Mail (wie die Terminübergabe, app/lib/rsvp-date.ts).
 */
export async function isOwnersEvent(ownerId: string | null, owner: { rsvpUserId: string | null; toolUserId: string | null }): Promise<boolean> {
  if (!ownerId) return false
  if (owner.toolUserId === ownerId) return true
  const base = rsvpAppBaseUrl()
  if (!owner.rsvpUserId || !base) return false
  const identity = await prisma.externalIdentity.findFirst({ where: { userId: ownerId, issuer: new URL(base).origin, subject: owner.rsvpUserId }, select: { id: true } })
  return !!identity
}
