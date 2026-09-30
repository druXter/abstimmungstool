// app/lib/final-date.ts
import type { OptionKind } from '@prisma/client'
import { prisma } from './prisma'
import { baseUrl } from './base-url'
import { formatDateOption } from './date-options'
import { isMailConfigured, sendFinalDateEmail } from './mail'
import { sendPushToUser } from './push'
import type { PollResult } from './results'

/**
 * Terminabstimmung abschließen (Poll.confirmDate, nur bei Terminoptionen). Nie vollautomatisch:
 * Nach dem Ende bestätigt die Verwaltung ein eindeutiges Ergebnis bzw. entscheidet bei
 * Gleichstand zwischen den gleichauf liegenden Terminen (confirmPollDate in app/actions.ts).
 * Danach werden die erreichbaren Abstimmenden benachrichtigt (voterContacts/notifyVoters) und
 * der Termin an rsvp-app übergeben (app/lib/rsvp-date.ts).
 */

type DecisionPoll = { confirmDate: boolean; optionKind: OptionKind; finalizedAt: Date | null; closedAt: Date | null }

/** Steht eine Festlegung an? (Geschlossen, Terminabstimmung, noch nicht festgelegt, gültiges Ergebnis.) */
export function needsDecision(poll: DecisionPoll, result: PollResult): boolean {
  return poll.confirmDate && poll.optionKind !== 'TEXT' && !poll.finalizedAt && !!poll.closedAt && result.quorumMet && result.winners.length > 0
}

/** Der festgelegte Termin als Text - immer mit Uhrzeit (bei Tagen die beim Festlegen angegebene). */
export function finalDateLabel(startsAt: Date): string {
  return formatDateOption(startsAt, 'DATETIME')
}

/**
 * Wie die Abstimmenden erreichbar sind - je Art der Stimmabgabe:
 * - EMAIL: die bestätigte Adresse; LINK: die beim Ausstellen eingetragene Adresse (auch bei
 *   geheimer Wahl - dort ist bekannt, WER abgestimmt hat, nur nicht wofür).
 * - ACCOUNT: Push auf den Geräten des Kontos, sonst Mail an seine Adresse.
 * - RSVP: die von rsvp-app bestätigte Adresse - separat, weil rsvp-app diese Personen selbst
 *   benachrichtigt, sobald eines seiner Events den Termin übernommen hat.
 * - COOKIE: niemand (anonym) - die Oberfläche sagt das.
 */
export type VoterContacts = { mail: string[]; accounts: { userId: string; email: string }[]; rsvpMail: string[] }

export async function voterContacts(pollId: string): Promise<VoterContacts> {
  const keys = await prisma.vote.groupBy({ by: ['voterKey', 'identityKind'], where: { pollId } })
  const mail = new Set<string>()
  const rsvpMail = new Set<string>()
  const accountIds: string[] = []
  for (const { voterKey, identityKind } of keys) {
    const raw = voterKey.slice(voterKey.indexOf(':') + 1)
    if (identityKind === 'EMAIL') mail.add(raw)
    else if (identityKind === 'RSVP') rsvpMail.add(raw)
    else if (identityKind === 'ACCOUNT') accountIds.push(raw)
  }
  const links = await prisma.voterLink.findMany({ where: { pollId, hasVoted: true, email: { not: null } }, select: { email: true } })
  for (const link of links) mail.add(link.email!)
  const accounts = await prisma.user.findMany({ where: { id: { in: accountIds } }, select: { id: true, email: true } })
  return { mail: [...mail], accounts: accounts.map(a => ({ userId: a.id, email: a.email })), rsvpMail: [...rsvpMail] }
}

export function reachableCount(contacts: VoterContacts): number {
  return new Set([...contacts.mail, ...contacts.rsvpMail, ...contacts.accounts.map(a => a.email)]).size
}

/**
 * Benachrichtigt die Abstimmenden über den festgelegten Termin. Push nur für Konten (auf den
 * Geräten, wo Mitteilungen an sind), sonst Mail. RSVP-Abstimmende nur, wenn rsvp-app es nicht
 * schon tut (`rsvpCovered`). Jede Adresse höchstens einmal. Best-effort.
 */
export async function notifyVoters(
  poll: { id: string; title: string },
  startsAt: Date,
  contacts: VoterContacts,
  { rsvpCovered, eventUrl }: { rsvpCovered: boolean; eventUrl: string | null }
): Promise<void> {
  const label = finalDateLabel(startsAt)
  const pollLink = `${baseUrl()}/${poll.id}`
  const mailed = new Set<string>()
  const mail = async (email: string) => {
    if (mailed.has(email) || !isMailConfigured()) return
    mailed.add(email)
    await sendFinalDateEmail(email, poll.title, label, pollLink, eventUrl).catch(() => false)
  }

  for (const account of contacts.accounts) {
    const delivered = await sendPushToUser(account.userId, { title: `Termin steht fest: ${poll.title}`, body: label, url: `/${poll.id}` }).catch(() => 0)
    if (delivered === 0) await mail(account.email)
    else mailed.add(account.email)
  }
  for (const email of contacts.mail) await mail(email)
  if (!rsvpCovered) for (const email of contacts.rsvpMail) await mail(email)
}
