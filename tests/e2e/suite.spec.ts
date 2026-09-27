import { expect, test, type Page } from '@playwright/test'
import { BASE_URL, createAccount, login, pageAlert, prisma, unique, uniqueEmail } from './helpers'
import { setIdentity, SUITE_TOOLS, type TestIdentity } from './suite-server'

// Konto-Föderation über suite-kit, Rolle EMPFÄNGER. Die anderen Tools spielt
// tests/e2e/suite-server.ts: Tool A (autoProvision), Tool B (ohne), Tool C (nicht erreichbar).
//
// Schwerpunkt: Wohin Fehler führen. Beim Verknüpfen ist man eingeloggt - eine Meldung auf
// /anmelden ginge verloren, weil die Login-Seite eingeloggte Personen sofort weiterleitet.

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
})

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
