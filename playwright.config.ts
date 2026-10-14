import { defineConfig, devices } from '@playwright/test'
import { SUITE_TOOLS, TEST_SUITE_IDPS } from './tests/e2e/suite-server'
import { MAIL_PORT } from './tests/e2e/mail-server'
import { RSVP_ORIGIN } from './tests/e2e/rsvp-server'
import { createECDH, createHash } from 'node:crypto'

// E2E-Tests gegen eine echte, frisch gebaute Instanz (next build + next start) mit eigener
// Datenbank (prisma/test.db) - nie gegen die Entwicklungs- oder Produktivdatenbank.
//
// 127.0.0.1 statt localhost: Cookies sind nicht an Ports gebunden. Die Test-Doppel der anderen
// Tools (tests/e2e/suite-server.ts) laufen auf localhost und dürfen die Cookies dieses Tools
// nicht sehen; ebenso eine parallel laufende Entwicklungsinstanz (localhost:3600).
const PORT = 3601
export const BASE_URL = `http://127.0.0.1:${PORT}`
// Zweite Instanz mit demselben Build, derselben Datenbank und derselben BASE_URL, aber mit
// SUITE_LOGIN_REDIRECT (bevorzugter Anbieter Tool A): Ihre Login-Seite leitet direkt weiter, der
// Rücksprung landet über BASE_URL bei der ersten Instanz (tests/e2e/login-redirect.spec.ts).
export const REDIRECT_PORT = 3602

// Gilt für den Server UND für die Testprozesse (tests/e2e/helpers.ts greift direkt auf die
// Datenbank zu). Relative SQLite-Pfade löst Prisma relativ zu prisma/schema.prisma auf.
process.env.DATABASE_URL = 'file:./test.db'
process.env.BASE_URL = BASE_URL
// Gemeinsames Secret mit der (von den Tests gespielten) rsvp-app - die Tests signieren damit
// Klick-Tokens und Webhooks selbst (app/lib/rsvp-verification.ts). Nur ein Testwert.
export const TEST_RSVP_SECRET = 'nur-fuer-e2e-tests-kein-echtes-secret'
process.env.RSVP_VERIFICATION_SECRET = TEST_RSVP_SECRET
export const TEST_CRON_SECRET = 'nur-fuer-e2e-tests-cron'
// Websites, die die Tests per page.route selbst ausliefern (ohne Server dahinter): eine darf Fragebögen einbetten,
// eine nicht. localhost ist für den Browser eine andere Website als 127.0.0.1 (wie die Campus-App gegenüber diesem
// Tool); eine ausgedachte öffentliche Domain ginge nicht, Chromium sperrt deren iFrames auf lokale Adressen.
export const EMBED_HOST = 'http://localhost:3698'
export const FOREIGN_HOST = 'http://localhost:3699'
// Dieselbe Website wie dieses Tool (Ports zählen nicht) - wie eine App unter *.ramonroeser.de.
export const SAME_SITE_HOST = 'http://127.0.0.1:3697'
// Feste VAPID-Schlüssel für Push (app/lib/push.ts) - aus einem Namen abgeleitet, damit Server
// und Testprozesse (die diese Datei jeweils selbst laden) dieselben haben. Nur für Tests.
const vapid = createECDH('prime256v1')
vapid.setPrivateKey(createHash('sha256').update('e2e-vapid').digest())
export const TEST_VAPID_PUBLIC_KEY = vapid.getPublicKey().toString('base64url')
const TEST_VAPID_PRIVATE_KEY = vapid.getPrivateKey().toString('base64url')

const SERVER_ENV: Record<string, string> = {
  DATABASE_URL: 'file:./test.db',
  BASE_URL,
  // Ein Proxy: Die Tests spielen ihn selbst und setzen X-Forwarded-For, damit sich die
  // Drossel-Zähler verschiedener Tests nicht in die Quere kommen.
  TRUST_PROXY_HOPS: '1',
  // Konto-Föderation: Test-Doppel anderer Tools aus tests/e2e/suite-server.ts.
  SUITE_IDPS: TEST_SUITE_IDPS,
  SUITE_APP_NAME: 'Abstimmungstool Test',
  RSVP_VERIFICATION_SECRET: TEST_RSVP_SECRET,
  // rsvp-app spielt tests/e2e/rsvp-server.ts (Terminabstimmung, Ergebnis-Meldung).
  RSVP_APP_BASE_URL: RSVP_ORIGIN,
  // Mailversand an den Test-Mailserver (tests/e2e/mail-server.ts): ohne TLS, ohne Anmeldung.
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: String(MAIL_PORT),
  SMTP_USER: '',
  SMTP_PASS: '',
  SMTP_FROM: 'Abstimmungstool Test <test@example.test>',
  // Werte aus einer lokalen .env ausdrücklich leeren (gesetzte Variablen - auch leere - haben
  // Vorrang vor .env): keine Anbieter-Rolle.
  SUITE_SIGNING_KEY: '',
  SUITE_TRUSTED_APPS: '',

  // Push-Mitteilungen gehen an den Test-Push-Dienst (tests/e2e/push-server.ts).
  VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: 'mailto:test@example.test',
  // Cron-Endpunkte (Auto-Schließen) rufen die Tests selbst auf.
  CRON_SECRET: TEST_CRON_SECRET,
  // Eingebettete Fragebögen (tests/e2e/survey.spec.ts): EMBED_HOST darf einbetten, die ungültigen Einträge
  // müssen wegfallen, ohne die CSP zu verändern.
  // Fragebögen: keine Mindest-Ausfüllzeit (die Tests füllen in Millisekunden aus), fester Schlüssel für die Tokens.
  SURVEY_MIN_FILL_MS: '0',
  SURVEY_FORM_SECRET: 'nur-fuer-e2e-tests-fragebogen-token-schluessel',
  EMBED_ALLOWED_ORIGINS: `${EMBED_HOST}, ${SAME_SITE_HOST} https://*.ramonroeser.de javascript:alert(1) https://x.test;script-src *`,
  TZ: 'Europe/Berlin'
}

export default defineConfig({
  testDir: './tests/e2e',
  // Alle Tests teilen sich eine Datenbank und die Drossel-Zähler - nacheinander ausführen.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    ...devices['Desktop Chrome'],
    locale: 'de-DE'
  },
  webServer: [{
    // Datenbank bei jedem Lauf frisch anlegen (nur die eigene Testdatei löschen - bewusst kein
    // `prisma db push --force-reset`, das bei falsch gesetzter DATABASE_URL eine fremde
    // Datenbank leeren würde), dann wie in Produktion bauen und starten.
    command: `rm -f prisma/test.db prisma/test.db-journal && npx prisma db push --skip-generate && npx next build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `${BASE_URL}/impressum`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: SERVER_ENV
  }, {
    // Startet nach der ersten Instanz (Playwright richtet die Server nacheinander ein) und nutzt deren Build.
    command: `npx next start -H 127.0.0.1 -p ${REDIRECT_PORT}`,
    url: `http://127.0.0.1:${REDIRECT_PORT}/impressum`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...SERVER_ENV, SUITE_LOGIN_REDIRECT: SUITE_TOOLS.a.origin }
  }]
})
