import { createHmac } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createAccount, createPoll, login, PASSWORD, prisma, uniqueEmail } from './helpers'
import { TEST_RSVP_SECRET } from '../../playwright.config'

// Stimmabgabe und Identitätsmodell (Poll.voterIdentity, siehe app/lib/voter-identity.ts).
// rsvp-app spielen die Tests selbst: Sie signieren Klick-Tokens und Webhooks mit dem
// gemeinsamen Test-Secret, genau im Format aus app/lib/rsvp-verification.ts.

function signRsvp(payload: object): string {
  const part = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')
  return `${part}.${createHmac('sha256', TEST_RSVP_SECRET).update(part).digest('base64url')}`
}

test.describe('Modus COOKIE (Standard)', () => {
  test('anlegen, abstimmen, Auswahl ändern - eine Person bleibt eine Person', async ({ page, browser }) => {
    const owner = await createAccount()
    await login(page, owner.email)
    await page.goto('/erstellen')
    await page.getByLabel('Frage / Titel').fill('Wohin am Mittwoch?')
    const optionInputs = page.locator('input[name="option"]')
    await optionInputs.nth(0).fill('Pizza')
    await optionInputs.nth(1).fill('Sushi')
    // Der Standard ist vorausgewählt.
    await expect(page.getByRole('radio', { name: /Offen für alle/ })).toBeChecked()
    await page.getByRole('button', { name: 'Abstimmung erstellen' }).click()
    await page.waitForURL(/\/verwalten\?created=1/)
    const pollId = new URL(page.url()).pathname.split('/')[1]
    expect((await prisma.poll.findUniqueOrThrow({ where: { id: pollId } })).voterIdentity).toBe('COOKIE')

    const voterContext = await browser.newContext()
    const voterPage = await voterContext.newPage()
    await voterPage.goto(`/${pollId}`)
    await voterPage.getByRole('radio', { name: 'Pizza' }).check()
    await voterPage.getByRole('button', { name: 'Abstimmen' }).click()
    await expect(voterPage.getByText('Pizza ✓')).toBeVisible()
    await expect(voterPage.getByText('Live-Ergebnis (1 Person)')).toBeVisible()

    await voterPage.getByRole('radio', { name: 'Sushi' }).check()
    await voterPage.getByRole('button', { name: 'Auswahl speichern' }).click()
    await expect(voterPage.getByText('Sushi ✓')).toBeVisible()
    await expect(voterPage.getByText('Live-Ergebnis (1 Person)')).toBeVisible()

    const votes = await prisma.vote.findMany({ where: { pollId } })
    expect(votes).toHaveLength(1)
    expect(votes[0].identityKind).toBe('COOKIE')
    expect(votes[0].voterKey).toMatch(/^cookie:/)
    expect(votes[0].voterName).toBeNull()

    // Ein anderer Browser ist eine andere (Cookie-)Identität.
    const otherContext = await browser.newContext()
    const otherPage = await otherContext.newPage()
    await otherPage.goto(`/${pollId}`)
    await otherPage.getByRole('radio', { name: 'Sushi' }).check()
    await otherPage.getByRole('button', { name: 'Abstimmen' }).click()
    await expect(otherPage.getByText('Live-Ergebnis (2 Personen)')).toBeVisible()

    await voterContext.close()
    await otherContext.close()
  })

  test('ein mitgeschickter rsvp-Token wird ignoriert', async ({ page }) => {
    const owner = await createAccount()
    const poll = await createPoll(owner.id)
    const verify = signRsvp({ email: uniqueEmail('gast'), pollId: poll.id, attending: true })
    await page.goto(`/${poll.id}?verify=${verify}`)
    await page.getByRole('radio', { name: 'Pizza' }).check()
    await page.getByRole('button', { name: 'Abstimmen' }).click()
    await expect(page.getByText('Pizza ✓')).toBeVisible()
    const vote = await prisma.vote.findFirstOrThrow({ where: { pollId: poll.id } })
    expect(vote.identityKind).toBe('COOKIE')
  })
})

test.describe('Modus RSVP', () => {
  test('ohne Token kein Abstimmen - auch nicht per direkt abgeschicktem Formular', async ({ page }) => {
    const owner = await createAccount()
    const poll = await createPoll(owner.id, { voterIdentity: 'RSVP' })
    await page.goto(`/${poll.id}`)
    await expect(page.getByText('nur über den entsprechenden Link/Button in rsvp-app erreichbar')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Abstimmen' })).toHaveCount(0)

    // Formular mit gültigem Token laden, den Token vor dem Absenden entfernen: Der Server
    // muss selbst ablehnen, nicht nur die Seite das Formular ausblenden.
    await page.goto(`/${poll.id}?verify=${signRsvp({ email: uniqueEmail('gast'), pollId: poll.id, attending: true })}`)
    await page.locator('input[name="verifyToken"]').evaluate(input => input.remove())
    await page.getByRole('radio', { name: 'Pizza' }).check()
    const actionDone = page.waitForResponse(response => response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Abstimmen' }).click()
    await actionDone
    expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0)
    await expect(page.getByText('Pizza ✓')).toHaveCount(0)
  })

  test('mit Token abstimmen, namentlich anzeigen, Absage entfernt die Stimme', async ({ page, request }) => {
    const owner = await createAccount()
    const poll = await createPoll(owner.id, { voterIdentity: 'RSVP', showVoterNames: true })
    const email = uniqueEmail('gast')

    await page.goto(`/${poll.id}?verify=${signRsvp({ email: email.toUpperCase(), pollId: poll.id, attending: true })}`)
    await expect(page.getByText(`Angemeldet als ${email}`)).toBeVisible()
    await page.getByRole('radio', { name: 'Sushi' }).check()
    await page.getByRole('button', { name: 'Abstimmen' }).click()
    await expect(page.getByText('Sushi ✓')).toBeVisible()
    // showVoterNames: die (kleingeschriebene) E-Mail steht bei der Option.
    await expect(page.getByText(email, { exact: true }).and(page.locator('p'))).toBeVisible()

    const vote = await prisma.vote.findFirstOrThrow({ where: { pollId: poll.id } })
    expect(vote).toMatchObject({ identityKind: 'RSVP', voterKey: `rsvp:${email}`, voterName: email })

    // Neuer Klick über rsvp-app nach einer Absage: sichtbar blockiert.
    await page.goto(`/${poll.id}?verify=${signRsvp({ email, pollId: poll.id, attending: false })}`)
    await expect(page.getByText('Du hast für den zugehörigen Termin abgesagt')).toBeVisible()
    await expect(page.getByRole('button', { name: /Abstimmen|Auswahl speichern/ })).toHaveCount(0)

    // Webhook der Absage entfernt die bereits gezählte Stimme.
    const response = await request.post('/api/rsvp-webhook', {
      headers: { 'content-type': 'text/plain' },
      data: signRsvp({ email, pollId: poll.id, eventId: 'event-1', attending: false })
    })
    expect(response.ok()).toBe(true)
    expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0)
    expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).rsvpEventId).toBe('event-1')
  })

  test('Token für eine andere Abstimmung gilt nicht', async ({ page }) => {
    const owner = await createAccount()
    const poll = await createPoll(owner.id, { voterIdentity: 'RSVP' })
    await page.goto(`/${poll.id}?verify=${signRsvp({ email: uniqueEmail('gast'), pollId: 'eine-andere', attending: true })}`)
    await expect(page.getByText('nur über den entsprechenden Link/Button in rsvp-app erreichbar')).toBeVisible()
  })
})

test.describe('Modus ACCOUNT', () => {
  test('ohne Anmeldung Hinweis, nach Anmeldung zurück und abstimmen - geräteübergreifend eine Stimme', async ({ page, browser }) => {
    const owner = await createAccount()
    const poll = await createPoll(owner.id, { voterIdentity: 'ACCOUNT', showVoterNames: true })
    const voter = await prisma.user.update({ where: { id: (await createAccount('MODERATOR')).id }, data: { name: 'Berta' } })

    await page.goto(`/${poll.id}`)
    await expect(page.getByText('Für diese Abstimmung brauchst du ein Konto')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Abstimmen' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Jetzt anmelden' }).click()
    await page.getByLabel('E-Mail').fill(voter.email)
    await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD)
    await page.getByRole('main').getByRole('button', { name: 'Anmelden' }).click()
    await page.waitForURL(url => url.pathname === `/${poll.id}`)

    await expect(page.getByText('Du stimmst mit deinem Konto ab: Berta')).toBeVisible()
    await page.getByRole('radio', { name: 'Pizza' }).check()
    await page.getByRole('button', { name: 'Abstimmen' }).click()
    await expect(page.getByText('Pizza ✓')).toBeVisible()
    await expect(page.getByText('Berta', { exact: true }).and(page.locator('p'))).toBeVisible()
    const stored = await prisma.vote.findFirstOrThrow({ where: { pollId: poll.id } })
    expect(stored).toMatchObject({ identityKind: 'ACCOUNT', voterKey: `account:${voter.id}`, voterName: 'Berta' })

    // Anderes Gerät, gleiches Konto: dieselbe Stimme, keine zweite.
    const other = await (await browser.newContext()).newPage()
    await login(other, voter.email)
    await other.goto(`/${poll.id}`)
    await expect(other.getByText('Pizza ✓')).toBeVisible()
    await other.getByRole('radio', { name: 'Sushi' }).check()
    await other.getByRole('button', { name: 'Auswahl speichern' }).click()
    await expect(other.getByText('Sushi ✓')).toBeVisible()
    await expect(other.getByText('Live-Ergebnis (1 Person)')).toBeVisible()
    await other.context().close()
  })

  test('Löschen des Kontos behält die Stimme, entfernt aber den Namen', async ({ page }) => {
    const admin = await createAccount('ADMIN')
    const poll = await createPoll(admin.id, { voterIdentity: 'ACCOUNT' })
    const voter = await createAccount('MODERATOR')
    await prisma.vote.create({
      data: { pollId: poll.id, optionId: poll.options[0].id, identityKind: 'ACCOUNT', voterKey: `account:${voter.id}`, voterName: voter.email }
    })

    await login(page, admin.email)
    await page.goto('/nutzer')
    const row = page.getByRole('listitem').filter({ hasText: voter.email })
    page.once('dialog', dialog => dialog.accept())
    await row.getByRole('button', { name: /Löschen/ }).click()
    await expect(page.getByText(voter.email)).toHaveCount(0)

    const stored = await prisma.vote.findFirstOrThrow({ where: { pollId: poll.id } })
    expect(stored.voterName).toBeNull()
  })
})

test.describe('Bearbeiten', () => {
  test('Modus lässt sich ändern, solange niemand abgestimmt hat - danach gesperrt', async ({ page }) => {
    const owner = await createAccount()
    const poll = await createPoll(owner.id)
    await login(page, owner.email)

    await page.goto(`/${poll.id}/verwalten/bearbeiten`)
    await page.getByRole('radio', { name: /Nur über rsvp-app/ }).check()
    await page.getByRole('button', { name: 'Änderungen speichern' }).click()
    await page.waitForURL(/saved=1/)
    expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).voterIdentity).toBe('RSVP')

    await prisma.vote.create({
      data: { pollId: poll.id, optionId: poll.options[0].id, identityKind: 'RSVP', voterKey: 'rsvp:x@example.test', voterName: 'x@example.test' }
    })
    await page.goto(`/${poll.id}/verwalten/bearbeiten`)
    await expect(page.getByText('die Art der Stimmabgabe lässt sich deshalb nicht mehr ändern')).toBeVisible()
    await expect(page.getByRole('radio', { name: /Offen für alle/ })).toBeDisabled()
    await page.getByRole('button', { name: 'Änderungen speichern' }).click()
    await page.waitForURL(/saved=1/)
    expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).voterIdentity).toBe('RSVP')

    // Wer verwaltet, sieht die Namen auch ohne showVoterNames.
    await expect(page.getByText('x@example.test', { exact: true })).toBeVisible()
    await expect(page.getByText('Die Namen oben siehst nur du')).toBeVisible()
  })
})

test.describe('Ergebnis-Sichtbarkeit und Auswahlgrenzen', () => {
  test('erst nach der eigenen Stimme', async ({ page }) => {
    const owner = await createAccount()
    const poll = await createPoll(owner.id, { resultsVisibility: 'AFTER_VOTE' })
    await prisma.vote.create({ data: { pollId: poll.id, optionId: poll.options[0].id, identityKind: 'COOKIE', voterKey: `cookie:vis-${poll.id}` } })
    await page.goto(`/${poll.id}`)
    await expect(page.getByText('Das Ergebnis siehst du, sobald du abgestimmt hast. Bisher hat 1 Person abgestimmt.')).toBeVisible()
    await expect(page.getByText('Live-Ergebnis')).toHaveCount(0)
    await page.getByRole('radio', { name: 'Sushi' }).check()
    await page.getByRole('button', { name: 'Abstimmen' }).click()
    await expect(page.getByText('Live-Ergebnis (2 Personen)')).toBeVisible()
  })

  test('erst nach dem Ende / nur Verwaltung - die Verwaltung sieht es immer', async ({ page }) => {
    const owner = await createAccount()
    const afterClose = await createPoll(owner.id, { resultsVisibility: 'AFTER_CLOSE' })
    const managers = await createPoll(owner.id, { resultsVisibility: 'MANAGERS', closedAt: new Date() })

    await page.goto(`/${afterClose.id}`)
    await expect(page.getByText('Das Ergebnis wird nach dem Ende der Abstimmung angezeigt.')).toBeVisible()
    await prisma.poll.update({ where: { id: afterClose.id }, data: { closedAt: new Date() } })
    await page.reload()
    await expect(page.getByText('Live-Ergebnis (0 Personen)')).toBeVisible()

    await page.goto(`/${managers.id}`)
    await expect(page.getByText('Das Ergebnis sieht nur, wer die Abstimmung verwaltet.')).toBeVisible()
    await login(page, owner.email)
    await page.goto(`/${managers.id}/verwalten`)
    await expect(page.getByText('Ergebnis (0 Personen)')).toBeVisible()
  })

  test('Mehrfachauswahl 2 bis 2: Hinweis und serverseitige Prüfung', async ({ page }) => {
    const owner = await createAccount()
    const poll = await createPoll(owner.id, { allowMultipleChoices: true, minChoices: 2, maxChoices: 2 }, ['A', 'B', 'C'])
    await page.goto(`/${poll.id}`)
    await expect(page.getByText('Wähle genau 2 Optionen.')).toBeVisible()

    await page.getByRole('checkbox', { name: 'A' }).check()
    await page.getByRole('button', { name: 'Abstimmen' }).click()
    await page.waitForURL(/hinweis=auswahl/)
    await expect(page.getByText('Bitte halte dich an die angegebene Anzahl von Optionen')).toBeVisible()
    expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0)

    for (const label of ['A', 'B', 'C']) await page.getByRole('checkbox', { name: label }).check()
    // Die Meldung steht noch von eben da - daher auf die Antwort der Action warten, nicht auf sie.
    const rejected = page.waitForResponse(response => response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Abstimmen' }).click()
    await rejected
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('checkbox', { name: 'C' })).not.toBeChecked()
    expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0)

    // Nach der Ablehnung ist die Seite neu geladen, die Auswahl also leer.
    for (const label of ['A', 'B']) await page.getByRole('checkbox', { name: label }).check()
    await page.getByRole('button', { name: 'Abstimmen' }).click()
    await expect(page.getByText('A ✓')).toBeVisible()
    await expect(page.getByText('Bitte halte dich an die angegebene Anzahl von Optionen')).toHaveCount(0)
    expect(new URL(page.url()).searchParams.has('hinweis')).toBe(false)
    expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(2)
  })
})
