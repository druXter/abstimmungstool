import { expect, test } from '@playwright/test'
import { createAccount, createPoll, login, prisma, uniqueEmail } from './helpers'
import { mailsTo, waitForMail } from './mail-server'
import { resultMessages } from './rsvp-server'
import { TEST_CRON_SECRET } from '../../playwright.config'

// Verwaltung & Komfort (TODO.md C): CSV-Export, QR-Code, Duplizieren, Ergebnis-Mail, Quorum.

async function addVote(pollId: string, optionId: string, key: string, name: string | null = null) {
  await prisma.vote.create({ data: { pollId, optionId, identityKind: 'COOKIE', voterKey: `cookie:${key}`, voterName: name } })
}

test('CSV-Export: Zählstand und Namen, Formeln entschärft, nur für Verwaltende', async ({ page, request }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { requireVoterName: true, quorum: 5 })
  await addVote(poll.id, poll.options[0].id, 'a', 'Anna')
  await addVote(poll.id, poll.options[1].id, 'b', '=HYPERLINK("http://example.test")')

  expect((await request.get(`/${poll.id}/verwalten/export`)).status()).toBe(404)

  await login(page, owner.email)
  await page.goto(`/${poll.id}/verwalten`)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: /CSV-Export/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`abstimmung-${poll.id}.csv`)
  const csv = (await (await download.createReadStream()).toArray()).map(chunk => chunk.toString('utf8')).join('')

  expect(csv.startsWith('﻿')).toBe(true)
  expect(csv).toContain('"Teilnehmende";"2"')
  expect(csv).toContain('"Ergebnis";"Nicht beschlussfähig: 2 von mindestens 5 Teilnehmenden."')
  expect(csv).toContain('"Pizza";"1";"50 %"')
  expect(csv).toContain('"Anna";"Pizza"')
  expect(csv).toContain(`"'=HYPERLINK(""http://example.test"")";"Sushi"`)
})

test('QR-Code zum Abstimmungslink', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id)
  await login(page, owner.email)
  await page.goto(`/${poll.id}/verwalten`)
  await page.getByText('QR-Code zum Link').click()
  await expect(page.getByRole('img', { name: 'QR-Code zum Abstimmungslink' }).locator('svg')).toBeVisible()
})

test('Duplizieren: Optionen und Einstellungen ja, Stimmen und Schließdatum nein', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, {
    voterIdentity: 'LINK', secretBallot: true, accessCode: 'Sommerfest', quorum: 3,
    closesAt: new Date(Date.now() - 60_000)
  }, ['A', 'B', 'C'])
  await prisma.vote.create({ data: { pollId: poll.id, optionId: poll.options[0].id, identityKind: 'LINK', voterKey: 'link:x' } })

  await login(page, owner.email)
  await page.goto(`/${poll.id}/verwalten`)
  await page.getByRole('button', { name: /Duplizieren/ }).click()
  await page.waitForURL(/duplicated=1/)
  await expect(page.getByText('Kopie angelegt')).toBeVisible()
  const copyId = new URL(page.url()).pathname.split('/')[1]
  expect(copyId).not.toBe(poll.id)

  const copy = await prisma.poll.findUniqueOrThrow({ where: { id: copyId }, include: { options: { orderBy: { position: 'asc' } }, votes: true } })
  expect(copy).toMatchObject({
    title: `${poll.title} (Kopie)`, ownerId: owner.id, voterIdentity: 'LINK', secretBallot: true,
    accessCode: 'Sommerfest', quorum: 3, closesAt: null, closedAt: null
  })
  expect(copy.options.map(o => o.label)).toEqual(['A', 'B', 'C'])
  expect(copy.votes).toHaveLength(0)
})

test('Ergebnis-Mail beim manuellen Schließen - genau einmal', async ({ page }) => {
  const owner = await prisma.user.update({ where: { id: (await createAccount()).id }, data: { email: uniqueEmail('owner') } })
  const poll = await createPoll(owner.id, { notifyOwnerOnClose: true })
  await addVote(poll.id, poll.options[1].id, `m-${poll.id}`)

  await login(page, owner.email)
  await page.goto(`/${poll.id}/verwalten`)
  await page.getByRole('button', { name: /Abstimmung jetzt schließen/ }).click()
  await expect(page.getByText('Abstimmung ist geschlossen.')).toBeVisible()

  const mail = await waitForMail(owner.email)
  expect(mail).toContain(`Abstimmung beendet: ${poll.title}`)
  expect(mail).toContain('Ergebnis: "Sushi".')
  expect(mail).toContain('Sushi: 1 Stimme')
  expect(mail).toContain(`/${poll.id}/verwalten`)
  expect(mailsTo(owner.email)).toHaveLength(1)
})

test('Auto-Schließen per Cron: Quorum verfehlt -> nicht beschlussfähig, Mail nur einmal', async ({ page, request }) => {
  const owner = await prisma.user.update({ where: { id: (await createAccount()).id }, data: { email: uniqueEmail('cron') } })
  const poll = await createPoll(owner.id, { notifyOwnerOnClose: true, quorum: 2, closesAt: new Date(Date.now() - 1000) })
  await addVote(poll.id, poll.options[0].id, `c-${poll.id}`)

  expect((await request.get('/api/cron/close-expired-polls?secret=falsch')).status()).toBe(401)
  const first = await request.get(`/api/cron/close-expired-polls?secret=${TEST_CRON_SECRET}`)
  expect(first.ok()).toBe(true)
  expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).closedAt).not.toBeNull()
  const mail = await waitForMail(owner.email)
  expect(mail).toContain('Nicht beschlussfähig: 1 von mindestens 2 Teilnehmenden.')

  await request.get(`/api/cron/close-expired-polls?secret=${TEST_CRON_SECRET}`)
  expect(mailsTo(owner.email)).toHaveLength(1)

  await page.goto(`/${poll.id}`)
  await expect(page.getByText('Nicht beschlussfähig: 1 von mindestens 2 Teilnehmenden.')).toBeVisible()
})

test('Quorum während der Abstimmung: es fehlen noch …', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { quorum: 3 })
  await addVote(poll.id, poll.options[0].id, `q-${poll.id}`)
  await page.goto(`/${poll.id}`)
  await expect(page.getByText('Mindestbeteiligung: 3 Teilnehmende - es fehlen noch 2.')).toBeVisible()
})

test('Ergebnis-Meldung an rsvp-app: nicht beschlussfähig bzw. Punkte - bei "nur Verwaltung" gar nicht', async ({ request }) => {
  const owner = await createAccount()
  const cron = () => request.get(`/api/cron/close-expired-polls?secret=${TEST_CRON_SECRET}`)
  const expired = { rsvpEventId: 'ev-rsvp', closesAt: new Date(Date.now() - 1000) }

  const quorum = await createPoll(owner.id, { ...expired, quorum: 3 })
  await addVote(quorum.id, quorum.options[0].id, `rq-${quorum.id}`)
  const points = await createPoll(owner.id, { ...expired, pollType: 'POINTS', pointsBudget: 10 })
  await prisma.vote.create({ data: { pollId: points.id, optionId: points.options[1].id, identityKind: 'COOKIE', voterKey: `cookie:rp-${points.id}`, value: 7 } })
  const hidden = await createPoll(owner.id, { ...expired, resultsVisibility: 'MANAGERS' })
  await addVote(hidden.id, hidden.options[0].id, `rh-${hidden.id}`)

  expect((await cron()).ok()).toBe(true)
  await expect.poll(() => resultMessages(quorum.id).length).toBe(1)
  expect(resultMessages(quorum.id)[0]).toMatchObject({ eventId: 'ev-rsvp', quorumMet: false, winners: [], unit: 'votes' })
  await expect.poll(() => resultMessages(points.id).length).toBe(1)
  expect(resultMessages(points.id)[0]).toMatchObject({ quorumMet: true, unit: 'points', winners: [{ label: 'Sushi', votes: 7 }] })
  expect(resultMessages(hidden.id)).toHaveLength(0)
})
