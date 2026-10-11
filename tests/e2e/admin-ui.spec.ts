import { expect, test } from '@playwright/test'
import { createAccount, createPoll, login, logout, openSection, prisma, unique } from './helpers'

// Oberfläche der Verwaltung (docs/KONZEPT-OBERFLAECHE.md): Vorlagen beim Anlegen, Übersicht, Reiter, Einstellungen.

test('Anlegen mit Vorlagen: Terminfindung stellt auf Tage um, Geheime Wahl führt zu den Stimmlinks', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/erstellen')

  await page.getByLabel('Frage / Titel').fill('Wann grillen wir?')
  await expect(page.getByRole('radio', { name: 'Freitext' })).toBeChecked()
  await page.getByRole('radio', { name: /^Terminfindung/ }).check()
  await expect(page.getByRole('radio', { name: 'Tage', exact: true })).toBeChecked()
  const inputs = page.locator('input[name="option"]')
  await inputs.nth(0).fill('2026-11-07')
  await inputs.nth(1).fill('2026-11-14')
  await page.getByRole('button', { name: 'Abstimmung erstellen' }).click()
  await page.waitForURL(/\/verwalten\?created=1/)
  const dateId = new URL(page.url()).pathname.split('/')[1]
  expect(await prisma.poll.findUniqueOrThrow({ where: { id: dateId } })).toMatchObject({
    optionKind: 'DATE', pollType: 'YES_MAYBE_NO', voterIdentity: 'COOKIE', requireVoterName: true, showVoterNames: true, confirmDate: true, ownerId: owner.id
  })
  await expect(page.getByText('Abstimmung erstellt!')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Stimmlinks' })).toHaveCount(0)

  await page.goto('/erstellen')
  await page.getByLabel('Frage / Titel').fill('Vorstandswahl')
  await page.getByRole('radio', { name: /^Geheime Wahl/ }).check()
  await inputs.nth(0).fill('Anna')
  await inputs.nth(1).fill('Ben')
  await page.getByRole('button', { name: 'Abstimmung erstellen' }).click()
  await page.waitForURL(/\/verwalten\/stimmlinks\?created=1/)
  const voteId = new URL(page.url()).pathname.split('/')[1]
  expect(await prisma.poll.findUniqueOrThrow({ where: { id: voteId } })).toMatchObject({ voterIdentity: 'LINK', secretBallot: true, resultsVisibility: 'AFTER_CLOSE' })
  await expect(page.getByRole('link', { name: 'Stimmlinks', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('Namensliste (eine Person pro Zeile)')).toBeVisible()
})

test('Anlegen: eine unbekannte Vorlage fällt auf die schnelle Umfrage zurück, Moderator-Konten legen nichts an', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/erstellen')
  await page.getByLabel('Frage / Titel').fill(`Manipuliert ${unique()}`)
  await page.locator('input[name="option"]').nth(0).fill('A')
  await page.locator('input[name="option"]').nth(1).fill('B')
  // Kein echter Wert, sondern ein geerbter Objekt-Schlüssel (nach dem Anklicken gesetzt - React stellt den Wert sonst zurück).
  await page.getByRole('radio', { name: /^Ideen sammeln/ }).check()
  await page.getByRole('radio', { name: /^Ideen sammeln/ }).evaluate(input => { (input as HTMLInputElement).value = 'toString' })
  await page.getByRole('button', { name: 'Abstimmung erstellen' }).click()
  await page.waitForURL(/created=1/)
  const pollId = new URL(page.url()).pathname.split('/')[1]
  expect(await prisma.poll.findUniqueOrThrow({ where: { id: pollId } })).toMatchObject({ pollType: 'CHOICE', voterIdentity: 'COOKIE', allowVoterOptions: false })

  const moderator = await createAccount('MODERATOR')
  await page.context().clearCookies()
  await login(page, moderator.email)
  await page.goto('/erstellen')
  await expect(page.getByRole('heading', { name: 'Anlegen nicht möglich' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abstimmung erstellen' })).toHaveCount(0)
  await page.goto('/meine-abstimmungen')
  await expect(page.getByRole('link', { name: '+ Neue Abstimmung' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Konten' })).toHaveCount(0)
})

test('Übersicht: was zu tun ist zuerst, Beendetes eingeklappt, Live-Runden und Freigaben gekennzeichnet', async ({ page }) => {
  const owner = await createAccount()
  const other = await createAccount()
  const open = await createPoll(owner.id, { title: `Offen ${unique()}` })
  const ended = await createPoll(owner.id, { title: `Beendet ${unique()}`, closedAt: new Date() })
  const decide = await createPoll(owner.id, { title: `Termin ${unique()}`, optionKind: 'DATE', confirmDate: true, closedAt: new Date() }, ['Sa., 07.11.2026', 'Sa., 14.11.2026'])
  await prisma.vote.create({ data: { pollId: decide.id, optionId: decide.options[0].id, identityKind: 'COOKIE', voterKey: 'cookie:t' } })
  const suggested = await createPoll(owner.id, { title: `Vorschlag ${unique()}`, allowVoterOptions: true })
  await prisma.pollOption.create({ data: { pollId: suggested.id, label: 'Döner', position: 2, approved: false } })
  const shared = await createPoll(other.id, { title: `Geteilt ${unique()}` })
  await prisma.pollAccess.create({ data: { pollId: shared.id, userId: owner.id } })
  const foreign = await createPoll(other.id, { title: `Fremd ${unique()}` })
  const live = await prisma.liveSession.create({ data: { title: `Quiz ${unique()}`, ownerId: owner.id, pin: null } })

  await login(page, owner.email)
  await page.goto('/meine-abstimmungen')
  const rows = page.getByTestId('poll-row')
  // Aufmerksamkeit zuerst: Termin festlegen und offene Vorschläge stehen vor den übrigen.
  const firstTwo = [await rows.nth(0).textContent(), await rows.nth(1).textContent()].join(' ')
  expect(firstTwo).toContain(decide.title)
  expect(firstTwo).toContain(suggested.title)
  await expect(rows.filter({ hasText: decide.title })).toContainText('Termin festlegen')
  await expect(rows.filter({ hasText: suggested.title })).toContainText('1 Vorschlag offen')
  await expect(rows.filter({ hasText: shared.title })).toContainText('freigegeben')
  await expect(rows.filter({ hasText: live.title })).toContainText('Live · Lobby')
  await expect(page.getByText(foreign.title)).toHaveCount(0)

  // Beendet: eingeklappt, erst nach dem Aufklappen sichtbar.
  const endedRow = page.getByTestId('ended-polls').getByTestId('poll-row').filter({ hasText: ended.title })
  await expect(endedRow).toBeHidden()
  await page.getByText(/Beendet \(\d+\)/).click()
  await expect(endedRow).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(open.title) })).toHaveAttribute('href', `/${open.id}/verwalten`)

  // Admins sehen alles, mit Besitz.
  const admin = await createAccount('ADMIN')
  await page.context().clearCookies()
  await login(page, admin.email)
  await page.goto('/meine-abstimmungen')
  await expect(page.getByTestId('poll-row').filter({ hasText: foreign.title })).toContainText(other.email)
})

test('Reiter: Stimmlinks nur bei persönlichen Links, Einstellungen speichern bleibt dort, Freigaben unter Einstellungen', async ({ page }) => {
  const owner = await createAccount()
  const moderator = await createAccount('MODERATOR')
  const poll = await createPoll(owner.id, { title: `Reiter ${unique()}` })
  await login(page, owner.email)

  // Ohne Stimmlinks führt der Reiter zurück zur Übersicht.
  await page.goto(`/${poll.id}/verwalten/stimmlinks`)
  await expect(page).toHaveURL(new RegExp(`/${poll.id}/verwalten$`))
  await expect(page.getByRole('link', { name: 'Übersicht' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('stat-voters')).toContainText('0')

  await page.getByRole('link', { name: 'Einstellungen' }).click()
  await expect(page.getByTestId('section-wer')).toContainText('offen für alle mit dem Link')
  await expect(page.getByTestId('section-ergebnis')).not.toHaveAttribute('open')
  await openSection(page, 'zugang')
  await page.getByLabel('Zugangscode').fill('Sommerfest')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await page.waitForURL(new RegExp(`/${poll.id}/verwalten/bearbeiten\\?saved=1`))
  await expect(page.getByText('Gespeichert.')).toBeVisible()
  await expect(page.getByTestId('section-zugang')).toContainText('Zugangscode')
  expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).accessCode).toBe('Sommerfest')

  // Freigeben (unbekannte Adresse zuerst: Fehlermeldung bleibt auf den Einstellungen).
  await page.getByLabel('E-Mail des Kontos').fill(`niemand-${unique()}@example.test`)
  await page.getByRole('button', { name: 'Freigeben' }).click()
  await expect(page.getByText('Zu dieser E-Mail-Adresse gibt es kein Konto')).toBeVisible()
  await expect(page).toHaveURL(/\/verwalten\/bearbeiten\?shareError=notfound/)
  await page.getByLabel('E-Mail des Kontos').fill(moderator.email)
  await page.getByRole('button', { name: 'Freigeben' }).click()
  await expect(page.getByText('Freigabe hinzugefügt.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Freigaben' })).toContainText(moderator.email)

  // Moderator:in: bearbeiten ja, teilen und löschen nein; Link "Verwalten" auf der Abstimmungsseite.
  await page.context().clearCookies()
  await login(page, moderator.email)
  await page.goto(`/${poll.id}`)
  await page.getByLabel('Zugangscode').fill('Sommerfest')
  await page.getByRole('button', { name: /Weiter|Freischalten|Öffnen/ }).click()
  await page.getByRole('link', { name: 'Verwalten' }).click()
  await expect(page).toHaveURL(new RegExp(`/${poll.id}/verwalten$`))
  await expect(page.getByText(`freigegeben von ${owner.email}`)).toBeVisible()
  await page.goto(`/${poll.id}/verwalten/bearbeiten`)
  await expect(page.getByRole('button', { name: 'Änderungen speichern' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Gemeinsam moderieren' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /löschen/ })).toHaveCount(0)

  // Fremde: 404 auf jedem Reiter; ohne Anmeldung kein "Verwalten" auf der Abstimmungsseite.
  const stranger = await createAccount()
  await page.context().clearCookies()
  await login(page, stranger.email)
  for (const tab of ['', '/stimmlinks', '/bearbeiten']) {
    expect((await page.goto(`/${poll.id}/verwalten${tab}`))!.status()).toBe(404)
  }
  await page.context().clearCookies()
  await page.goto(`/${poll.id}?code=Sommerfest`)
  await page.getByRole('button', { name: /Weiter|Freischalten|Öffnen/ }).click()
  await expect(page.getByRole('heading', { name: poll.title })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Verwalten' })).toHaveCount(0)
})

test('Alt-Abstimmung ohne Konto: Reiter tragen den Verwaltungs-Token, Einstellungen speichern damit', async ({ page }) => {
  const poll = await prisma.poll.create({
    data: { title: `Alt ${unique()}`, voterIdentity: 'LINK', options: { create: [{ label: 'A', position: 0 }, { label: 'B', position: 1 }] } }
  })
  const token = poll.creatorToken
  await page.goto(`/${poll.id}/verwalten?token=${token}`)
  await expect(page.getByText('Alt-Abstimmung ohne Konto')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Stimmlinks', exact: true })).toHaveAttribute('href', `/${poll.id}/verwalten/stimmlinks?token=${token}`)
  await page.getByRole('link', { name: 'Einstellungen' }).click()
  await expect(page).toHaveURL(new RegExp(`/verwalten/bearbeiten\\?token=${token}`))
  await page.getByLabel('Frage / Titel').fill('Alt, umbenannt')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await page.waitForURL(/saved=1/)
  expect(new URL(page.url()).searchParams.get('token')).toBe(token)
  expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).title).toBe('Alt, umbenannt')

  // Ohne Token: nichts.
  expect((await page.goto(`/${poll.id}/verwalten/bearbeiten`))!.status()).toBe(404)
})

test('Konto-Menü: Mein Konto und Abmelden, Konten nur für Creator und Admins', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/meine-abstimmungen')
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  await expect(nav.getByRole('link', { name: 'Abstimmungen' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Konten' })).toBeVisible()
  await page.getByLabel('Konto-Menü').click()
  await page.getByRole('link', { name: 'Mein Konto' }).click()
  await expect(page).toHaveURL(/\/konto$/)
  await logout(page)
  await expect(page.getByRole('link', { name: 'Anmelden' })).toBeVisible()
  await page.goto('/meine-abstimmungen')
  await expect(page).toHaveURL(/\/anmelden/)
})
