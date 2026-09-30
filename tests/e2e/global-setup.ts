import { prisma } from './helpers'
import { startSuiteServers } from './suite-server'
import { startMailServer } from './mail-server'
import { rmSync } from 'node:fs'
import { BASE_URL } from '../../playwright.config'

/**
 * Läuft nach dem Start des Servers (dessen Befehl hat die Datenbank bereits frisch angelegt).
 * Startet die Test-Doppel anderer Tools der Suite (tests/e2e/suite-server.ts) und einen
 * Mailserver (tests/e2e/mail-server.ts); die
 * zurückgegebene Funktion beendet sie am Ende.
 */
export default async function globalSetup() {
  const suiteServers = await startSuiteServers(new URL(BASE_URL).origin)
  rmSync('.e2e/mails.jsonl', { force: true })
  const mailServer = await startMailServer()
  await prisma.user.deleteMany()
  await prisma.loginThrottle.deleteMany()
  await prisma.$disconnect()
  return async () => {
    for (const server of [...suiteServers, mailServer]) await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
