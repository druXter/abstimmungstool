import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { createAccount, createPoll, pageAlert, prisma, uniqueIp } from './helpers'

// Hürden ohne starke Identität (TODO.md A4/A5): Pflichtname, Höchstzahl, Drosselung neuer
// Cookie-Identitäten und Zugangscode.

/** Schlüssel eines Drossel-Zählers wie keyOf in app/lib/throttle.ts. */
function throttleKey(scope: string, identifier: string): string {
  return createHash('sha256').update(`${scope}\u0000${identifier}`).digest('hex')
}

async function vote(page: Page, option: string, button = 'Abstimmen') {
  await page.getByRole('radio', { name: option }).check()
  await page.getByRole('button', { name: button }).click()
}

test('Pflichtname: wird verlangt, angezeigt und beim Ändern vorausgefüllt', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { requireVoterName: true, showVoterNames: true })
  await page.goto(`/${poll.id}`)
  await expect(page.getByText('namentlich bei der gewählten Option angezeigt')).toBeVisible()
  await expect(page.getByLabel('Dein Name')).toHaveAttribute('required', '')

  await page.getByLabel('Dein Name').fill('Anna')
  await vote(page, 'Pizza')
  await expect(page.getByText('Pizza ✓')).toBeVisible()
  await expect(page.getByText('Anna', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Dein Name')).toHaveValue('Anna')

  const stored = await prisma.vote.findFirstOrThrow({ where: { pollId: poll.id } })
  expect(stored).toMatchObject({ identityKind: 'COOKIE', voterName: 'Anna' })
})

test('Höchstzahl: neue Personen werden abgewiesen, wer drin ist, darf ändern', async ({ browser }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { maxVoters: 1 })

  const first = await (await browser.newContext()).newPage()
  const second = await (await browser.newContext()).newPage()
  await first.goto(`/${poll.id}`)
  await expect(first.getByText('Noch 1 von 1 Plätzen frei.')).toBeVisible()
  // Die zweite Person hat das Formular schon offen, bevor der letzte Platz weg ist.
  await second.goto(`/${poll.id}`)

  await vote(first, 'Pizza')
  await expect(first.getByText('Pizza ✓')).toBeVisible()

  await vote(second, 'Sushi')
  await second.waitForURL(/hinweis=voll/)
  await expect(second.getByText('deine Stimme wurde nicht gezählt')).toBeVisible()
  await expect(second.getByText('Die Höchstzahl von 1 Teilnehmenden ist erreicht')).toBeVisible()
  await expect(second.getByRole('button', { name: 'Abstimmen' })).toHaveCount(0)

  await vote(first, 'Sushi', 'Auswahl speichern')
  await expect(first.getByText('Sushi ✓')).toBeVisible()
  expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(1)

  await first.context().close()
  await second.context().close()
})

test('Drosselung: zu viele neue Identitäten von einer IP werden abgewiesen, Ändern nicht', async ({ browser }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id)
  const ip = uniqueIp()

  const early = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip } })).newPage()
  await early.goto(`/${poll.id}`)
  await vote(early, 'Pizza')
  await expect(early.getByText('Pizza ✓')).toBeVisible()

  // Zähler auf das Limit (30 neue Identitäten pro Stunde) setzen, statt 30 Browser zu starten.
  await prisma.loginThrottle.update({
    where: { key: throttleKey('vote:new:ip', `${poll.id}\u0000${ip}`) },
    data: { count: 30 }
  })

  const late = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip } })).newPage()
  await late.goto(`/${poll.id}`)
  await vote(late, 'Sushi')
  await late.waitForURL(/hinweis=gedrosselt/)
  await expect(late.getByText('sehr viele neue Personen abgestimmt')).toBeVisible()
  expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(1)

  // Wer schon abgestimmt hat, ist keine neue Identität.
  await vote(early, 'Sushi', 'Auswahl speichern')
  await expect(early.getByText('Sushi ✓')).toBeVisible()

  // Eine andere IP ist davon unberührt.
  const elsewhere = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })).newPage()
  await elsewhere.goto(`/${poll.id}`)
  await vote(elsewhere, 'Pizza')
  await expect(elsewhere.getByText('Pizza ✓')).toBeVisible()

  for (const page of [early, late, elsewhere]) await page.context().close()
})

test.describe('Zugangscode', () => {
  test('ohne Code nichts zu sehen, falscher Code abgewiesen, richtiger schaltet frei', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
    const owner = await createAccount()
    const poll = await createPoll(owner.id, { accessCode: 'Sommerfest' })

    await page.goto(`/${poll.id}`)
    await expect(page.getByRole('heading', { name: 'Zugangscode erforderlich' })).toBeVisible()
    await expect(page.getByText(poll.title)).toHaveCount(0)
    await expect(page.getByText('Pizza')).toHaveCount(0)

    await page.getByLabel('Zugangscode').fill('Winterfest')
    await page.getByRole('button', { name: 'Weiter' }).click()
    await page.waitForURL(/hinweis=code-falsch/)
    await expect(pageAlert(page)).toHaveText('Der Zugangscode stimmt nicht.')

    await page.getByLabel('Zugangscode').fill('  sommerFEST ')
    await page.getByRole('button', { name: 'Weiter' }).click()
    await expect(page.getByRole('heading', { name: poll.title })).toBeVisible()
    await vote(page, 'Pizza')
    await expect(page.getByText('Pizza ✓')).toBeVisible()

    // Neuer Code: das alte Cookie gilt nicht mehr.
    await prisma.poll.update({ where: { id: poll.id }, data: { accessCode: 'Herbstfest' } })
    await page.goto(`/${poll.id}`)
    await expect(page.getByRole('heading', { name: 'Zugangscode erforderlich' })).toBeVisible()
  })

  test('castVote prüft den Code selbst - ein Formular ohne Freischaltung zählt nicht', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
    const owner = await createAccount()
    const poll = await createPoll(owner.id, { accessCode: 'Sommerfest' })
    await page.goto(`/${poll.id}?code=Sommerfest`)
    await page.getByRole('button', { name: 'Weiter' }).click()
    await expect(page.getByRole('heading', { name: poll.title })).toBeVisible()

    // Freischaltung verlieren, während das Formular offen ist.
    await page.context().clearCookies({ name: `poll_access_${poll.id}` })
    const actionDone = page.waitForResponse(response => response.request().method() === 'POST')
    await vote(page, 'Pizza')
    await actionDone
    expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0)
  })

  test('Link mit ?code= füllt das Feld nur vor', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
    const owner = await createAccount()
    const poll = await createPoll(owner.id, { accessCode: 'Sommerfest' })
    await page.goto(`/${poll.id}?code=Sommerfest`)
    await expect(page.getByLabel('Zugangscode')).toHaveValue('Sommerfest')
    await page.getByRole('button', { name: 'Weiter' }).click()
    await expect(page.getByRole('heading', { name: poll.title })).toBeVisible()
  })

  test('Durchprobieren wird gedrosselt - auch der richtige Code hilft dann nicht', async ({ page }) => {
    const ip = uniqueIp()
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip })
    const owner = await createAccount()
    const poll = await createPoll(owner.id, { accessCode: 'Sommerfest' })
    await prisma.loginThrottle.create({
      data: { key: throttleKey('poll:code:ip', `${poll.id}\u0000${ip}`), count: 10, windowStart: new Date() }
    })

    await page.goto(`/${poll.id}`)
    await page.getByLabel('Zugangscode').fill('Sommerfest')
    await page.getByRole('button', { name: 'Weiter' }).click()
    await page.waitForURL(/hinweis=code-gesperrt/)
    await expect(pageAlert(page)).toContainText('Zu viele Versuche.')
    await expect(page.getByRole('heading', { name: 'Zugangscode erforderlich' })).toBeVisible()
  })
})
