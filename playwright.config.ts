import { defineConfig, devices } from '@playwright/test'
import { TEST_SUITE_IDPS } from './tests/e2e/suite-server'
import { MAIL_PORT } from './tests/e2e/mail-server'

// E2E-Tests gegen eine echte, frisch gebaute Instanz (next build + next start) mit eigener
// Datenbank (prisma/test.db) - nie gegen die Entwicklungs- oder Produktivdatenbank.
//
// 127.0.0.1 statt localhost: Cookies sind nicht an Ports gebunden. Die Test-Doppel der anderen
// Tools (tests/e2e/suite-server.ts) laufen auf localhost und dürfen die Cookies dieses Tools
// nicht sehen; ebenso eine parallel laufende Entwicklungsinstanz (localhost:3600).
const PORT = 3601
export const BASE_URL = `http://127.0.0.1:${PORT}`

// Gilt für den Server UND für die Testprozesse (tests/e2e/helpers.ts greift direkt auf die
// Datenbank zu). Relative SQLite-Pfade löst Prisma relativ zu prisma/schema.prisma auf.
process.env.DATABASE_URL = 'file:./test.db'
process.env.BASE_URL = BASE_URL
// Gemeinsames Secret mit der (von den Tests gespielten) rsvp-app - die Tests signieren damit
// Klick-Tokens und Webhooks selbst (app/lib/rsvp-verification.ts). Nur ein Testwert.
export const TEST_RSVP_SECRET = 'nur-fuer-e2e-tests-kein-echtes-secret'
process.env.RSVP_VERIFICATION_SECRET = TEST_RSVP_SECRET

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
  webServer: {
    // Datenbank bei jedem Lauf frisch anlegen (nur die eigene Testdatei löschen - bewusst kein
    // `prisma db push --force-reset`, das bei falsch gesetzter DATABASE_URL eine fremde
    // Datenbank leeren würde), dann wie in Produktion bauen und starten.
    command: `rm -f prisma/test.db prisma/test.db-journal && npx prisma db push --skip-generate && npx next build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `${BASE_URL}/impressum`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      DATABASE_URL: 'file:./test.db',
      BASE_URL,
      // Ein Proxy: Die Tests spielen ihn selbst und setzen X-Forwarded-For, damit sich die
      // Drossel-Zähler verschiedener Tests nicht in die Quere kommen.
      TRUST_PROXY_HOPS: '1',
      // Konto-Föderation: Test-Doppel anderer Tools aus tests/e2e/suite-server.ts.
      SUITE_IDPS: TEST_SUITE_IDPS,
      SUITE_APP_NAME: 'Abstimmungstool Test',
      RSVP_VERIFICATION_SECRET: TEST_RSVP_SECRET,
      // Mailversand an den Test-Mailserver (tests/e2e/mail-server.ts): ohne TLS, ohne Anmeldung.
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(MAIL_PORT),
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_FROM: 'Abstimmungstool Test <test@example.test>',
      // Werte aus einer lokalen .env ausdrücklich leeren (gesetzte Variablen - auch leere - haben
      // Vorrang vor .env): keine Anbieter-Rolle, keine echte rsvp-app.
      SUITE_SIGNING_KEY: '',
      SUITE_TRUSTED_APPS: '',
      RSVP_APP_BASE_URL: '',
      CRON_SECRET: '',
      TZ: 'Europe/Berlin'
    }
  }
})
