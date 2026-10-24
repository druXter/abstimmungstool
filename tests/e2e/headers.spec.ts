import { expect, test, type APIRequestContext } from '@playwright/test'

// Prüft die Header-Regeln aus next.config.ts (Bausteine aus suite-kit/web, suite-kit docs/KONVENTIONEN.md): nichts
// einbettbar außer dem eingebetteten Fragebogen, Login/Konto/Verwaltung privat, Einmal-Links ohne Referer.

const PRIVATE = [
  '/anmelden', '/anmelden/weiter', '/konto', '/nutzer', '/meine-abstimmungen', '/erstellen', '/passwort-vergessen',
  '/irgendeine-abstimmung/verwalten', '/live/x/verwalten', '/live/x/bearbeiten', '/live/x/praesentieren',
  '/sitzung/x/verwalten', '/fragebogen/x/verwalten', '/fragebogen/x/bearbeiten'
]
const SECRET_URL = ['/passwort-zuruecksetzen?token=abc', '/irgendeine-abstimmung/bestaetigen?t=abc', '/sitzung/x/tafel?k=abc']
const PUBLIC = ['/', '/irgendeine-abstimmung', '/fragebogen/x', '/sitzung/x', '/impressum', '/datenschutz']
const SUITE = ['/api/suite/authorize', '/api/suite/login', '/api/suite/callback']

async function headersOf(request: APIRequestContext, path: string) {
  return (await request.get(path, { maxRedirects: 0 })).headers()
}

test('allgemeine Header überall, Einbetten überall verboten außer im eingebetteten Fragebogen', async ({ request }) => {
  for (const path of [...PRIVATE, ...SECRET_URL, ...PUBLIC, ...SUITE]) {
    const h = await headersOf(request, path)
    expect(h['x-content-type-options'], path).toBe('nosniff')
    expect(h['strict-transport-security'], path).toBe('max-age=31536000')
    expect(h['x-frame-options'], path).toBe('DENY')
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'")
  }
  // Positivkontrolle: der eingebettete Fragebogen bekommt kein DENY, sondern die erlaubten Seiten (proxy.ts).
  const embed = await headersOf(request, '/fragebogen/x/einbetten')
  expect(embed['x-frame-options']).toBeUndefined()
  expect(embed['content-security-policy']).toMatch(/^frame-ancestors 'self'/)
})

test('Login, Konto und Verwaltung: nicht indexieren, nicht cachen; öffentliche Seiten schon', async ({ request }) => {
  for (const path of [...PRIVATE, ...SECRET_URL]) {
    const h = await headersOf(request, path)
    expect(h['x-robots-tag'], path).toBe('noindex, nofollow')
    expect(h['cache-control'], path).toContain('no-store')
  }
  for (const path of ['/', '/impressum']) {
    expect((await headersOf(request, path))['x-robots-tag'], path).toBeUndefined()
  }
})

test('Referrer-Policy: allgemein strict-origin-when-cross-origin, Einmal-Links und Föderation no-referrer', async ({ request }) => {
  for (const path of ['/', '/anmelden', '/irgendeine-abstimmung/verwalten']) {
    expect((await headersOf(request, path))['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
  }
  for (const path of [...SECRET_URL, ...SUITE]) {
    expect((await headersOf(request, path))['referrer-policy'], path).toBe('no-referrer')
  }
})

test('Service Worker: nie gecacht, eigene CSP', async ({ request }) => {
  const h = await headersOf(request, '/sw.js')
  expect(h['cache-control']).toBe('no-cache, no-store, must-revalidate')
  expect(h['content-security-policy']).toBe("default-src 'self'; script-src 'self'; frame-ancestors 'none'")
})
