import { expect, test, type Page } from '@playwright/test'
import { createAccount, createPoll, login, prisma } from './helpers'
import { hashToken } from '../../app/lib/auth'

// Persönliche Stimmlinks (Modus LINK, TODO.md A1, app/lib/voter-links.ts).

/** Stellt über die Verwaltungsseite Links für eine Namensliste aus und liefert sie (Name -> URL). */
async function issueLinks(page: Page, pollId: string, names: string[]): Promise<Map<string, string>> {
  await page.goto(`/${pollId}/verwalten`)
  await page.getByLabel('Namensliste (eine Person pro Zeile)').fill(names.join('\n'))
  await page.getByRole('button', { name: 'Links ausstellen' }).click()
  await expect(page.getByText('Diese Links werden nur jetzt angezeigt')).toBeVisible()
  const result = new Map<string, string>()
  for (const name of names) {
    const label = name.replace(/\s*<.*>$/, '') // "Ben <ben@…>" heißt in der Liste "Ben"
    result.set(label, await page.getByLabel(label, { exact: true }).inputValue())
  }
  return result
}

async function vote(page: Page, url: string, option: string) {
  await page.goto(url)
  await page.getByRole('radio', { name: option }).check()
  await page.getByRole('button', { name: /Abstimmen|Auswahl speichern/ }).click()
  await expect(page.getByText(`${option} ✓`)).toBeVisible()
}

test('ausstellen, abstimmen, Beteiligung - Links liegen nur als Hash in der Datenbank', async ({ page, browser }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'LINK' })
  await login(page, owner.email)
  const links = await issueLinks(page, poll.id, ['Anna', 'Ben <ben@example.test>', 'Cem'])
  expect([...links.keys()]).toEqual(['Anna', 'Ben', 'Cem'])

  const stored = await prisma.voterLink.findMany({ where: { pollId: poll.id }, orderBy: { createdAt: 'asc' } })
  expect(stored.map(l => [l.label, l.email])).toEqual([['Anna', null], ['Ben', 'ben@example.test'], ['Cem', null]])
  const annaToken = new URL(links.get('Anna')!).searchParams.get('k')!
  expect(stored[0].tokenHash).toBe(hashToken(annaToken))
  expect(stored.some(l => l.tokenHash === annaToken)).toBe(false)

  const voter = await (await browser.newContext()).newPage()
  // Ohne bzw. mit falschem Link: kein Abstimmen.
  await voter.goto(`/${poll.id}`)
  await expect(voter.getByText('bekommt jede Person einen persönlichen Link')).toBeVisible()
  await voter.goto(`/${poll.id}?k=falsch`)
  await expect(voter.getByText('bekommt jede Person einen persönlichen Link')).toBeVisible()

  await vote(voter, links.get('Anna')!, 'Pizza')
  await expect(voter.getByText('Persönlicher Link für Anna')).toBeVisible()
  const vote1 = await prisma.vote.findFirstOrThrow({ where: { pollId: poll.id } })
  expect(vote1).toMatchObject({ identityKind: 'LINK', voterKey: `link:${stored[0].id}`, voterName: 'Anna' })

  await page.reload()
  await expect(page.getByText('Beteiligung: 1 von 3 haben abgestimmt')).toBeVisible()
  await expect(page.getByText('Diese Links werden nur jetzt angezeigt')).toHaveCount(0)
  // Wer verwaltet, sieht den Namen am Ergebnis.
  await expect(page.getByText('Anna', { exact: true }).and(page.locator('p'))).toBeVisible()
  await voter.context().close()
})

test('neu ausstellen: alter Link ungültig, Stimme bleibt - widerrufen entfernt sie', async ({ page, browser }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'LINK' })
  await login(page, owner.email)
  const links = await issueLinks(page, poll.id, ['Anna'])
  const voter = await (await browser.newContext()).newPage()
  await vote(voter, links.get('Anna')!, 'Sushi')

  await page.reload()
  await page.getByRole('button', { name: 'Link für Anna neu ausstellen' }).click()
  await expect(page.getByText('Neuer Link für Anna - der bisherige gilt nicht mehr.')).toBeVisible()
  const fresh = await page.getByLabel('Anna', { exact: true }).inputValue()
  expect(fresh).not.toBe(links.get('Anna'))

  await voter.goto(links.get('Anna')!)
  await expect(voter.getByText('bekommt jede Person einen persönlichen Link')).toBeVisible()
  await voter.goto(fresh)
  await expect(voter.getByText('Sushi ✓')).toBeVisible()

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Link für Anna widerrufen' }).click()
  await expect(page.getByText('Link für Anna widerrufen.')).toBeVisible()
  expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0)
  expect(await prisma.voterLink.count({ where: { pollId: poll.id } })).toBe(0)
  await voter.goto(fresh)
  await expect(voter.getByText('bekommt jede Person einen persönlichen Link')).toBeVisible()
  await voter.context().close()
})

test('nur Anzahl: Links werden durchnummeriert', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'LINK' })
  await login(page, owner.email)
  await page.goto(`/${poll.id}/verwalten`)
  await page.getByLabel('Anzahl ohne Namen').fill('2')
  await page.getByRole('button', { name: 'Links ausstellen' }).click()
  await expect(page.getByText('2 Links ausgestellt.')).toBeVisible()
  await expect(page.getByLabel('Link 1', { exact: true })).toHaveValue(/\?k=/)
  await expect(page.getByLabel('Link 2', { exact: true })).toHaveValue(/\?k=/)
  await expect(page.getByLabel('Alle auf einmal (zum Kopieren)')).toHaveValue(/^Link 1: .+\nLink 2: .+$/)
})

test('geheime Wahl: nur Teilnahme gespeichert, Stimme keinem Link zuzuordnen', async ({ page, browser }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'LINK', secretBallot: true, showVoterNames: true })
  await login(page, owner.email)
  const links = await issueLinks(page, poll.id, ['Anna', 'Ben'])

  const voter = await (await browser.newContext()).newPage()
  await vote(voter, links.get('Anna')!, 'Pizza')
  await expect(voter.getByText('Geheime Wahl: Gespeichert wird nur, dass du abgestimmt hast')).toBeVisible()
  await expect(voter.getByText('namentlich')).toHaveCount(0)
  // Ändern über denselben Link klappt weiterhin.
  await vote(voter, links.get('Anna')!, 'Sushi')

  const anna = await prisma.voterLink.findFirstOrThrow({ where: { pollId: poll.id, label: 'Anna' } })
  expect(anna.hasVoted).toBe(true)
  const votes = await prisma.vote.findMany({ where: { pollId: poll.id } })
  expect(votes).toHaveLength(1)
  expect(votes[0].voterKey).not.toContain(anna.id)
  expect(votes[0].voterName).toBeNull()
  expect(votes[0].createdAt.getTime()).toBe(0)

  await page.reload()
  await expect(page.getByText('Beteiligung: 1 von 2 haben abgestimmt')).toBeVisible()
  await expect(page.getByText('Anna', { exact: true }).and(page.locator('p'))).toHaveCount(0)

  // Neu ausstellen nach der Stimme: kein zweites Mal abstimmen, die alte Stimme zählt weiter.
  await page.getByRole('button', { name: 'Link für Anna neu ausstellen' }).click()
  const fresh = await page.getByLabel('Anna', { exact: true }).inputValue()
  await voter.goto(fresh)
  await expect(voter.getByText('Mit deinem Link wurde bereits abgestimmt')).toBeVisible()
  await expect(voter.getByRole('button', { name: /Abstimmen|Auswahl speichern/ })).toHaveCount(0)

  // Widerrufen geht nicht mehr (die Stimme wäre nicht auffindbar).
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Link für Anna widerrufen' }).click()
  await expect(page.getByText('dieser Link kann daher nicht mehr widerrufen werden')).toBeVisible()
  expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(1)
  await voter.context().close()
})

test('Moderator:in mit Freigabe darf Links ausstellen, fremde Konten nicht', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'LINK' })
  const moderator = await createAccount('MODERATOR')
  await prisma.pollAccess.create({ data: { pollId: poll.id, userId: moderator.id } })
  await login(page, moderator.email)
  const links = await issueLinks(page, poll.id, ['Dora'])
  expect(links.get('Dora')).toContain(`/${poll.id}?k=`)

  const stranger = await createAccount()
  await page.context().clearCookies()
  await login(page, stranger.email)
  const response = await page.goto(`/${poll.id}/verwalten`)
  expect(response?.status()).toBe(404)
})
