import { expect, test, type Page } from '@playwright/test'
import { createAccount, createPoll, login, prisma, uniqueEmail, uniqueIp } from './helpers'
import { linkIn, mailsTo, waitForMail } from './mail-server'
import { BASE_URL } from '../../playwright.config'

// Modus EMAIL (TODO.md A2, app/lib/email-voters.ts). Mails fängt der Test-Mailserver ab
// (tests/e2e/mail-server.ts).

async function requestLink(page: Page, pollId: string, email: string) {
  await page.goto(`/${pollId}`)
  await page.getByLabel('E-Mail-Adresse').fill(email)
  await page.getByRole('button', { name: 'Bestätigungslink schicken' }).click()
  await page.waitForURL(/hinweis=/)
}

async function confirmFromMail(page: Page, email: string) {
  const link = linkIn(await waitForMail(email), `${BASE_URL}/`)
  expect(link).toContain('/bestaetigen?t=')
  await page.goto(link)
  await page.getByRole('button', { name: 'Bestätigen und zur Abstimmung' }).click()
  await page.waitForURL(/hinweis=mail-bestaetigt/)
  return link
}

test('Adresse bestätigen, abstimmen - ein anderes Gerät mit derselben Adresse ist dieselbe Person', async ({ browser }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'EMAIL' })
  const email = uniqueEmail('mail')
  const page = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })).newPage()

  await page.goto(`/${poll.id}`)
  await expect(page.getByRole('button', { name: 'Abstimmen' })).toHaveCount(0)
  await requestLink(page, poll.id, email.toUpperCase())
  await expect(page.getByText('Wir haben dir einen Bestätigungslink geschickt.')).toBeVisible()

  // Ein Mail-Scanner, der den Link nur aufruft, verbraucht ihn nicht.
  const link = linkIn(await waitForMail(email), `${BASE_URL}/`)
  const scanner = await (await browser.newContext()).newPage()
  await scanner.goto(link)
  await expect(scanner.getByText(`Mit ${email} abstimmen?`)).toBeVisible()
  await scanner.context().close()

  await confirmFromMail(page, email)
  await expect(page.getByText(`Du stimmst mit deiner bestätigten Adresse ab: ${email}`)).toBeVisible()
  await page.getByRole('radio', { name: 'Pizza' }).check()
  await page.getByRole('button', { name: 'Abstimmen' }).click()
  await expect(page.getByText('Pizza ✓')).toBeVisible()
  const stored = await prisma.vote.findFirstOrThrow({ where: { pollId: poll.id } })
  expect(stored).toMatchObject({ identityKind: 'EMAIL', voterKey: `email:${email}`, voterName: email })

  // Der Link ist jetzt verbraucht.
  await page.goto(link)
  await expect(page.getByText('Dieser Link ist ungültig, abgelaufen oder wurde schon benutzt.')).toBeVisible()

  // Zweites Gerät, gleiche Adresse: sieht die eigene Stimme und ändert sie.
  const other = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })).newPage()
  await requestLink(other, poll.id, email)
  await confirmFromMail(other, email)
  await expect(other.getByText('Pizza ✓')).toBeVisible()
  await other.getByRole('radio', { name: 'Sushi' }).check()
  await other.getByRole('button', { name: 'Auswahl speichern' }).click()
  await expect(other.getByText('Sushi ✓')).toBeVisible()
  await expect(other.getByText('Live-Ergebnis (1 Person)')).toBeVisible()

  // "Andere Adresse verwenden" vergisst die Bestätigung in diesem Browser.
  await other.getByRole('button', { name: 'andere Adresse verwenden' }).click()
  await expect(other.getByLabel('E-Mail-Adresse')).toBeVisible()

  await page.context().close()
  await other.context().close()
})

test('Adressliste: fremde Adressen abgewiesen, nachträglich entfernte gesperrt', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  const owner = await createAccount()
  const allowed = uniqueEmail('erlaubt').replace(/@.*/, '@verein.test')
  const poll = await createPoll(owner.id, { voterIdentity: 'EMAIL', allowedEmails: '@verein.test' })

  const stranger = uniqueEmail('fremd')
  await requestLink(page, poll.id, stranger)
  await expect(page.getByText('Mit dieser Adresse kann bei dieser Abstimmung nicht abgestimmt werden.')).toBeVisible()
  expect(mailsTo(stranger)).toHaveLength(0)

  await requestLink(page, poll.id, allowed)
  await confirmFromMail(page, allowed)
  await expect(page.getByRole('button', { name: 'Abstimmen' })).toBeVisible()

  await prisma.poll.update({ where: { id: poll.id }, data: { allowedEmails: 'jemand@anders.test' } })
  await page.goto(`/${poll.id}`)
  await expect(page.getByText('ist für diese Abstimmung (inzwischen) nicht zugelassen')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abstimmen' })).toHaveCount(0)
})

test('Mailschleuder-Schutz: höchstens 3 Links pro Adresse und Stunde', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'EMAIL' })
  const email = uniqueEmail('flut')
  for (let i = 0; i < 3; i++) {
    await requestLink(page, poll.id, email)
    await expect(page.getByText('Wir haben dir einen Bestätigungslink geschickt.')).toBeVisible()
  }
  await requestLink(page, poll.id, email)
  await expect(page.getByText('wurden gerade schon mehrere Links angefordert')).toBeVisible()
  await waitForMail(email)
  expect(mailsTo(email)).toHaveLength(3)
})

test('Stimmlinks (Modus LINK) gehen an die eingetragenen Adressen', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'LINK' })
  await login(page, owner.email)
  const email = uniqueEmail('ben')
  await page.goto(`/${poll.id}/verwalten`)
  await page.getByLabel('Namensliste (eine Person pro Zeile)').fill(`Ben <${email}>\nCem`)
  await expect(page.getByLabel('Links an eingetragene E-Mail-Adressen direkt verschicken')).toBeChecked()
  await page.getByRole('button', { name: 'Links ausstellen' }).click()
  const shown = await page.getByLabel('Ben (per Mail verschickt)').inputValue()
  expect(linkIn(await waitForMail(email), `${BASE_URL}/`)).toBe(shown)
  await expect(page.getByLabel('Cem', { exact: true })).toBeVisible()
})
