// app/lib/throttle.ts
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { prisma } from './prisma'
// Grenzen aller IP-Regeln - eigene Datei ohne Server-Abhängigkeiten, damit auch die Tests sie nutzen können.
import { IP_LIMITS, type IpLimits } from './throttle-limits'

/**
 * Begrenzt Versuche (Passwort-Raten, Mail-Flut über "Passwort vergessen"). Mehrere Regeln
 * gelten gleichzeitig - schlägt IRGENDEINE an, ist der Versuch gesperrt:
 *
 * - pro IP-Adresse: bremst automatisiertes Durchprobieren vieler Konten (Password
 *   Spraying) von einem Rechner aus.
 * - pro Ziel-E-Mail (unabhängig von der IP): bremst verteiltes Raten gegen EIN Konto
 *   von vielen Adressen aus, das die IP-Regel allein nicht sieht.
 *
 * WICHTIG - reservieren statt nachzählen: Der Versuch wird VOR der Passwortprüfung
 * atomar mitgezählt (reserve). Würde man erst prüfen und danach zählen, könnte jemand
 * viele Anfragen GLEICHZEITIG abschicken: Alle bestünden den Check, bevor der erste
 * Fehlversuch verbucht ist, und er bekäme weit mehr als das Limit an Versuchen. Ein
 * erfolgreicher Login gibt seinen Versuch wieder zurück (refund) bzw. setzt den
 * E-Mail-Zähler zurück - der IP-Zähler wird nie ganz zurückgesetzt, sonst könnte ein
 * Angreifer mit einem eigenen gültigen Konto seinen Zähler beliebig zurückstellen.
 *
 * Bewusst KEINE endgültige Kontosperre: sonst könnte jeder ein fremdes Konto dauerhaft
 * lahmlegen, indem er es absichtlich falsch anmeldet. Die Sperre endet mit dem
 * Zeitfenster (es gleitet nicht - gesperrte Versuche verlängern die Sperre also nicht).
 * Ein Angreifer kann ein Konto damit höchstens phasenweise stören, nicht dauerhaft
 * aussperren - und die Anmeldung über ein verbundenes Tool ist davon ohnehin nicht betroffen.
 *
 * Gespeichert werden nur SHA-256-Hashes von Bereich + Kennung, keine E-Mails/IPs im Klartext.
 */

export type ThrottleRule = { scope: string; identifier: string; limit: number; windowMs: number }

const MINUTE = 60 * 1000

export const LOGIN_WINDOW_MS = 15 * MINUTE

function keyOf(rule: Pick<ThrottleRule, 'scope' | 'identifier'>): string {
  return createHash('sha256').update(`${rule.scope}\u0000${rule.identifier}`).digest('hex')
}

/**
 * Die IP-Adresse des Besuchers hinter unserem Reverse Proxy. X-Forwarded-For darf nur
 * so weit vertraut werden, wie eigene Proxys davorstehen: Jeder Proxy HÄNGT die Adresse,
 * die er sieht, hinten an - der Wert ganz links kann vom Client frei erfunden sein.
 * Deshalb zählt der Eintrag von rechts (TRUST_PROXY_HOPS, Standard 1 = ein Proxy wie
 * nginx-proxy). 0 ignoriert den Header komplett (direkter Zugriff ohne Proxy).
 */
export async function clientIp(): Promise<string> {
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10)
  if (!Number.isInteger(hops) || hops < 1) return 'unknown'

  const forwarded = (await headers()).get('x-forwarded-for')
  if (!forwarded) return 'unknown'
  const parts = forwarded.split(',').map(p => p.trim()).filter(Boolean)
  const ip = parts[parts.length - hops]
  return ip ? normalizeIp(ip) : 'unknown'
}

/** Die acht Gruppen einer IPv6-Adresse (ohne führende Nullen, klein geschrieben), sonst null. */
function ipv6Groups(ip: string): string[] | null {
  if (!ip.includes(':')) return null
  const plain = ip.toLowerCase().split('%')[0]
  const [head, tail = ''] = plain.split('::')
  const left = head ? head.split(':') : []
  const right = plain.includes('::') && tail ? tail.split(':') : []
  const groups = plain.includes('::') ? [...left, ...Array(Math.max(8 - left.length - right.length, 0)).fill('0'), ...right] : left
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map(g => g.replace(/^0+(?=.)/, ''))
}

/**
 * Einheitliche Schreibweise, damit dieselbe Adresse immer denselben Zähler trifft: IPv4 unverändert, IPv4 in
 * IPv6-Schreibweise (::ffff:1.2.3.4) als IPv4, IPv6 mit allen acht Gruppen.
 */
export function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (mapped) return mapped[1]
  return ipv6Groups(ip)?.join(':') ?? ip
}

/** Das /64-Netz einer IPv6-Adresse ("2001:db8:1:2::/64"), null bei IPv4. */
export function ipv6Network(ip: string): string | null {
  const groups = ipv6Groups(ip)
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : null
}

/**
 * Zweistufige IP-Regeln (aufsteigend von grob zu fein, wie reserve sie erwartet):
 *
 * - IPv4: EINE Regel je Adresse mit der Netz-Grenze. Hinter einer IPv4-Adresse steckt oft ein NAT (Uni-WLAN,
 *   Mobilfunk) mit vielen Menschen - ein einzelner Angreifer ist davon nicht zu unterscheiden, also NAT-tauglich.
 * - IPv6: je /64-Netz die Netz-Grenze UND je Adresse die (niedrigere) Adress-Grenze. Zu Hause und im Mobilfunk hat
 *   ein Anschluss ein ganzes /64 und könnte darin beliebig viele Adressen nutzen - je Adresse allein gezählt, ließe
 *   sich jede Drossel mit wechselnden Adressen umgehen. In Uni- und Firmen-WLANs teilen sich dagegen viele Geräte
 *   ein /64, jedes mit eigener Adresse - je Netz allein gezählt, würde ein Hörsaal schnell gemeinsam gesperrt. Beide
 *   Stufen zusammen: ein Hörsaal hat dieselbe Grenze wie hinter einem IPv4-NAT, ein einzelnes Gerät eine kleinere.
 *
 * `prefix` grenzt den Zähler ein (z.B. auf eine Abstimmung: "<pollId>\0").
 */
export function ipRules(scope: string, ip: string, limits: IpLimits, windowMs: number, prefix = ''): ThrottleRule[] {
  const network = ipv6Network(ip)
  if (!network) return [{ scope, identifier: `${prefix}${ip}`, limit: limits.network, windowMs }]
  return [
    { scope: `${scope}:net`, identifier: `${prefix}${network}`, limit: limits.network, windowMs },
    { scope, identifier: `${prefix}${ip}`, limit: limits.address, windowMs }
  ]
}

/**
 * Zählt einen Versuch für EINE Regel atomar mit und gibt den Zählerstand danach zurück.
 * Ein abgelaufenes Zeitfenster wird dabei zuerst (ebenfalls atomar, per bedingtem Update)
 * auf ein neues zurückgesetzt.
 */
async function bump(rule: ThrottleRule): Promise<number> {
  const key = keyOf(rule)
  const now = new Date()
  await prisma.loginThrottle.updateMany({
    where: { key, windowStart: { lte: new Date(now.getTime() - rule.windowMs) } },
    data: { count: 0, windowStart: now }
  })
  const row = await prisma.loginThrottle.upsert({
    where: { key },
    create: { key, count: 1, windowStart: now },
    update: { count: { increment: 1 } }
  })
  return row.count
}

/**
 * Reserviert einen Versuch gegen alle Regeln. Gibt false zurück, wenn er gesperrt ist -
 * dann darf KEINE Passwortprüfung mehr stattfinden. Bei der ersten greifenden Regel wird
 * abgebrochen, damit ein durch die IP-Regel Gesperrter nicht zusätzlich den Zähler der
 * Ziel-E-Mail hochtreibt. Die Regeln daher von der gröbsten (IP) zur feinsten (E-Mail) angeben.
 */
export async function reserve(rules: ThrottleRule[]): Promise<boolean> {
  let allowed = true
  for (const rule of rules) {
    if ((await bump(rule)) > rule.limit) {
      allowed = false
      break
    }
  }

  // Abgelaufene Zähler bei Gelegenheit entfernen - die Tabelle soll nicht unbegrenzt wachsen.
  await prisma.loginThrottle.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 24 * 60 * MINUTE) } } })
  return allowed
}

/** Gibt einen zuvor reservierten Versuch zurück (erfolgreicher Login, richtige PIN bzw. richtiger Zugangscode). */
export async function refund(rules: ThrottleRule | ThrottleRule[]): Promise<void> {
  for (const rule of Array.isArray(rules) ? rules : [rules]) {
    await prisma.loginThrottle.updateMany({ where: { key: keyOf(rule), count: { gt: 0 } }, data: { count: { decrement: 1 } } })
  }
}

export async function clearFailures(rules: ThrottleRule[]): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { key: { in: rules.map(keyOf) } } })
}

export { IP_LIMITS, type IpLimits }

/** Regeln für den Passwort-Login: IP-weit großzügiger, pro Konto strenger. Ein Erfolg gibt die IP-Versuche zurück. */
export function loginRules(ip: string, email: string): { ip: ThrottleRule[]; email: ThrottleRule } {
  return {
    ip: ipRules('login:ip', ip, IP_LIMITS.login, LOGIN_WINDOW_MS),
    email: { scope: 'login:email', identifier: email, limit: 10, windowMs: LOGIN_WINDOW_MS }
  }
}

/** Regeln für "Passwort vergessen" (jede Anfrage zählt): verhindert, dass jemand fremde Postfächer mit Mails flutet. */
export function resetRules(ip: string, email: string): ThrottleRule[] {
  return [
    ...ipRules('reset:ip', ip, IP_LIMITS.reset, 60 * MINUTE),
    { scope: 'reset:email', identifier: email, limit: 3, windowMs: 60 * MINUTE }
  ]
}

/** Regel für die Passwort-Abfrage bei "Passwort ändern" (Schutz gegen eine gekaperte Sitzung). */
export function passwordChangeRule(userId: string): ThrottleRule {
  return { scope: 'pwchange:user', identifier: userId, limit: 10, windowMs: LOGIN_WINDOW_MS }
}

/**
 * Regeln gegen das massenhafte Erzeugen neuer Cookie-Identitäten (Modus COOKIE): zählt pro
 * IP und Abstimmung nur ERSTE Stimmabgaben, Änderungen der eigenen Auswahl nicht. Großzügig je Netz, weil sich
 * viele Menschen hinter einem NAT bzw. in einem /64 (Uni-WLAN, Mobilfunk) eine Adresse teilen - das bremst Skripte,
 * keine Gruppe am selben WLAN.
 */
export function newVoterRules(ip: string, pollId: string): ThrottleRule[] {
  return ipRules('vote:new:ip', ip, IP_LIMITS.newVoter, 60 * MINUTE, `${pollId}\u0000`)
}

/**
 * Regeln gegen das Durchprobieren von Zugangscodes (kurze PINs wären sonst schnell erraten). Ein richtiger Code gibt
 * seinen Versuch zurück (unlockPoll) - sonst sperrten sich in einem vollen Raum alle gegenseitig aus.
 */
export function accessCodeRules(ip: string, pollId: string): ThrottleRule[] {
  return ipRules('poll:code:ip', ip, IP_LIMITS.accessCode, LOGIN_WINDOW_MS, `${pollId}\u0000`)
}

/**
 * Regeln für Bestätigungsmails im Modus EMAIL (jede Anfrage zählt): pro IP gegen das Fluten
 * vieler fremder Postfächer, pro Adresse und Abstimmung gegen das Fluten eines einzelnen.
 */
export function voteEmailRules(ip: string, email: string, pollId: string): ThrottleRule[] {
  return [
    ...ipRules('vote-mail:ip', ip, IP_LIMITS.voteMail, 60 * MINUTE),
    { scope: 'vote-mail:email', identifier: `${pollId}\u0000${email}`, limit: 3, windowMs: 60 * MINUTE }
  ]
}

/** Regeln für Options-Vorschläge von Teilnehmenden: pro IP und Abstimmung, gegen das Zumüllen der Liste. */
export function suggestionRules(ip: string, pollId: string): ThrottleRule[] {
  return ipRules('suggest:ip', ip, IP_LIMITS.suggestion, 60 * MINUTE, `${pollId}\u0000`)
}

/**
 * Regeln für den Beitritt zu einer Live-Runde: falsche PINs pro IP (gegen das Durchprobieren der
 * 6-stelligen PINs - ein erfolgreicher Beitritt gibt seinen Versuch zurück) und Beitritte pro IP
 * und Runde (gegen das Fluten der Lobby mit Fantasienamen). Großzügig je Netz, weil eine ganze Klasse
 * oder ein Saal oft hinter einer Adresse bzw. in einem /64 sitzt.
 */
export function livePinRules(ip: string): ThrottleRule[] {
  return ipRules('live:pin:ip', ip, IP_LIMITS.livePin, LOGIN_WINDOW_MS)
}

export function liveJoinRules(ip: string, sessionId: string): ThrottleRule[] {
  return ipRules('live:join:ip', ip, IP_LIMITS.liveJoin, 60 * MINUTE, `${sessionId}\u0000`)
}

/**
 * Regeln für Fragebögen: zählen pro IP und Fragebogen jede anonyme Abgabe bzw. im Modus COOKIE die erste Abgabe
 * eines Geräts (Änderungen nicht). Netz-Grenze = Survey.submitLimit (Standard 200 pro Stunde, in den Einstellungen
 * änderbar, z.B. vor einer großen Veranstaltung); ein einzelnes IPv6-Gerät höchstens IP_LIMITS.survey.address.
 */
export function surveyRules(ip: string, surveyId: string, networkLimit: number = IP_LIMITS.survey.network): ThrottleRule[] {
  return ipRules('survey:ip', ip, { address: Math.min(IP_LIMITS.survey.address, networkLimit), network: networkLimit }, 60 * MINUTE, `${surveyId}\u0000`)
}
