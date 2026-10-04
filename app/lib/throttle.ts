// app/lib/throttle.ts
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { prisma } from './prisma'

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
  return parts[parts.length - hops] ?? 'unknown'
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

/** Gibt einen zuvor reservierten Versuch zurück (erfolgreicher Login). */
export async function refund(rule: ThrottleRule): Promise<void> {
  await prisma.loginThrottle.updateMany({ where: { key: keyOf(rule), count: { gt: 0 } }, data: { count: { decrement: 1 } } })
}

export async function clearFailures(rules: ThrottleRule[]): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { key: { in: rules.map(keyOf) } } })
}

/** Regeln für den Passwort-Login: IP-weit großzügiger, pro Konto strenger. */
export function loginRules(ip: string, email: string): { ip: ThrottleRule; email: ThrottleRule } {
  return {
    ip: { scope: 'login:ip', identifier: ip, limit: 20, windowMs: LOGIN_WINDOW_MS },
    email: { scope: 'login:email', identifier: email, limit: 10, windowMs: LOGIN_WINDOW_MS }
  }
}

/** Regeln für "Passwort vergessen" (jede Anfrage zählt): verhindert, dass jemand fremde Postfächer mit Mails flutet. */
export function resetRules(ip: string, email: string): ThrottleRule[] {
  return [
    { scope: 'reset:ip', identifier: ip, limit: 10, windowMs: 60 * MINUTE },
    { scope: 'reset:email', identifier: email, limit: 3, windowMs: 60 * MINUTE }
  ]
}

/** Regel für die Passwort-Abfrage bei "Passwort ändern" (Schutz gegen eine gekaperte Sitzung). */
export function passwordChangeRule(userId: string): ThrottleRule {
  return { scope: 'pwchange:user', identifier: userId, limit: 10, windowMs: LOGIN_WINDOW_MS }
}

/**
 * Regel gegen das massenhafte Erzeugen neuer Cookie-Identitäten (Modus COOKIE): zählt pro
 * IP und Abstimmung nur ERSTE Stimmabgaben, Änderungen der eigenen Auswahl nicht. Bewusst
 * großzügig, weil sich viele Menschen hinter einem NAT (Firmen-/Vereinsnetz, Mobilfunk) eine
 * IP-Adresse teilen - das bremst Skripte, keine Gruppe am selben WLAN.
 */
export function newVoterRule(ip: string, pollId: string): ThrottleRule {
  return { scope: 'vote:new:ip', identifier: `${pollId}\u0000${ip}`, limit: 30, windowMs: 60 * MINUTE }
}

/** Regel gegen das Durchprobieren von Zugangscodes (kurze PINs wären sonst schnell erraten). */
export function accessCodeRule(ip: string, pollId: string): ThrottleRule {
  return { scope: 'poll:code:ip', identifier: `${pollId}\u0000${ip}`, limit: 10, windowMs: LOGIN_WINDOW_MS }
}

/**
 * Regeln für Bestätigungsmails im Modus EMAIL (jede Anfrage zählt): pro IP gegen das Fluten
 * vieler fremder Postfächer, pro Adresse und Abstimmung gegen das Fluten eines einzelnen.
 */
export function voteEmailRules(ip: string, email: string, pollId: string): ThrottleRule[] {
  return [
    { scope: 'vote-mail:ip', identifier: ip, limit: 20, windowMs: 60 * MINUTE },
    { scope: 'vote-mail:email', identifier: `${pollId}\u0000${email}`, limit: 3, windowMs: 60 * MINUTE }
  ]
}

/** Regel für Options-Vorschläge von Teilnehmenden: pro IP und Abstimmung, gegen das Zumüllen der Liste. */
export function suggestionRule(ip: string, pollId: string): ThrottleRule {
  return { scope: 'suggest:ip', identifier: `${pollId}\u0000${ip}`, limit: 10, windowMs: 60 * MINUTE }
}

/**
 * Regeln für den Beitritt zu einer Live-Runde: falsche PINs pro IP (gegen das Durchprobieren der
 * 6-stelligen PINs - ein erfolgreicher Beitritt gibt seinen Versuch zurück) und Beitritte pro IP
 * und Runde (gegen das Fluten der Lobby mit Fantasienamen). Großzügig, weil eine ganze Klasse
 * oder ein Saal oft hinter einer Adresse sitzt.
 */
export function livePinRule(ip: string): ThrottleRule {
  return { scope: 'live:pin:ip', identifier: ip, limit: 30, windowMs: LOGIN_WINDOW_MS }
}

export function liveJoinRule(ip: string, sessionId: string): ThrottleRule {
  return { scope: 'live:join:ip', identifier: `${sessionId}\u0000${ip}`, limit: 200, windowMs: 60 * MINUTE }
}
