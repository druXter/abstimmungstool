import { expect, test, type Page } from '@playwright/test'
import { BASE_URL, createAccount, login, pageAlert, prisma, unique, uniqueEmail } from './helpers'
import { setIdentity, setKeys, SUITE_TOOLS, type TestIdentity } from './suite-server'

// Konto-Föderation über suite-kit, Rolle EMPFÄNGER. Die anderen Tools spielt
// tests/e2e/suite-server.ts: Tool A (autoProvision), Tool B (ohne), Tool C (nicht erreichbar).
//
// Schwerpunkt: Wohin Fehler führen. Beim Verknüpfen ist man eingeloggt - eine Meldung auf
// /anmelden ginge verloren, weil die Login-Seite eingeloggte Personen sofort weiterleitet.
// Ist die Sitzung inzwischen weg, gilt das Umgekehrte: /konto leitet selbst zum Login weiter.

const APP = new URL(BASE_URL).origin

function identity(overrides: Partial<TestIdentity> = {}): TestIdentity {
  return { sub: `konto-${unique()}`, email: uniqueEmail('suite'), name: 'Föderierte Person', ...overrides }
}

/** Wartet, bis der Browser nach dem Umweg über den Anbieter wieder auf einer Seite dieses Tools ist. */
async function backInApp(page: Page) {
  await page.waitForURL(url => url.origin === APP && !url.pathname.startsWith('/api/suite'))
  return new URL(page.url())
}

async function startLink(page: Page, label: string) {
  await page.goto('/konto')
  await page.getByRole('link', { name: `Mit ${label} verknüpfen` }).click()
  return backInApp(page)
}

async function startLogin(page: Page, label: string) {
  await page.goto('/anmelden')
  await page.getByRole('link', { name: `Mit ${label} anmelden` }).click()
  return backInApp(page)
}

test.afterEach(() => {
  setIdentity('a', null)
  setIdentity('b', null)
  setKeys('a', null)
})

// Name des state-Cookies im Produktionsbetrieb (next start), siehe app/lib/suite-flow.ts.
const STATE_COOKIE = '__Host-suite-state'

/**
 * Ruft den Callback mit einem state-Cookie wie von /api/suite/login auf (unsigniertes JSON,
 * URL-kodiert wie von Next geschrieben), aber mit einem ANDEREN state in der URL - das löst
 * fail('sso') aus, ohne dass ein Anbieter beteiligt ist. Direkt als Anfrage, weil Chromium ein
 * __Host-Cookie nicht per addCookies annimmt; die Sitzung des Browsers geht mit. Dem Ziel der
 * Weiterleitung folgt dann der Browser, damit auch weitere Weiterleitungen der Seite greifen.
 */
async function callbackWithWrongState(page: Page, mode: 'login' | 'link') {
  const flow = { state: `richtig-${unique()}`, issuer: SUITE_TOOLS.a.origin, next: mode === 'link' ? '/konto' : '/meine-abstimmungen', mode }
  const cookies = (await page.context().cookies()).map(c => `${c.name}=${c.value}`)
  cookies.push(`${STATE_COOKIE}=${encodeURIComponent(JSON.stringify(flow))}`)
  const response = await page.request.get(`/api/suite/callback?assertion=x&state=falsch-${unique()}`, {
    headers: { cookie: cookies.join('; ') },
    maxRedirects: 0
  })
  expect(response.status()).toBe(303)
  await page.goto(response.headers().location)
  return new URL(page.url())
}

test.describe('Verknüpfen aus "Mein Konto": Fehler landen auf /konto', () => {
  test('Identität hängt schon an einem anderen Konto -> linked-other auf /konto', async ({ page, browser }) => {
    const person = identity()
    setIdentity('b', person)

    // Positivkontrolle: Konto A verknüpft die Identität erfolgreich.
    const first = await createAccount()
    await login(page, first.email)
    const linked = await startLink(page, SUITE_TOOLS.b.label)
    expect(linked.pathname).toBe('/konto')
    expect(linked.searchParams.get('linked')).toBe('1')
    await expect(page.getByText('Konto verknüpft.')).toBeVisible()
    expect(await prisma.externalIdentity.count({ where: { userId: first.id, issuer: SUITE_TOOLS.b.origin, subject: person.sub } })).toBe(1)

    // Konto B versucht dieselbe Identität an sich zu ziehen.
    const second = await createAccount()
    const context = await browser.newContext()
    const page2 = await context.newPage()
    await login(page2, second.email)
    const failed = await startLink(page2, SUITE_TOOLS.b.label)
    expect(failed.pathname).toBe('/konto')
    expect(failed.searchParams.get('error')).toBe('linked-other')
    await expect(pageAlert(page2)).toHaveText('Dieses Konto des anderen Tools ist bereits mit einem anderen Konto hier verknüpft.')
    expect(await prisma.externalIdentity.count({ where: { userId: second.id } })).toBe(0)
    expect(await prisma.externalIdentity.count({ where: { userId: first.id } })).toBe(1)
    await context.close()
  })

  test('ungültige Bestätigung -> sso auf /konto', async ({ page }) => {
    const user = await createAccount()
    setIdentity('b', identity({ tamper: 'signature' }))
    await login(page, user.email)
    const url = await startLink(page, SUITE_TOOLS.b.label)
    expect(url.pathname).toBe('/konto')
    expect(url.searchParams.get('error')).toBe('sso')
    await expect(pageAlert(page)).toHaveText('Die Verknüpfung mit dem anderen Tool ist fehlgeschlagen. Bitte versuche es erneut.')
    expect(await prisma.externalIdentity.count({ where: { userId: user.id } })).toBe(0)
  })

  test('Anbieter nicht erreichbar -> idp-unreachable auf /konto', async ({ page }) => {
    const user = await createAccount()
    await login(page, user.email)
    const url = await startLink(page, SUITE_TOOLS.c.label)
    expect(url.pathname).toBe('/konto')
    expect(url.searchParams.get('error')).toBe('idp-unreachable')
    await expect(pageAlert(page)).toHaveText('Das andere Tool ist gerade nicht erreichbar. Bitte versuche es später erneut.')
  })

  test('unbekannter Fehlercode -> neutrale Meldung, der Code selbst erscheint nicht', async ({ page }) => {
    const user = await createAccount()
    await login(page, user.email)
    await page.goto(`/konto?error=${encodeURIComponent('Bitte-hier-Passwort-eingeben')}`)
    await expect(pageAlert(page)).toHaveText('Das hat nicht geklappt. Bitte versuche es erneut.')
    await expect(page.getByText('Bitte-hier-Passwort-eingeben')).toHaveCount(0)
    // Auch geerbte Eigenschaften des Meldungs-Objekts gelten als unbekannt.
    await page.goto('/konto?error=constructor')
    await expect(pageAlert(page)).toHaveText('Das hat nicht geklappt. Bitte versuche es erneut.')
  })
})

test.describe('Fehlerziel hängt beim Verknüpfen an der Sitzung', () => {
  test('Modus link, eingeloggt -> /konto?error=sso (zugleich Kontrolle, dass das Cookie gelesen wird)', async ({ page }) => {
    const user = await createAccount()
    await login(page, user.email)
    const url = await callbackWithWrongState(page, 'link')
    expect(url.pathname).toBe('/konto')
    expect(url.searchParams.get('error')).toBe('sso')
    await expect(pageAlert(page)).toHaveText('Die Verknüpfung mit dem anderen Tool ist fehlgeschlagen. Bitte versuche es erneut.')
  })

  test('Modus link, ohne Sitzung -> /anmelden?error=sso statt verlorener Meldung', async ({ page }) => {
    const url = await callbackWithWrongState(page, 'link')
    expect(url.pathname).toBe('/anmelden')
    expect(url.searchParams.get('error')).toBe('sso')
    await expect(pageAlert(page)).toContainText('Die Anmeldung über das andere Tool ist fehlgeschlagen.')
  })

  test('Modus login -> /anmelden?error=sso', async ({ page }) => {
    const url = await callbackWithWrongState(page, 'login')
    expect(url.pathname).toBe('/anmelden')
    expect(url.searchParams.get('error')).toBe('sso')
    await expect(pageAlert(page)).toContainText('Die Anmeldung über das andere Tool ist fehlgeschlagen.')
  })
})

test.describe('Login über ein anderes Tool: Fehler bleiben auf /anmelden', () => {
  test('Positivkontrolle: Login mit autoProvision legt ein Konto an', async ({ page }) => {
    const person = identity()
    setIdentity('a', person)
    const url = await startLogin(page, SUITE_TOOLS.a.label)
    expect(url.pathname).toBe('/meine-abstimmungen')
    expect(await prisma.externalIdentity.count({ where: { issuer: SUITE_TOOLS.a.origin, subject: person.sub } })).toBe(1)
  })

  test('ohne autoProvision -> not-linked auf /anmelden', async ({ page }) => {
    const person = identity()
    setIdentity('b', person)
    const url = await startLogin(page, SUITE_TOOLS.b.label)
    expect(url.pathname).toBe('/anmelden')
    expect(url.searchParams.get('error')).toBe('not-linked')
    await expect(pageAlert(page)).toContainText('Dieses Konto ist hier noch nicht bekannt.')
    expect(await prisma.user.count({ where: { email: person.email } })).toBe(0)
  })

  test('ungültige Bestätigung -> sso auf /anmelden', async ({ page }) => {
    setIdentity('a', identity({ tamper: 'signature' }))
    const url = await startLogin(page, SUITE_TOOLS.a.label)
    expect(url.pathname).toBe('/anmelden')
    expect(url.searchParams.get('error')).toBe('sso')
    await expect(pageAlert(page)).toContainText('Die Anmeldung über das andere Tool ist fehlgeschlagen.')
  })

  test('Anbieter nicht erreichbar -> idp-unreachable auf /anmelden', async ({ page }) => {
    const url = await startLogin(page, SUITE_TOOLS.c.label)
    expect(url.pathname).toBe('/anmelden')
    expect(url.searchParams.get('error')).toBe('idp-unreachable')
    await expect(pageAlert(page)).toContainText('Das andere Tool ist gerade nicht erreichbar.')
  })
})

// Schlüsselwechsel beim Anbieter (suite-kit docs/PROTOCOL.md "Schlüsselwechsel"): Der Empfänger hat
// das Discovery-Dokument mit dem alten Schlüssel im Cache, lädt es bei einer unbekannten
// Schlüssel-ID einmal neu und nimmt danach alten (noch veröffentlichten) und neuen Schlüssel an.
test('Schlüsselwechsel beim Anbieter: neuer Schlüssel nach Neuladen, alter während des Wechsels, fremder nie', async ({ page }) => {
  const person = identity()
  setIdentity('a', person)
  const loginAgain = async () => {
    await page.context().clearCookies()
    return startLogin(page, SUITE_TOOLS.a.label)
  }

  // Vorher: nur der alte Schlüssel - der Empfänger hat ihn danach sicher im Cache.
  expect((await loginAgain()).pathname).toBe('/meine-abstimmungen')

  // Wechsel: neuer Schlüssel aktiv, alter als SUITE_SIGNING_KEY_PREVIOUS weiter veröffentlicht.
  setKeys('a', { sign: 'a-neu', publish: ['a-neu', 'a'] })
  expect((await loginAgain()).pathname).toBe('/meine-abstimmungen')

  // Eine noch mit dem alten Schlüssel ausgestellte Bestätigung gilt während des Wechsels weiter.
  setKeys('a', { sign: 'a', publish: ['a-neu', 'a'] })
  expect((await loginAgain()).pathname).toBe('/meine-abstimmungen')

  // Ein Schlüssel, den der Anbieter nie veröffentlicht hat, wird abgelehnt.
  setKeys('a', { sign: 'fremd', publish: ['a-neu', 'a'] })
  const url = await loginAgain()
  expect(url.pathname).toBe('/anmelden')
  expect(url.searchParams.get('error')).toBe('sso')

  expect(await prisma.externalIdentity.count({ where: { issuer: SUITE_TOOLS.a.origin, subject: person.sub } })).toBe(1)
})
