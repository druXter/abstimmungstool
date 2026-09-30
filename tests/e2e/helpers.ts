import { PrismaClient, type Prisma, type Role } from '@prisma/client'
import type { Page } from '@playwright/test'
import { hashPassword } from '../../app/lib/password'
import { BASE_URL } from '../../playwright.config'

export { BASE_URL }

export const prisma = new PrismaClient()

export const PASSWORD = 'ein sicheres Testpasswort'

let counter = 0
/** Eindeutige Kennung pro Aufruf, damit sich Tests nicht über Konten oder Drossel-Zähler beeinflussen. */
export function unique(): string {
  return `${Date.now().toString(36)}${(counter++).toString(36)}`
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${unique()}@example.test`
}

// Zufälliger Startwert pro Prozess: Nach einem fehlgeschlagenen Test startet Playwright einen
// neuen Worker - ein bei 0 beginnender Zähler würde dann IPs wiederverwenden.
let ipCounter = Math.floor(Math.random() * 60_000)
/** Eindeutige Besucher-IP (Benchmark-Netz 198.18.0.0/15, RFC 2544 - nie echte Besucher). */
export function uniqueIp(): string {
  ipCounter++
  return `198.${18 + (Math.floor(ipCounter / 62_500) % 2)}.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`
}

export async function createAccount(role: Role = 'CREATOR') {
  return prisma.user.create({
    data: { email: uniqueEmail(role.toLowerCase()), role, passwordHash: await hashPassword(PASSWORD) }
  })
}

/** Legt eine Abstimmung direkt in der Datenbank an (Standard: zwei Optionen "Pizza" und "Sushi"). */
export async function createPoll(ownerId: string, data: Partial<Prisma.PollUncheckedCreateInput> = {}, labels = ['Pizza', 'Sushi']) {
  return prisma.poll.create({
    data: {
      title: `Abstimmung ${unique()}`,
      ownerId,
      ...data,
      options: { create: labels.map((label, position) => ({ label, position })) }
    },
    include: { options: { orderBy: { position: 'asc' } } }
  })
}

/** Meldet über das Formular an. Setzt vorher eine eigene Besucher-IP, damit Drossel-Zähler anderer Tests nicht stören. */
export async function login(page: Page, email: string, password = PASSWORD, ip = uniqueIp()) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip })
  await page.goto('/anmelden')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click()
  // Auf das Ergebnis warten (Weiterleitung oder Fehlermeldung) - ein sofort folgendes
  // page.goto würde die laufende Server Action sonst abbrechen.
  await page.waitForURL(url => url.pathname !== '/anmelden' || url.searchParams.has('error'))
}

/** Hinweisbox der Seite (ohne den unsichtbaren Route-Announcer von Next.js, der ebenfalls role="alert" hat). */
export function pageAlert(page: Page) {
  return page.getByRole('main').getByRole('alert')
}
