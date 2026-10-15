// app/lib/assembly.ts
//
// Sitzungen (Idee L7, docs/KONZEPT-SITZUNG.md): Rechte, Mitglied dieses Browsers, wer abstimmen darf, Beschlussfähigkeit.
// Mitglieder kommen nur über rsvp-app (app/lib/assembly-coupling.ts), die Anwesenheit fragt fetchRoster dort ab.
import { createHmac } from 'node:crypto'
import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { cookieOptions, generateToken, hashToken, type CurrentUser } from './auth'
import { fetchRoster, type Roster } from './assembly-coupling'

export const MAX_ASSEMBLY_TITLE = 200
export const MAX_QUORUM = 10_000
/** Ja/Nein/Enthaltung - die übliche Beschlussabstimmung. */
export const YES_NO_ABSTAIN = ['Ja', 'Nein', 'Enthaltung']
/** So lange gilt der Beitritt in diesem Browser - eine Sitzung dauert selten länger, danach erneut über rsvp-app. */
const MEMBER_COOKIE_HOURS = 24

/**
 * owner:     alles (Einstellungen, Abstimmungen, Rednerliste, Verknüpfung lösen, löschen, teilen)
 * moderator: per AssemblyAccess geteilt - alles außer löschen und weiter teilen (wie Fragebögen)
 */
export type AssemblyLevel = 'owner' | 'moderator'

/** DIE Berechtigungsprüfung für Sitzungen - jede Verwaltungsseite und jede Action geht hierüber. */
export async function getAssemblyLevel(user: CurrentUser | null, assembly: { id: string; ownerId: string }): Promise<AssemblyLevel | null> {
  if (!user) return null
  if (user.role === 'ADMIN' || user.id === assembly.ownerId) return 'owner'
  const access = await prisma.assemblyAccess.findUnique({ where: { assemblyId_userId: { assemblyId: assembly.id, userId: user.id } }, select: { id: true } })
  return access ? 'moderator' : null
}

function memberCookie(assemblyId: string): string {
  return `assembly_${assemblyId}`
}

/** Token des Mitglieds-Cookies dieses Browsers (nur lesen). */
export async function memberToken(assemblyId: string): Promise<string | null> {
  return (await cookies()).get(memberCookie(assemblyId))?.value ?? null
}

/** Das Mitglied dieses Browsers, sonst null. Setzt nie ein Cookie. */
export async function currentMember(assemblyId: string) {
  const token = await memberToken(assemblyId)
  if (!token) return null
  return prisma.assemblyMember.findFirst({ where: { tokenHash: hashToken(token), assemblyId } })
}

/**
 * Beitritt (nur aus der Route /sitzung/<id>/beitreten): legt das Mitglied an oder aktualisiert den Namen, gibt ihm
 * ein neues Token (ein Beitritt von einem anderen Gerät meldet das bisherige ab) und setzt das Cookie.
 */
export async function joinAssembly(assemblyId: string, sub: string, name: string): Promise<void> {
  const token = generateToken()
  const tokenHash = hashToken(token)
  await prisma.assemblyMember.upsert({
    where: { assemblyId_sub: { assemblyId, sub } },
    update: { name, tokenHash },
    create: { assemblyId, sub, name, tokenHash }
  })
  ;(await cookies()).set(memberCookie(assemblyId), token, cookieOptions(MEMBER_COOKIE_HOURS * 60 * 60))
}

/**
 * Schlüssel einer geheimen Stimme: aus dem Cookie-Token (das die Datenbank nie sieht) und der Abstimmung - wie die
 * geheime Wahl mit Stimmlinks. Aus tokenHash lässt er sich nicht berechnen, und verschiedene Abstimmungen desselben
 * Mitglieds ergeben verschiedene Schlüssel.
 */
export function assemblySecretKey(token: string, pollId: string): string {
  return `assembly-secret:${createHmac('sha256', token).update(pollId).digest('base64url')}`
}

export function assemblyMemberKey(memberId: string): string {
  return `assembly:${memberId}`
}

/** Hat das Mitglied an dieser Abstimmung teilgenommen? (AssemblyMember.votedPolls) */
export function hasVoted(member: { votedPolls: string }, pollId: string): boolean {
  return member.votedPolls.split(' ').includes(pollId)
}

export function withVoted(votedPolls: string, pollId: string): string {
  return hasVoted({ votedPolls }, pollId) ? votedPolls : [votedPolls, pollId].filter(Boolean).join(' ')
}

/**
 * Darf dieses Mitglied gerade abstimmen bzw. sich zu Wort melden? Ohne "Nur Anwesende" immer; sonst nur, wenn rsvp-app
 * es gerade als anwesend meldet. `fresh` beim Abstimmen selbst (kein Zwischenspeicher).
 */
export type PresenceCheck = 'ok' | 'absent' | 'unreachable' | 'no-checkin'

export async function checkPresence(
  assembly: { id: string; rsvpEventId: string | null; presenceRequired: boolean },
  member: { sub: string },
  { fresh = false } = {}
): Promise<PresenceCheck> {
  if (!assembly.presenceRequired) return 'ok'
  const roster = await fetchRoster(assembly, { fresh })
  if (roster.state !== 'ok') return 'unreachable'
  if (!roster.checkin) return 'no-checkin'
  return roster.present.has(member.sub) ? 'ok' : 'absent'
}

export type QuorumState = { present: number | null; members: number | null; quorum: number | null; met: boolean | null; checkin: boolean | null; reachable: boolean }

/** Anwesende, Zusagen und Beschlussfähigkeit für Verwaltung, Mitglieder und beim Schließen einer Abstimmung. */
export function quorumState(assembly: { quorum: number | null }, roster: Roster): QuorumState {
  if (roster.state !== 'ok') return { present: null, members: null, quorum: assembly.quorum, met: null, checkin: null, reachable: roster.state === 'off' }
  const present = roster.present.size
  return { present, members: roster.members, quorum: assembly.quorum, met: assembly.quorum === null ? null : present >= assembly.quorum, checkin: roster.checkin, reachable: true }
}

/** Neue Abstimmung oder Rednerliste geändert: Mitgliederansichten laden neu (app/api/sitzung/[id]/stand). */
export async function bumpAssembly(assemblyId: string) {
  await prisma.assembly.update({ where: { id: assemblyId }, data: { version: { increment: 1 } } })
}

/** Rednerliste in Reihenfolge: aufgerufen zuerst, dann GO-Anträge, dann Wortmeldungen, je nach Zeit. */
export function speakerOrder<T extends { kind: string; createdAt: Date; calledAt: Date | null }>(speakers: T[]): T[] {
  const rank = (s: T) => (s.calledAt ? 0 : s.kind === 'GO' ? 1 : 2)
  return [...speakers].sort((a, b) => rank(a) - rank(b) || (a.calledAt?.getTime() ?? 0) - (b.calledAt?.getTime() ?? 0) || a.createdAt.getTime() - b.createdAt.getTime())
}

export const SPEAKER_KIND_LABEL: Record<string, string> = { SPEAK: 'Wortmeldung', GO: 'GO-Antrag' }
