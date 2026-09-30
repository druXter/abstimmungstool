import { createECDH, createHash, createHmac, randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { createAccount, createPoll, login, prisma, unique, uniqueEmail } from './helpers'
import { mailsTo, waitForMail } from './mail-server'
import { pollDateMessages, RSVP_ORIGIN, setRsvpScenario } from './rsvp-server'
import { PUSH_ORIGIN, pushesTo } from './push-server'
import { BASE_URL, TEST_RSVP_SECRET } from '../../playwright.config'

// Terminabstimmung abschließen (app/lib/final-date.ts) und an rsvp-app übergeben
// (app/lib/rsvp-date.ts). rsvp-app spielt tests/e2e/rsvp-server.ts.

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/** Prüft die Signatur einer an rsvp-app geschickten Nachricht mit dem gemeinsamen Test-Secret. */
function signatureValid(token: string): boolean {
  const [payloadPart, signature] = token.split('.')
  return createHmac('sha256', TEST_RSVP_SECRET).update(payloadPart).digest('base64url') === signature
}

const DATES = { '2026-10-07T19:00': 'Mi., 07.10.2026, 19:00 Uhr', '2026-10-08T18:30': 'Do., 08.10.2026, 18:30 Uhr' }

async function datePoll(ownerId: string, data: Parameters<typeof createPoll>[1] = {}) {
  const dates = Object.keys(DATES)
  const poll = await createPoll(ownerId, { optionKind: 'DATETIME', confirmDate: true, ...data }, Object.values(DATES))
  for (const [i, option] of poll.options.entries()) {
    await prisma.pollOption.update({ where: { id: option.id }, data: { startsAt: new Date(`${dates[i]}:00+02:00`) } })
  }
  return poll
}

async function vote(pollId: string, optionId: string, kind: 'RSVP' | 'EMAIL' | 'LINK' | 'COOKIE' | 'ACCOUNT', raw: string) {
  await prisma.vote.create({ data: { pollId, optionId, identityKind: kind, voterKey: `${kind.toLowerCase()}:${raw}`, voterName: raw } })
}

async function closeViaUi(page: Page, pollId: string) {
  await page.goto(`/${pollId}/verwalten`)
  await page.getByRole('button', { name: /Abstimmung jetzt schließen/ }).click()
  await expect(page.getByText('Abstimmung ist geschlossen.')).toBeVisible()
}

test('eindeutig: Verwaltung bestätigt, rsvp-app übernimmt, RSVP-Abstimmende benachrichtigt rsvp-app', async ({ page }) => {
  const owner = await prisma.user.update({ where: { id: (await createAccount()).id }, data: { email: uniqueEmail('owner') } })
  // Konto über den Verbund mit rsvp-app verknüpft: dessen Konto-ID geht mit.
  await prisma.externalIdentity.create({ data: { issuer: RSVP_ORIGIN, subject: `rsvp-${unique()}`, userId: owner.id } })
  const identity = await prisma.externalIdentity.findFirstOrThrow({ where: { userId: owner.id } })
  const poll = await datePoll(owner.id, { voterIdentity: 'RSVP' })
  const guests = [uniqueEmail('gast'), uniqueEmail('gast')]
  await vote(poll.id, poll.options[0].id, 'RSVP', guests[0])
  await vote(poll.id, poll.options[0].id, 'RSVP', guests[1])
  setRsvpScenario({ events: [{ id: 'ev1', title: 'Sommerfest', datePending: true }], updated: [{ id: 'ev1', title: 'Sommerfest', url: `${RSVP_ORIGIN}/sommerfest` }] })

  await login(page, owner.email)
  await closeViaUi(page, poll.id)
  const request = await waitForMail(owner.email)
  expect(request).toContain(`Termin bestätigen: ${poll.title}`)

  await page.reload()
  await expect(page.getByText('Eindeutiges Ergebnis: Mi., 07.10.2026, 19:00 Uhr')).toBeVisible()
  await expect(page.getByText('rsvp-app-Event "Sommerfest": übernimmt den Termin')).toBeVisible()
  await page.getByRole('button', { name: 'Termin bestätigen' }).click()
  await page.waitForURL(/festgelegt=1/)
  await expect(page.getByText('In rsvp-app übernommen:')).toBeVisible()

  const messages = pollDateMessages(poll.id)
  const set = messages.find(m => m.payload.typ === 'poll-date-set')!
  expect(signatureValid(set.token)).toBe(true)
  expect(set.payload).toMatchObject({
    pollTitle: poll.title, startsAt: '2026-10-07T17:00:00.000Z', create: false, skipEmailHashes: [],
    owner: { toolUserId: owner.id, rsvpUserId: identity.subject }
  })
  expect(messages.some(m => m.payload.typ === 'poll-date-status')).toBe(true)

  const stored = await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })
  expect(stored.finalOptionId).toBe(poll.options[0].id)
  expect(stored.finalStartsAt?.toISOString()).toBe('2026-10-07T17:00:00.000Z')
  // RSVP-Abstimmende benachrichtigt rsvp-app selbst (sein Event hat den Termin übernommen).
  for (const guest of guests) expect(mailsTo(guest)).toHaveLength(0)

  await page.goto(`/${poll.id}`)
  await expect(page.getByText('Termin steht fest: Mi., 07.10.2026, 19:00 Uhr')).toBeVisible()
  await expect(page.getByRole('link', { name: 'zur Veranstaltung (Zu-/Absage)' })).toHaveAttribute('href', `${RSVP_ORIGIN}/sommerfest`)
})

test('Gleichstand bei Tagen: Verwaltung entscheidet mit Uhrzeit, neues Event, Abstimmende per Mail', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { optionKind: 'DATE', confirmDate: true, voterIdentity: 'LINK' }, ['Sa., 24.10.2026', 'So., 25.10.2026'])
  await prisma.pollOption.update({ where: { id: poll.options[0].id }, data: { startsAt: new Date('2026-10-24T00:00:00+02:00') } })
  await prisma.pollOption.update({ where: { id: poll.options[1].id }, data: { startsAt: new Date('2026-10-25T00:00:00+02:00') } })
  const anna = uniqueEmail('anna')
  const ben = uniqueEmail('ben')
  for (const [i, email] of [anna, ben].entries()) {
    const link = await prisma.voterLink.create({ data: { pollId: poll.id, tokenHash: `hash-${unique()}`, label: email, email, hasVoted: true } })
    await vote(poll.id, poll.options[i].id, 'LINK', link.id)
  }
  await prisma.poll.update({ where: { id: poll.id }, data: { closedAt: new Date() } })
  setRsvpScenario({ canCreate: true, created: { id: 'ev2', title: poll.title, url: `${RSVP_ORIGIN}/neu`, adminUrl: `${RSVP_ORIGIN}/admin/edit/ev2` } })

  await login(page, owner.email)
  await page.goto(`/${poll.id}/verwalten`)
  await expect(page.getByRole('heading', { name: 'Termin entscheiden' })).toBeVisible()
  await expect(page.getByText('Benachrichtigt werden 2 erreichbare Abstimmende')).toBeVisible()
  await page.getByRole('radio', { name: 'So., 25.10.2026' }).check()
  await page.getByLabel('Uhrzeit').fill('19:30')
  await expect(page.getByLabel(/In rsvp-app ein neues Event anlegen/)).toBeChecked()
  await page.getByRole('button', { name: 'Diesen Termin festlegen' }).click()
  await page.waitForURL(/festgelegt=1/)
  await expect(page.getByText('In rsvp-app neu angelegt:')).toBeVisible()

  const set = pollDateMessages(poll.id).find(m => m.payload.typ === 'poll-date-set')!
  // 25.10.2026 ist der Tag der Zeitumstellung - um 19:30 gilt schon Winterzeit (UTC+1).
  expect(set.payload).toMatchObject({ startsAt: '2026-10-25T18:30:00.000Z', create: true })
  expect([...(set.payload.skipEmailHashes as string[])].sort()).toEqual([sha256(anna), sha256(ben)].sort())

  for (const email of [anna, ben]) {
    const mail = await waitForMail(email)
    expect(mail).toContain(`Termin steht fest: ${poll.title}`)
    expect(mail).toContain('So., 25.10.2026, 19:30 Uhr')
    expect(mail).toContain(`${RSVP_ORIGIN}/neu`)
  }
})

test('rsvp-app nicht erreichbar: trotzdem festgelegt, Übergabe lässt sich wiederholen - ohne erneute Mails', async ({ page }) => {
  const owner = await createAccount()
  const poll = await datePoll(owner.id, { voterIdentity: 'EMAIL', closedAt: new Date() })
  const voter = uniqueEmail('mail')
  await vote(poll.id, poll.options[1].id, 'EMAIL', voter)
  setRsvpScenario({ status: 503 })

  await login(page, owner.email)
  await page.goto(`/${poll.id}/verwalten`)
  await expect(page.getByText('rsvp-app ist gerade nicht erreichbar')).toBeVisible()
  await page.getByRole('button', { name: 'Termin bestätigen' }).click()
  await page.waitForURL(/festgelegt=1/)
  await expect(page.getByText('rsvp-app war nicht erreichbar')).toBeVisible()
  await waitForMail(voter)
  expect(mailsTo(voter)).toHaveLength(1)

  setRsvpScenario({ events: [{ id: 'ev3', title: 'Treffen', datePending: true }], updated: [{ id: 'ev3', title: 'Treffen', url: `${RSVP_ORIGIN}/treffen` }] })
  await page.getByRole('button', { name: 'Erneut an rsvp-app übertragen' }).click()
  await expect(page.getByText('In rsvp-app übernommen:')).toBeVisible()
  expect(pollDateMessages(poll.id).filter(m => m.payload.typ === 'poll-date-set')).toHaveLength(2)
  expect(mailsTo(voter)).toHaveLength(1)
})

test('Festlegen nur einmal, nur Gewinner, nur Verwaltende', async ({ page, browser }) => {
  const owner = await createAccount()
  const poll = await datePoll(owner.id, { voterIdentity: 'COOKIE', closedAt: new Date() })
  await vote(poll.id, poll.options[0].id, 'COOKIE', `c-${unique()}`)
  setRsvpScenario({})

  // Fremdes Konto sieht die Verwaltungsseite gar nicht
  const stranger = await createAccount()
  const strangerPage = await (await browser.newContext()).newPage()
  await login(strangerPage, stranger.email)
  expect((await strangerPage.goto(`/${poll.id}/verwalten`))?.status()).toBe(404)
  await strangerPage.context().close()

  await login(page, owner.email)
  await page.goto(`/${poll.id}/verwalten`)
  await expect(page.getByText('Benachrichtigt wird niemand')).toBeVisible()
  // Manipuliert: der Verlierer-Termin - wird nicht angenommen
  await page.locator('input[name="optionId"]').evaluate((input, id) => { (input as HTMLInputElement).value = id }, poll.options[1].id)
  const rejected = page.waitForResponse(response => response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Termin bestätigen' }).click()
  await rejected
  expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).finalizedAt).toBeNull()

  // Positivkontrolle
  await page.goto(`/${poll.id}/verwalten`)
  await page.getByRole('button', { name: 'Termin bestätigen' }).click()
  await page.waitForURL(/festgelegt=1/)
  expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).finalOptionId).toBe(poll.options[0].id)
  await expect(page.getByRole('heading', { name: 'Termin festgelegt' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Termin bestätigen' })).toHaveCount(0)
})

test('ohne Terminoptionen oder ohne "Termin festlegen" kein Abschnitt; Quorum verfehlt: nichts festzulegen', async ({ page }) => {
  const owner = await createAccount()
  const text = await createPoll(owner.id, { confirmDate: true, closedAt: new Date() })
  const off = await datePoll(owner.id, { confirmDate: false, closedAt: new Date() })
  const quorum = await datePoll(owner.id, { quorum: 5, closedAt: new Date() })
  await vote(quorum.id, quorum.options[0].id, 'COOKIE', `q-${unique()}`)

  await login(page, owner.email)
  for (const poll of [text, off]) {
    await page.goto(`/${poll.id}/verwalten`)
    await expect(page.getByRole('heading', { name: /Termin/ })).toHaveCount(0)
  }
  await page.goto(`/${quorum.id}/verwalten`)
  await expect(page.getByText('Die Mindestbeteiligung wurde verfehlt')).toBeVisible()
  expect(BASE_URL).toBeTruthy()
})

test('Push nur mit Konto: Verwaltung und Konto-Abstimmende mit Mitteilungen bekommen Push statt Mail', async ({ page, browser }) => {
  const owner = await prisma.user.update({ where: { id: (await createAccount()).id }, data: { email: uniqueEmail('owner') } })
  const voter = await prisma.user.update({ where: { id: (await createAccount('MODERATOR')).id }, data: { email: uniqueEmail('konto') } })
  const quiet = await prisma.user.update({ where: { id: (await createAccount('MODERATOR')).id }, data: { email: uniqueEmail('ohnepush') } })
  const poll = await datePoll(owner.id, { voterIdentity: 'ACCOUNT' })
  await vote(poll.id, poll.options[0].id, 'ACCOUNT', voter.id)
  await vote(poll.id, poll.options[0].id, 'ACCOUNT', quiet.id)
  setRsvpScenario({})

  // Push-Abos wie in tests/e2e/push.spec.ts (nur die Zustellung zählt hier, nicht der Inhalt).
  const subscribeUser = async (userId: string, loginPage: Page, email: string) => {
    await login(loginPage, email)
    const session = await prisma.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } })
    const path = `/push/${unique()}`
    await prisma.pushSubscription.create({
      data: { userId, sessionId: session.id, endpoint: `${PUSH_ORIGIN}${path}`, p256dh: createECDH('prime256v1').generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') }
    })
    return path
  }
  const voterPage = await (await browser.newContext()).newPage()
  const voterPush = await subscribeUser(voter.id, voterPage, voter.email)
  const ownerPush = await subscribeUser(owner.id, page, owner.email)

  await closeViaUi(page, poll.id)
  await expect.poll(() => pushesTo(ownerPush).length).toBe(1)
  expect(mailsTo(owner.email)).toHaveLength(0)

  await page.reload()
  await page.getByRole('button', { name: 'Termin bestätigen' }).click()
  await page.waitForURL(/festgelegt=1/)
  await expect.poll(() => pushesTo(voterPush).length).toBe(1)
  expect(mailsTo(voter.email)).toHaveLength(0)
  // Ohne Mitteilungen: Mail
  expect(await waitForMail(quiet.email)).toContain(`Termin steht fest: ${poll.title}`)
  await voterPage.context().close()
})
