import { expect, test, type Page } from '@playwright/test'
import { createAccount, createPoll, login, prisma } from './helpers'

// Abstimmungsarten (Poll.pollType, TODO.md B): Eingabe app/lib/poll-types.ts,
// Auswertung app/lib/results.ts.

/** CSV-Export mit der Sitzung des Browsers (page.request schickt das Secure-Cookie über http nicht mit). */
async function exportCsv(page: Page, pollId: string): Promise<string> {
  await page.goto(`/${pollId}/verwalten`)
  return page.evaluate(async url => (await fetch(url)).text(), `/${pollId}/verwalten/export`)
}

async function newVoter(page: Page) {
  return (await page.context().browser()!.newContext()).newPage()
}

test('Ja/Vielleicht/Nein: Antworten je Option, Wertung 2 x Ja + Vielleicht', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { pollType: 'YES_MAYBE_NO', voterIdentity: 'COOKIE', requireVoterName: true, showVoterNames: true })

  const anna = await newVoter(page)
  await anna.goto(`/${poll.id}`)
  await anna.getByLabel('Dein Name').fill('Anna')
  await anna.getByRole('group', { name: 'Pizza' }).getByRole('radio', { name: 'Ja' }).check()
  await anna.getByRole('group', { name: 'Sushi' }).getByRole('radio', { name: 'Vielleicht' }).check()
  await anna.getByRole('button', { name: 'Abstimmen' }).click()
  await expect(anna.getByText('Pizza (du: ja)')).toBeVisible()
  await expect(anna.getByText('Anna (vielleicht)')).toBeVisible()

  const ben = await newVoter(page)
  await ben.goto(`/${poll.id}`)
  await ben.getByLabel('Dein Name').fill('Ben')
  await ben.getByRole('group', { name: 'Pizza' }).getByRole('radio', { name: 'Nein' }).check()
  await ben.getByRole('group', { name: 'Sushi' }).getByRole('radio', { name: 'Ja' }).check()
  await ben.getByRole('button', { name: 'Abstimmen' }).click()
  await expect(ben.getByText('1 ja · 1 vielleicht · 0 nein')).toBeVisible()
  await expect(ben.getByText('1 ja · 0 vielleicht · 1 nein')).toBeVisible()

  const values = await prisma.vote.findMany({ where: { pollId: poll.id }, select: { voterName: true, value: true, option: { select: { label: true } } } })
  expect(values.map(v => `${v.voterName}:${v.option.label}:${v.value}`).sort()).toEqual(['Anna:Pizza:2', 'Anna:Sushi:1', 'Ben:Pizza:0', 'Ben:Sushi:2'])

  // Sushi: 2 x 1 Ja + 1 Vielleicht = 3 > Pizza: 2 x 1 Ja = 2
  await login(page, owner.email)
  const csv = await exportCsv(page, poll.id)
  expect(csv).toContain('"Ergebnis";"Ergebnis: ""Sushi""."')
  expect(csv).toContain('"Sushi";"1";"1";"0";"3"')
  await anna.context().close()
  await ben.context().close()
})

test('Rangfolge: Borda, Lücken werden geschlossen, doppelte Plätze abgelehnt', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { pollType: 'RANKING' }, ['A', 'B', 'C'])

  const first = await newVoter(page)
  await first.goto(`/${poll.id}`)
  await first.getByLabel('A', { exact: true }).selectOption('1')
  await first.getByLabel('B', { exact: true }).selectOption('1')
  await first.getByRole('button', { name: 'Abstimmen' }).click()
  await first.waitForURL(/hinweis=rangfolge/)
  await expect(first.getByText('Jeder Platz darf nur einmal vergeben werden')).toBeVisible()
  expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0)

  // B vor A, C nicht eingeordnet -> B 2, A 1, C 0 Punkte (n = 3)
  await first.getByLabel('B', { exact: true }).selectOption('1')
  await first.getByLabel('A', { exact: true }).selectOption('2')
  await first.getByRole('button', { name: 'Abstimmen' }).click()
  await expect(first.getByText('B (du: Platz 1)')).toBeVisible()

  // A auf 1, C auf 3 -> Lücke geschlossen: C gilt als Platz 2 -> A +2, C +1
  const second = await newVoter(page)
  await second.goto(`/${poll.id}`)
  await second.getByLabel('A', { exact: true }).selectOption('1')
  await second.getByLabel('C', { exact: true }).selectOption('3')
  await second.getByRole('button', { name: 'Abstimmen' }).click()
  await expect(second.getByText('C (du: Platz 2)')).toBeVisible()

  await login(page, owner.email)
  const csv = await exportCsv(page, poll.id)
  expect(csv).toContain('"A";"3";"2"')
  expect(csv).toContain('"B";"2";"1"')
  expect(csv).toContain('"C";"1";"1"')
  expect(csv).toContain('"Ergebnis";"Ergebnis: ""A""."')
  await first.context().close()
  await second.context().close()
})

test('Punkte verteilen: Budget wird serverseitig geprüft', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { pollType: 'POINTS', pointsBudget: 10 })
  await page.goto(`/${poll.id}`)
  await expect(page.getByText('Verteile bis zu 10 Punkte auf die Optionen.')).toBeVisible()

  await page.getByLabel('Pizza').fill('8')
  await page.getByLabel('Sushi').fill('5')
  await page.getByRole('button', { name: 'Abstimmen' }).click()
  await page.waitForURL(/hinweis=punkte/)
  await expect(page.getByText('Du hast mehr Punkte verteilt als erlaubt')).toBeVisible()
  expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0)

  await page.getByLabel('Pizza').fill('7')
  await page.getByLabel('Sushi').fill('3')
  await page.getByRole('button', { name: 'Abstimmen' }).click()
  await expect(page.getByText('Pizza (du: 7 Punkte)')).toBeVisible()
  await expect(page.getByText('7 Punkte', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Pizza')).toHaveValue('7')
})

test('Art und Punktebudget sind gesperrt, sobald abgestimmt wurde', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { pollType: 'POINTS', pointsBudget: 5 })
  await prisma.vote.create({ data: { pollId: poll.id, optionId: poll.options[0].id, identityKind: 'COOKIE', voterKey: 'cookie:typ', value: 5 } })
  await login(page, owner.email)
  await page.goto(`/${poll.id}/verwalten/bearbeiten`)
  await expect(page.getByText('die Art lässt sich nicht mehr ändern')).toBeVisible()
  await expect(page.getByRole('radio', { name: /^Auswahl/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await page.waitForURL(/saved=1/)
  expect(await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).toMatchObject({ pollType: 'POINTS', pointsBudget: 5 })
})

test('Anlegen über das Formular: Punkte verteilen mit eigenem Budget', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/erstellen')
  await page.getByLabel('Frage / Titel').fill('Budget')
  await page.locator('input[name="option"]').nth(0).fill('X')
  await page.locator('input[name="option"]').nth(1).fill('Y')
  await page.getByRole('radio', { name: /^Punkte verteilen/ }).check()
  await page.getByLabel('Punkte pro Person (nur bei "Punkte verteilen")').fill('20')
  await page.getByRole('button', { name: 'Abstimmung erstellen' }).click()
  await page.waitForURL(/created=1/)
  const pollId = new URL(page.url()).pathname.split('/')[1]
  expect(await prisma.poll.findUniqueOrThrow({ where: { id: pollId } })).toMatchObject({ pollType: 'POINTS', pointsBudget: 20 })
})
