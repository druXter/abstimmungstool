import { prisma } from './helpers'
import { startSuiteServers } from './suite-server'
import { BASE_URL } from '../../playwright.config'

/**
 * Läuft nach dem Start des Servers (dessen Befehl hat die Datenbank bereits frisch angelegt).
 * Startet die Test-Doppel anderer Tools der Suite (tests/e2e/suite-server.ts); die
 * zurückgegebene Funktion beendet sie am Ende.
 */
export default async function globalSetup() {
  const suiteServers = await startSuiteServers(new URL(BASE_URL).origin)
  await prisma.user.deleteMany()
  await prisma.loginThrottle.deleteMany()
  await prisma.$disconnect()
  return async () => {
    for (const server of suiteServers) await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
