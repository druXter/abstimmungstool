// app/lib/create-pin.ts
import { cookies } from 'next/headers'

const COOKIE_NAME = 'create_pin'

/**
 * Schützt ausschließlich das ANLEGEN neuer Abstimmungen vor wildfremden Besuchern,
 * falls dieses Tool über das Internet erreichbar ist (z.B. hinter einem Reverse
 * Proxy) - Abstimmen selbst bleibt für jeden mit einem Link offen, das ist ja der
 * ganze Zweck. Gleiches Cookie-Prinzip wie event_pin_<id>/series_pin_<id> in
 * rsvp-app: das Cookie trägt den PIN-Wert direkt (kein Login, kein Token).
 * Ist CREATE_PIN nicht gesetzt, bleibt das Anlegen bewusst komplett offen -
 * für den lokalen/vertrauten Einsatz ohne Reverse Proxy reicht das.
 */
export async function isCreateAllowed(): Promise<boolean> {
  const pin = process.env.CREATE_PIN
  if (!pin) return true

  const cookieStore = await cookies()
  return cookieStore.get(COOKIE_NAME)?.value === pin
}

export async function unlockCreatePin(pin: string): Promise<boolean> {
  const expected = process.env.CREATE_PIN
  if (!expected || pin !== expected) return false

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, pin, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  return true
}
