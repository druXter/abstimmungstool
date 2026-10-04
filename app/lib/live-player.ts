import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { cookieOptions, generateToken, hashToken } from './auth'

/**
 * Identität in einer Live-Runde: Cookie live_<sessionId> mit einem zufälligen Token, in der
 * Datenbank nur dessen SHA-256-Hash (LivePlayer.tokenHash) - wie bei Sitzungen. Kein Konto, keine
 * Adresse; wer das Cookie löscht, kann mit einem neuen Spitznamen wieder beitreten (für ein Spiel
 * im Raum ein bewusst akzeptierter Kompromiss, die Leinwand zeigt alle Namen und kann entfernen).
 */

const PLAYER_COOKIE_HOURS = 12

function cookieName(sessionId: string): string {
  return `live_${sessionId}`
}

/** Die teilnehmende Person dieses Browsers in der Runde, sonst null. Setzt nie ein Cookie. */
export async function currentPlayer(sessionId: string) {
  const token = (await cookies()).get(cookieName(sessionId))?.value
  if (!token) return null
  return prisma.livePlayer.findFirst({ where: { tokenHash: hashToken(token), sessionId }, select: { id: true, nickname: true } })
}

/** Nur aus Server Actions: Token erzeugen, Cookie setzen und den Hash zum Speichern zurückgeben. */
export async function issuePlayerToken(sessionId: string): Promise<string> {
  const token = generateToken()
  ;(await cookies()).set(cookieName(sessionId), token, cookieOptions(PLAYER_COOKIE_HOURS * 60 * 60))
  return hashToken(token)
}
