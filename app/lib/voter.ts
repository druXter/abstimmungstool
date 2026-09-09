// app/lib/voter.ts
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'

const COOKIE_NAME = 'voter_token'

/**
 * Liefert eine zufällige, anonyme Kennung für "dieses Browser-Gerät" - erzeugt beim
 * ersten Aufruf und danach dauerhaft im Cookie gespeichert. Das ist die einzige
 * "Identität", die eine Stimme hat (siehe Vote.voterToken in schema.prisma) - kein
 * Konto, keine E-Mail. Bewusste, dokumentierte Grenze: Wer Cookies löscht oder ein
 * anderes Gerät nutzt, bekommt einen neuen Token und kann erneut abstimmen.
 */
export async function getOrCreateVoterToken(): Promise<string> {
  const cookieStore = await cookies()
  const existing = cookieStore.get(COOKIE_NAME)?.value
  if (existing) return existing

  const token = randomUUID()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  })
  return token
}

/**
 * Liest den voterToken nur, ohne einen neuen anzulegen - für Stellen, die lediglich
 * prüfen wollen, ob (und wie) diese:r Besucher:in bereits abgestimmt hat, ohne
 * versehentlich ein Cookie in einer reinen Lese-Anfrage zu setzen (Server Components
 * dürfen z.B. beim Rendern keine Cookies schreiben).
 */
export async function getVoterToken(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(COOKIE_NAME)?.value ?? null
}
