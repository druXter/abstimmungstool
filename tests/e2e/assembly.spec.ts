import { createHmac } from 'node:crypto'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { BASE_URL, createAccount, login, prisma, unique, uniqueIp } from './helpers'
import { TEST_RSVP_SECRET } from '../../playwright.config'
import { getRoster, presenceMessages, setRoster } from './rsvp-server'
import { setAgenda, ZEITPLAN_ORIGIN } from './zeitplan-server'

// Sitzungen (Idee L7, docs/KONZEPT-SITZUNG.md): Verknüpfung mit rsvp-app, Beitritt mit Nachweis, schnelle Abstimmungen
// nur für Anwesende (geheim und namentlich), Beschlussfähigkeit, Rednerliste, Rechte. rsvp-app spielen die Tests:
// Nachweise signieren sie selbst, die Anwesenheit liefert das Test-Doppel (tests/e2e/rsvp-server.ts, setRoster).

function sign(payload: object, secret = TEST_RSVP_SECRET): string {
  const part = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${part}.${createHmac('sha256', secret).update(part).digest('base64url')}`
}
const exp = (seconds = 600) => Math.floor(Date.now() / 1000) + seconds
const subject = () => createHmac('sha256', 'x').update(unique()).digest('base64url')
const access = (assemblyId: string, eventId: string, sub: string, name: string, extra: object = {}) =>
  sign({ typ: 'assembly-access', assemblyId, eventId, sub, name, exp: exp(), ...extra })

async function createAssembly(ownerId: string, data: Partial<{ presenceRequired: boolean; quorum: number | null; speakerList: boolean; secretDefault: boolean; rsvpEventId: string | null; selfCheckin: boolean; boardKey: string | null; timelineUrl: string | null }> = {}) {
  return prisma.assembly.create({ data: { title: `Sitzung ${unique()}`, ownerId, rsvpEventId: `ev${unique()}`, ...data } })
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: 'de-DE', extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  return context.newPage()
}

/** Tritt in einem eigenen Browser bei, wie nach "Zur Sitzung" in rsvp-app. */
async function member(browser: Browser, assembly: { id: string; rsvpEventId: string | null }, name: string, sub = subject()) {
  const page = await newPage(browser)
  await page.goto(`/sitzung/${assembly.id}/beitreten?verify=${encodeURIComponent(access(assembly.id, assembly.rsvpEventId!, sub, name))}`)
  await expect(page.getByText(`Angemeldet als ${name}`)).toBeVisible()
  return { page, sub }
}

async function startPoll(admin: Page, assemblyId: string, title: string, options: { secret?: boolean; choices?: string[] } = {}) {
  await admin.goto(`/sitzung/${assemblyId}/verwalten`)
  await admin.getByLabel('Antrag bzw. Frage').fill(title)
  if (options.choices) {
    await admin.getByLabel('Wahl mit eigenen Optionen').check()
    await admin.getByLabel('Optionen der Wahl (eine pro Zeile)').fill(options.choices.join('\n'))
  }
  const secret = admin.getByLabel('Geheim (sonst namentlich)')
  if (options.secret === false) await secret.uncheck()
  if (options.secret === true) await secret.check()
  await admin.getByRole('button', { name: 'Abstimmung starten' }).click()
  await expect(admin.getByText('Abstimmung gestartet')).toBeVisible()
  return prisma.poll.findFirstOrThrow({ where: { assemblyId, title }, include: { options: { orderBy: { position: 'asc' } } } })
}

const ballot = (page: Page, title: string) => page.getByTestId('assembly-ballot').filter({ hasText: title })

/**
 * Felder eines Formulars der Seite samt Aktions-ID - zum Abschicken wie ein Skript (postAs). Lädt die Seite vorher neu:
 * Nach einer Client-Navigation fehlt das serverseitig gerenderte $ACTION_ID-Feld.
 */
async function formFields(page: Page, selector: string): Promise<Record<string, string>> {
  await page.reload()
  return Object.fromEntries(await page.locator(selector).first().evaluate((form: HTMLFormElement) =>
    [...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : ''] as [string, string])))
}

/** Schickt Formularfelder mit den Cookies des Browsers von `page` ab (fremdes Konto, anderes Mitglied). */
async function postAs(page: Page, path: string, fields: Record<string, string>) {
  return page.request.post(path, {
    multipart: fields, maxRedirects: 0,
    headers: { Origin: new URL(BASE_URL).origin, Cookie: (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ') }
  })
}

test('Sitzung anlegen: Funktionen einzeln, erscheint in der Übersicht, Link für rsvp-app', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/meine-abstimmungen')
  await page.getByRole('link', { name: '+ Neue Sitzung' }).click()
  await page.getByLabel('Titel').fill('Mitgliederversammlung')
  await page.getByLabel('Beschlussfähig ab (Anwesende, optional)').fill('11')
  await page.getByLabel('Rednerliste').check()
  await page.getByRole('button', { name: 'Sitzung anlegen' }).click()
  await expect(page.getByText('Sitzung angelegt')).toBeVisible()
  const assembly = await prisma.assembly.findFirstOrThrow({ where: { ownerId: owner.id } })
  expect(assembly).toMatchObject({ title: 'Mitgliederversammlung', presenceRequired: true, quorum: 11, speakerList: true, secretDefault: true, rsvpEventId: null })
  await expect(page.getByLabel('Link der Sitzung')).toHaveValue(`${BASE_URL}/sitzung/${assembly.id}`)

  // Einstellungen einzeln ändern
  await page.getByLabel('Nur Anwesende stimmen ab').uncheck()
  await page.getByLabel('Beschlussfähig ab (Anwesende, optional)').fill('')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible()
  expect(await prisma.assembly.findUniqueOrThrow({ where: { id: assembly.id } })).toMatchObject({ presenceRequired: false, quorum: null, speakerList: true })

  await page.goto('/meine-abstimmungen')
  await expect(page.getByTestId('poll-row').filter({ hasText: 'Mitgliederversammlung' })).toContainText('noch kein Termin verknüpft')
})

test('Verknüpfung: erste Meldung aus rsvp-app gewinnt, andere Termine und falsche Nachrichten nicht, Lösen durch die Verwaltung', async ({ request, page }) => {
  const owner = await createAccount()
  const assembly = await createAssembly(owner.id, { rsvpEventId: null })
  const link = (eventId: string, extra: object = {}, secret?: string) =>
    request.post('/api/rsvp-assembly', { data: sign({ typ: 'assembly-link', assemblyId: assembly.id, eventId, eventTitle: 'MV 2026', exp: exp(240), ...extra }, secret), headers: { 'content-type': 'text/plain' } })

  expect((await link('ev1', {}, 'falsch')).status()).toBe(401)
  expect((await link('ev1', { typ: 'assembly-access' })).status()).toBe(401)
  expect((await link('ev1', { exp: exp(3600) })).status()).toBe(401)
  expect((await link('ev1', { assemblyId: 'gibtsnicht' })).status()).toBe(404)
  expect((await link('ev1')).status()).toBe(200)
  expect(await prisma.assembly.findUniqueOrThrow({ where: { id: assembly.id } })).toMatchObject({ rsvpEventId: 'ev1', rsvpEventTitle: 'MV 2026' })
  expect((await link('ev1')).status()).toBe(200)
  expect((await link('ev2')).status()).toBe(409)

  // Beitritt mit Nachweis eines anderen Termins: abgewiesen, ohne Mitglied
  const stranger = await newPage(page.context().browser()!)
  await stranger.goto(`/sitzung/${assembly.id}/beitreten?verify=${encodeURIComponent(access(assembly.id, 'ev2', subject(), 'Fremd'))}`)
  await expect(stranger.getByText('Diese Sitzung gehört zu einem anderen Termin.')).toBeVisible()
  expect(await prisma.assemblyMember.count({ where: { assemblyId: assembly.id } })).toBe(0)

  // Lösen (Owner): Mitglieder weg, danach verknüpft der nächste Termin
  await member(page.context().browser()!, { id: assembly.id, rsvpEventId: 'ev1' }, 'Anna')
  await login(page, owner.email)
  await page.goto(`/sitzung/${assembly.id}/verwalten`)
  await expect(page.getByTestId('assembly-link')).toContainText('MV 2026')
  await page.getByText('Verknüpfung mit rsvp-app').click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Verknüpfung lösen' }).click()
  await expect(page.getByText('Die Verknüpfung ist gelöst')).toBeVisible()
  expect(await prisma.assemblyMember.count({ where: { assemblyId: assembly.id } })).toBe(0)
  expect((await link('ev2')).status()).toBe(200)
})

test('Beitritt: ungültige, abgelaufene und fremde Nachweise nicht; ein neues Gerät meldet das alte ab', async ({ browser }) => {
  const owner = await createAccount()
  const assembly = await createAssembly(owner.id)
  const other = await createAssembly(owner.id)
  const sub = subject()
  const page = await newPage(browser)
  for (const token of [
    access(other.id, assembly.rsvpEventId!, sub, 'Anna'), access(assembly.id, assembly.rsvpEventId!, sub, 'Anna', { exp: exp(-10) }),
    access(assembly.id, assembly.rsvpEventId!, sub, 'Anna', { exp: exp(3600) }), access(assembly.id, assembly.rsvpEventId!, 'kurz', 'Anna'),
    sign({ typ: 'survey-access', assemblyId: assembly.id, eventId: assembly.rsvpEventId, sub, name: 'Anna', exp: exp() })
  ]) {
    await page.goto(`/sitzung/${assembly.id}/beitreten?verify=${encodeURIComponent(token)}`)
    await expect(page.getByText('Der Link zum Beitreten ist ungültig oder abgelaufen.')).toBeVisible()
  }
  expect(await prisma.assemblyMember.count({ where: { assemblyId: assembly.id } })).toBe(0)

  const first = await member(browser, assembly, 'Anna', sub)
  await expect(first.page).toHaveURL(`${BASE_URL}/sitzung/${assembly.id}`)
  const second = await member(browser, assembly, 'Anna B.', sub)
  expect(await prisma.assemblyMember.findMany({ where: { assemblyId: assembly.id } })).toMatchObject([{ sub, name: 'Anna B.' }])
  await first.page.reload()
  await expect(first.page.getByText('Du bist dieser Sitzung in diesem Browser nicht beigetreten.')).toBeVisible()
  await expect(second.page.getByText('Angemeldet als Anna B.')).toBeVisible()
})

test('Geheim und nur Anwesende: wer nicht eingecheckt ist, stimmt nicht ab; Stimme ohne Namen, nicht doppelt von einem zweiten Gerät', async ({ browser }) => {
  const owner = await createAccount()
  const assembly = await createAssembly(owner.id, { quorum: 2 })
  const anna = { sub: subject() }, ben = { sub: subject() }
  // Vor dem ersten Aufruf festlegen - das Abstimmungstool merkt sich die Antwort 5 Sekunden
  setRoster(assembly.id, { present: [anna.sub], members: 5 })
  const annaPage = (await member(browser, assembly, 'Anna', anna.sub)).page
  const benPage = (await member(browser, assembly, 'Ben', ben.sub)).page
  const admin = await newPage(browser)
  await login(admin, owner.email)
  const poll = await startPoll(admin, assembly.id, 'Antrag 1: Haushalt')
  expect(poll).toMatchObject({ voterIdentity: 'ASSEMBLY', secretBallot: true, resultsVisibility: 'AFTER_CLOSE' })
  expect(poll.options.map(o => o.label)).toEqual(['Ja', 'Nein', 'Enthaltung'])

  // Anna (anwesend) stimmt ab - Stimme ohne Namen, Schlüssel nicht das Mitglied, Teilnahme am Mitglied
  await annaPage.reload()
  await expect(annaPage.getByTestId('quorum')).toContainText('1 anwesend von 5 Zusagen')
  await expect(annaPage.getByTestId('quorum')).toContainText('nicht beschlussfähig')
  await ballot(annaPage, 'Antrag 1').getByLabel('Ja').check()
  await ballot(annaPage, 'Antrag 1').getByRole('button', { name: 'Abstimmen' }).click()
  await expect(ballot(annaPage, 'Antrag 1')).toContainText('Deine Stimme ist abgegeben.')
  const votes = await prisma.vote.findMany({ where: { pollId: poll.id } })
  const annaMember = await prisma.assemblyMember.findFirstOrThrow({ where: { assemblyId: assembly.id, sub: anna.sub } })
  expect(votes).toHaveLength(1)
  expect(votes[0]).toMatchObject({ identityKind: 'ASSEMBLY', voterName: null, optionId: poll.options[0].id })
  expect(votes[0].voterKey).toMatch(/^assembly-secret:/)
  expect(votes[0].voterKey).not.toContain(annaMember.id)
  expect(votes[0].createdAt.getTime()).toBe(0)
  expect(annaMember.votedPolls).toBe(poll.id)
  // Ändern geht
  await ballot(annaPage, 'Antrag 1').getByLabel('Nein').check()
  await ballot(annaPage, 'Antrag 1').getByRole('button', { name: 'Stimme ändern' }).click()
  await expect.poll(async () => (await prisma.vote.findMany({ where: { pollId: poll.id } })).map(v => v.optionId)).toEqual([poll.options[1].id])

  // Ben (nicht eingecheckt): kein Stimmzettel, ein direkt abgeschicktes Formular zählt nicht
  await benPage.reload()
  await expect(ballot(benPage, 'Antrag 1')).toContainText('Abstimmen und Wortmeldungen nur für Anwesende')
  await expect(benPage.getByTestId('member-presence')).toHaveText('nicht eingecheckt')
  const annaBallot = await formFields(annaPage, `form:has(input[name="pollId"][value="${poll.id}"])`)
  expect(Object.keys(annaBallot).some(k => k.startsWith('$ACTION_ID_'))).toBe(true)
  expect((await postAs(benPage, `/sitzung/${assembly.id}`, annaBallot)).status()).toBe(303)
  expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(1)

  // Ben wird eingecheckt: jetzt darf er (die Stimme fragt frisch bei rsvp-app nach)
  setRoster(assembly.id, { present: [anna.sub, ben.sub], members: 5 })
  await expect(async () => {
    await benPage.reload()
    await expect(ballot(benPage, 'Antrag 1').getByRole('button', { name: 'Abstimmen' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  await ballot(benPage, 'Antrag 1').getByLabel('Enthaltung').check()
  await ballot(benPage, 'Antrag 1').getByRole('button', { name: 'Abstimmen' }).click()
  await expect(ballot(benPage, 'Antrag 1')).toContainText('Deine Stimme ist abgegeben.')

  // Anna tritt von einem zweiten Gerät bei: kann weder ändern noch noch einmal abstimmen
  const annaPhone = await member(browser, assembly, 'Anna', anna.sub)
  await expect(ballot(annaPhone.page, 'Antrag 1')).toContainText('Du hast abgestimmt (auf einem anderen Gerät).')
  expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(2)

  // Schließen: Anwesende und Beschlussfähigkeit festgehalten, Ergebnis für Mitglieder sichtbar
  await admin.goto(`/sitzung/${assembly.id}/verwalten`)
  await expect(admin.getByTestId('open-polls')).toContainText('2 abgestimmt von 2 Anwesenden')
  await admin.getByTestId('open-polls').getByRole('button', { name: 'Schließen' }).click()
  await expect(admin.getByTestId('closed-polls')).toContainText('Antrag 1: Haushalt')
  expect(await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).toMatchObject({ assemblyPresent: 2, assemblyQuorumMet: true, closedAt: expect.any(Date) })
  await annaPhone.page.reload()
  await expect(annaPhone.page.getByTestId('assembly-result')).toContainText('2 abgestimmt · 2 anwesend · beschlussfähig')
})

test('Ohne "Nur Anwesende" stimmen alle Mitglieder ab; nicht erreichbares rsvp-app sperrt mit "Nur Anwesende" (fail closed)', async ({ browser }) => {
  const owner = await createAccount()
  const open = await createAssembly(owner.id, { presenceRequired: false })
  const strict = await createAssembly(owner.id)
  setRoster(strict.id, { status: 503, present: [] })
  const admin = await newPage(browser)
  await login(admin, owner.email)
  const openPoll = await startPoll(admin, open.id, 'Offen für alle')
  const strictPoll = await startPoll(admin, strict.id, 'Nur Anwesende')

  const a = await member(browser, open, 'Clara')
  await ballot(a.page, 'Offen für alle').getByLabel('Ja').check()
  await ballot(a.page, 'Offen für alle').getByRole('button', { name: 'Abstimmen' }).click()
  await expect(ballot(a.page, 'Offen für alle')).toContainText('Deine Stimme ist abgegeben.')
  expect(await prisma.vote.count({ where: { pollId: openPoll.id } })).toBe(1)

  const b = await member(browser, strict, 'Dora')
  await expect(ballot(b.page, 'Nur Anwesende')).toContainText('Die Anwesenheit lässt sich gerade nicht prüfen.')
  // Gefälschte Antwort von "rsvp-app" (falsche Signatur) gilt ebenfalls als nicht erreichbar
  setRoster(strict.id, { present: [b.sub], badSignature: true })
  await b.page.waitForTimeout(5500)
  await b.page.reload()
  await expect(ballot(b.page, 'Nur Anwesende')).toContainText('Die Anwesenheit lässt sich gerade nicht prüfen.')
  expect(await prisma.vote.count({ where: { pollId: strictPoll.id } })).toBe(0)
})

test('Namentlich: Name an der Stimme, im Ergebnis und in der CSV; Abstimmungsseite und Verwaltung führen zur Sitzung', async ({ browser }) => {
  const owner = await createAccount()
  const assembly = await createAssembly(owner.id, { secretDefault: false })
  const evaSub = subject()
  setRoster(assembly.id, { present: [evaSub] })
  const eva = await member(browser, assembly, 'Eva', evaSub)
  const admin = await newPage(browser)
  await login(admin, owner.email)
  const poll = await startPoll(admin, assembly.id, 'Wahl Kasse', { choices: ['Eva', 'Finn'] })
  expect(poll.secretBallot).toBe(false)

  await eva.page.goto(`/${poll.id}`)
  await expect(eva.page).toHaveURL(new RegExp(`/sitzung/${assembly.id}`))
  await ballot(eva.page, 'Wahl Kasse').getByLabel('Finn').check()
  await ballot(eva.page, 'Wahl Kasse').getByRole('button', { name: 'Abstimmen' }).click()
  await expect(ballot(eva.page, 'Wahl Kasse')).toContainText('Deine Stimme ist abgegeben.')
  expect(await prisma.vote.findFirstOrThrow({ where: { pollId: poll.id } })).toMatchObject({ voterName: 'Eva' })

  await admin.goto(`/${poll.id}/verwalten`)
  await expect(admin).toHaveURL(`${BASE_URL}/sitzung/${assembly.id}/verwalten`)
  await admin.getByTestId('open-polls').getByRole('button', { name: 'Schließen' }).click()
  await expect(admin.getByTestId('closed-polls')).toContainText('1 Finn (Eva)')
  const csv = await (await admin.request.get(`/sitzung/${assembly.id}/verwalten/export`, { headers: { Cookie: (await admin.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ') } })).text()
  const outsider = await newPage(browser)
  expect((await outsider.request.get(`/sitzung/${assembly.id}/verwalten/export`)).status()).toBe(404)
  expect(csv).toContain('"Wahl Kasse";"namentlich";"Finn";"1";"1";"1";"";"Eva"')
})

test('Beschlüsse fürs Protokoll (rsvp-app): nur geschlossene, Namen nur namentlich, nur für den verknüpften Termin', async ({ browser, request }) => {
  const owner = await createAccount()
  const assembly = await createAssembly(owner.id, { secretDefault: false, quorum: 1 })
  const evaSub = subject()
  setRoster(assembly.id, { present: [evaSub] })
  const eva = await member(browser, assembly, 'Eva', evaSub)
  const admin = await newPage(browser)
  await login(admin, owner.email)
  const named = await startPoll(admin, assembly.id, 'Antrag Satzung')
  await ballot(eva.page, 'Antrag Satzung').getByLabel('Ja').check()
  await ballot(eva.page, 'Antrag Satzung').getByRole('button', { name: 'Abstimmen' }).click()
  await expect(ballot(eva.page, 'Antrag Satzung')).toContainText('Deine Stimme ist abgegeben.')
  await admin.goto(`/sitzung/${assembly.id}/verwalten`)
  await admin.getByTestId('open-polls').getByRole('button', { name: 'Schließen' }).click()
  await expect(admin.getByTestId('closed-polls')).toContainText('Antrag Satzung')
  const secret = await startPoll(admin, assembly.id, 'Wahl Vorstand', { secret: true, choices: ['Eva', 'Finn'] })
  await ballot(eva.page, 'Wahl Vorstand').getByLabel('Eva').check()
  await ballot(eva.page, 'Wahl Vorstand').getByRole('button', { name: 'Abstimmen' }).click()
  await expect(ballot(eva.page, 'Wahl Vorstand')).toContainText('Deine Stimme ist abgegeben.')
  await admin.getByTestId('open-polls').getByRole('button', { name: 'Schließen' }).click()
  await expect(admin.getByTestId('closed-polls')).toContainText('Wahl Vorstand')
  await startPoll(admin, assembly.id, 'Läuft noch')

  const ask = (extra: object = {}, secretKey?: string) => request.post('/api/assembly/decisions', {
    data: sign({ typ: 'assembly-decisions', assemblyId: assembly.id, eventId: assembly.rsvpEventId, exp: exp(240), ...extra }, secretKey), headers: { 'content-type': 'text/plain' }
  })
  expect((await ask({}, 'falsch')).status()).toBe(401)
  expect((await ask({ typ: 'assembly-roster' })).status()).toBe(401)
  expect((await ask({ exp: exp(3600) })).status()).toBe(401)
  expect((await ask({ eventId: 'anderertermin' })).status()).toBe(404)
  const response = await ask()
  expect(response.status()).toBe(200)
  const token = await response.text()
  const [part, signature] = token.split('.')
  expect(createHmac('sha256', TEST_RSVP_SECRET).update(part).digest('base64url')).toBe(signature)
  const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  expect(payload).toMatchObject({ typ: 'assembly-decisions-result', assemblyId: assembly.id, eventId: assembly.rsvpEventId })
  expect(payload.decisions).toHaveLength(2)
  expect(payload.decisions[0]).toMatchObject({ title: 'Antrag Satzung', secret: false, voters: 1, present: 1, quorumMet: true })
  expect(payload.decisions[0].options).toContainEqual({ label: 'Ja', votes: 1, names: ['Eva'] })
  expect(payload.decisions[0].closedAt).toBe((await prisma.poll.findUniqueOrThrow({ where: { id: named.id } })).closedAt!.toISOString())
  expect(payload.decisions[1]).toMatchObject({ title: 'Wahl Vorstand', secret: true, voters: 1 })
  expect(payload.decisions[1].options).toContainEqual({ label: 'Eva', votes: 1 })
  expect(JSON.stringify(payload.decisions[1])).not.toContain('names')
  expect(secret.secretBallot).toBe(true)
})

test('Rednerliste: nur Anwesende melden sich, GO-Antrag zuerst, Leitung ruft auf; ohne Rednerliste nichts', async ({ browser }) => {
  const owner = await createAccount()
  const assembly = await createAssembly(owner.id, { speakerList: true })
  const [ginaSub, hansSub] = [subject(), subject()]
  setRoster(assembly.id, { present: [ginaSub, hansSub] })
  const gina = await member(browser, assembly, 'Gina', ginaSub)
  const hans = await member(browser, assembly, 'Hans', hansSub)
  const ida = await member(browser, assembly, 'Ida')

  await gina.page.reload()
  await gina.page.getByRole('button', { name: '✋ Wortmeldung' }).click()
  await expect(gina.page.getByTestId('speaker-list')).toContainText('Gina - du')
  await hans.page.reload()
  await hans.page.getByRole('button', { name: 'GO-Antrag' }).click()
  await expect(hans.page.getByTestId('speaker-list')).toHaveText(/Hans \(GO-Antrag\)[\s\S]*Gina/)
  await ida.page.reload()
  await ida.page.getByRole('button', { name: '✋ Wortmeldung' }).click()
  await expect(ida.page.getByText('Abstimmen und Wortmeldungen nur für Anwesende')).toBeVisible()
  expect(await prisma.assemblySpeaker.count({ where: { assemblyId: assembly.id } })).toBe(2)

  const admin = await newPage(browser)
  await login(admin, owner.email)
  await admin.goto(`/sitzung/${assembly.id}/verwalten`)
  const queue = admin.getByTestId('speaker-queue')
  await queue.getByRole('listitem').filter({ hasText: 'Hans' }).getByRole('button', { name: 'Aufrufen' }).click()
  await expect(queue.getByRole('listitem').first()).toContainText('🎤 Hans')
  await queue.getByRole('listitem').filter({ hasText: 'Gina' }).getByRole('button', { name: 'Aufrufen' }).click()
  await expect(queue.getByRole('listitem')).toHaveCount(1)
  await expect(queue).toContainText('🎤 Gina')

  // Gina zieht zurück; ohne Rednerliste keine Knöpfe und keine Meldung
  await gina.page.reload()
  await gina.page.getByRole('button', { name: 'Wortmeldung zurückziehen' }).click()
  await expect(gina.page.getByText('Niemand auf der Liste.')).toBeVisible()
  await prisma.assembly.update({ where: { id: assembly.id }, data: { speakerList: false } })
  await hans.page.reload()
  await expect(hans.page.getByRole('button', { name: '✋ Wortmeldung' })).toHaveCount(0)
})

test('Rechte: nur Owner, Admins und Freigaben leiten; Mitglieder und fremde Konten nicht', async ({ browser }) => {
  const owner = await createAccount()
  const assembly = await createAssembly(owner.id)
  const admin = await newPage(browser)
  await login(admin, owner.email)
  await admin.goto(`/sitzung/${assembly.id}/verwalten`)

  const strangerAccount = await createAccount()
  const stranger = await newPage(browser)
  await login(stranger, strangerAccount.email)
  await stranger.goto(`/sitzung/${assembly.id}/verwalten`)
  await expect(stranger.getByText('404')).toBeVisible()
  // Formular der Verwaltung mit dem Konto der fremden Person abschicken: keine Abstimmung
  const fields = { ...(await formFields(admin, 'form:has(#poll-title)')), title: 'Von außen' }
  const post = (page: Page) => postAs(page, `/sitzung/${assembly.id}/verwalten`, fields)
  await post(stranger)
  expect(await prisma.poll.count({ where: { assemblyId: assembly.id } })).toBe(0)

  // Freigegeben: darf starten
  await admin.goto(`/sitzung/${assembly.id}/verwalten`)
  await admin.getByText('Gemeinsam leiten', { exact: true }).click()
  await admin.getByPlaceholder('E-Mail-Adresse eines Kontos').fill(strangerAccount.email)
  await admin.getByRole('button', { name: 'Teilen' }).click()
  await expect(admin.getByText('Freigegeben.')).toBeVisible()
  await post(stranger)
  expect(await prisma.poll.count({ where: { assemblyId: assembly.id } })).toBe(1)
  await stranger.goto(`/sitzung/${assembly.id}/verwalten`)
  await expect(stranger.getByRole('button', { name: 'Verknüpfung lösen' })).toHaveCount(0)
  await expect(stranger.getByRole('button', { name: 'Löschen', exact: true }).last()).toBeVisible()
  await expect(stranger.getByText('Gemeinsam leiten', { exact: true })).toHaveCount(0)
})

// --- Sitzungsleitung, Selbst-Check-in, Tafel, Zeitplan (docs/KONZEPT-SITZUNG.md Abschnitte 6 und 7) -------------------

test('Sitzungsleitung checkt andere ohne Scan ein und aus - Suche, Filter, Meldung bei Fehlern, nur mit Rechten', async ({ browser }) => {
  const owner = await createAccount()
  const assembly = await createAssembly(owner.id, { quorum: 2 })
  const [anna, ben, cleo] = [subject(), subject(), subject()]
  setRoster(assembly.id, { present: [anna], people: [{ sub: anna, name: 'Anna Abgeordnete' }, { sub: ben, name: 'Ben Beisitz' }, { sub: cleo, name: 'Cleo Chair' }] })
  const benPhone = await member(browser, assembly, 'Ben Beisitz', ben)
  const admin = await newPage(browser)
  await login(admin, owner.email)
  await admin.goto(`/sitzung/${assembly.id}/verwalten`)

  const list = admin.getByTestId('attendance')
  await expect(list.locator('li')).toHaveCount(3)
  await expect(list.locator('li').filter({ hasText: 'Ben Beisitz' })).toContainText('nicht da · 📱 beigetreten')
  await expect(list.locator('li').filter({ hasText: 'Ben Beisitz' })).toHaveAttribute('data-present', 'false')
  await expect(admin.getByTestId('stat-quorum')).toContainText('nein')

  // Suche und Filter
  await admin.getByPlaceholder('Name suchen').fill('cle')
  await expect(list.locator('li')).toHaveCount(1)
  await admin.getByPlaceholder('Name suchen').fill('')
  await admin.getByRole('button', { name: 'Da (1)' }).click()
  await expect(list.locator('li')).toHaveCount(1)
  await admin.getByRole('button', { name: 'Alle (3)' }).click()

  await admin.getByRole('button', { name: 'Ben Beisitz einchecken' }).click()
  await expect(list.locator('li').filter({ hasText: 'Ben Beisitz' })).toHaveAttribute('data-present', 'true')
  await expect(admin.getByTestId('stat-quorum')).toContainText('ja')
  expect(presenceMessages(assembly.id).at(-1)).toMatchObject({ typ: 'assembly-presence', assemblyId: assembly.id, eventId: assembly.rsvpEventId, sub: ben, present: true })
  await expect(benPhone.page.getByTestId('member-presence')).toHaveText('anwesend')

  await admin.getByRole('button', { name: 'Anna Abgeordnete auschecken (geht)' }).click()
  await expect(list.locator('li').filter({ hasText: 'Anna Abgeordnete' })).toContainText('gegangen')
  await expect(admin.getByRole('button', { name: 'Anna Abgeordnete einchecken' })).toHaveText('Kommt wieder')
  expect(getRoster(assembly.id)!.present).toEqual([ben])

  // rsvp-app lehnt ab bzw. ist nicht erreichbar: Meldung, nichts geändert
  setRoster(assembly.id, { ...getRoster(assembly.id)!, presenceStatus: 503 })
  await admin.getByRole('button', { name: 'Cleo Chair einchecken' }).click()
  await expect(admin.getByText('rsvp-app ist gerade nicht erreichbar - nichts geändert.')).toBeVisible()
  expect(getRoster(assembly.id)!.present).toEqual([ben])

  // Fremdes Konto und Mitglied können das Formular nicht nachspielen
  setRoster(assembly.id, { ...getRoster(assembly.id)!, presenceStatus: undefined })
  const fields = { ...(await formFields(admin, 'form:has(input[name="sub"][value="' + cleo + '"])')) }
  const stranger = await newPage(browser)
  await login(stranger, (await createAccount()).email)
  const before = presenceMessages(assembly.id).length
  await postAs(stranger, `/sitzung/${assembly.id}/verwalten`, fields)
  await postAs(benPhone.page, `/sitzung/${assembly.id}/verwalten`, fields)
  expect(presenceMessages(assembly.id)).toHaveLength(before)
  await postAs(admin, `/sitzung/${assembly.id}/verwalten`, fields)
  expect(getRoster(assembly.id)!.present).toEqual([ben, cleo])
})

test('Selbst ein- und auschecken in der Mitgliederansicht - nur mit Schalter, danach abstimmen', async ({ browser }) => {
  const owner = await createAccount()
  const assembly = await createAssembly(owner.id, { speakerList: true })
  const dora = subject()
  setRoster(assembly.id, { present: [], people: [{ sub: dora, name: 'Dora' }] })
  const phone = await member(browser, assembly, 'Dora', dora)
  // Ohne Schalter kein Knopf - und ein nachgespieltes Formular wirkt nicht
  await expect(phone.page.getByRole('button', { name: 'Einchecken' })).toHaveCount(0)

  await prisma.assembly.update({ where: { id: assembly.id }, data: { selfCheckin: true } })
  await phone.page.reload()
  const fields = await formFields(phone.page, 'form:has(input[name="present"])')
  await prisma.assembly.update({ where: { id: assembly.id }, data: { selfCheckin: false } })
  await postAs(phone.page, `/sitzung/${assembly.id}`, fields)
  expect(presenceMessages(assembly.id)).toHaveLength(0)
  await prisma.assembly.update({ where: { id: assembly.id }, data: { selfCheckin: true } })

  const admin = await newPage(browser)
  await login(admin, owner.email)
  await startPoll(admin, assembly.id, 'Antrag Selbst')
  await phone.page.reload()
  await expect(ballot(phone.page, 'Antrag Selbst')).toContainText('Checke dich oben unter „Anwesenheit“ ein.')

  await phone.page.getByRole('button', { name: 'Einchecken' }).click()
  await expect(phone.page.getByTestId('member-presence')).toHaveText('anwesend')
  expect(presenceMessages(assembly.id).at(-1)).toMatchObject({ sub: dora, present: true })
  await ballot(phone.page, 'Antrag Selbst').getByLabel('Ja').check()
  await ballot(phone.page, 'Antrag Selbst').getByRole('button', { name: 'Abstimmen' }).click()
  await expect(ballot(phone.page, 'Antrag Selbst')).toContainText('Deine Stimme ist abgegeben.')

  await phone.page.getByRole('button', { name: 'Ich gehe (auschecken)' }).click()
  await expect(phone.page.getByTestId('member-presence')).toHaveText('nicht eingecheckt')
  expect(presenceMessages(assembly.id).at(-1)).toMatchObject({ sub: dora, present: false })
  await phone.page.getByRole('button', { name: '✋ Wortmeldung' }).click()
  await expect(phone.page.getByText('Checke dich oben unter „Anwesenheit“ ein.').first()).toBeVisible()
  expect(await prisma.assemblySpeaker.count({ where: { assemblyId: assembly.id } })).toBe(0)

  // Gegen ein anderes Mitglied wirkt das Formular nicht: rsvp-app bekommt immer das eigene Pseudonym
  await postAs(phone.page, `/sitzung/${assembly.id}`, { ...fields, sub: subject() })
  expect(presenceMessages(assembly.id).at(-1)).toMatchObject({ sub: dora })
})

test('Tafel: nur mit Link, laufende Abstimmung ohne Zwischenstand, Ergebnis mit Namen nur bei namentlich, Rednerliste, Tagesordnung', async ({ browser, request }) => {
  const owner = await createAccount()
  const slug = `mv-${unique().toLowerCase().replace(/[^a-z0-9]/g, '')}`
  const assembly = await createAssembly(owner.id, { secretDefault: false, quorum: 2, speakerList: true, boardKey: `tafel${unique().replace(/[^a-zA-Z0-9]/g, '')}`, timelineUrl: `${ZEITPLAN_ORIGIN}/${slug}?k=geheimertafelkey` })
  setAgenda(slug, {
    key: 'geheimertafelkey', announcement: 'Pause bis 15 Uhr',
    items: [
      { title: 'TOP 1: Begrüßung', status: 'past', start: new Date(Date.now() - 3_600_000).toISOString() },
      { title: 'TOP 2: Haushalt', status: 'now', start: new Date(Date.now() - 600_000).toISOString() },
      { title: 'TOP 3: Wahlen', status: 'upcoming', start: new Date(Date.now() + 1_800_000).toISOString() }
    ]
  })
  const [eva, finn] = [subject(), subject()]
  setRoster(assembly.id, { present: [eva, finn] })
  const evaPhone = await member(browser, assembly, 'Eva', eva)
  const finnPhone = await member(browser, assembly, 'Finn', finn)
  const admin = await newPage(browser)
  await login(admin, owner.email)

  // Ohne oder mit falschem Schlüssel: nichts
  for (const k of ['', '?k=falsch', `?k=${assembly.boardKey}x`]) expect((await request.get(`/sitzung/${assembly.id}/tafel${k}`)).status()).toBe(404)
  const boardResponse = await request.get(`/sitzung/${assembly.id}/tafel?k=${assembly.boardKey}`)
  expect(boardResponse.status()).toBe(200)
  expect(boardResponse.headers()['referrer-policy']).toBe('no-referrer')
  expect(boardResponse.headers()['x-robots-tag']).toBe('noindex, nofollow')

  const board = await newPage(browser)
  await board.goto(`/sitzung/${assembly.id}/tafel?k=${assembly.boardKey}`)
  await expect(board.getByTestId('board-agenda')).toContainText('TOP 2: Haushalt')
  await expect(board.getByTestId('board-agenda')).not.toContainText('TOP 1: Begrüßung')
  await expect(board.getByText('📣 Pause bis 15 Uhr')).toBeVisible()
  await expect(board.getByTestId('board-quorum')).toContainText('2 anwesend · beschlussfähig (ab 2)')

  // Laufende Abstimmung: Zahl der Stimmen, kein Zwischenstand; aktualisiert sich selbst
  const poll = await startPoll(admin, assembly.id, 'Antrag Tafel')
  await expect(board.getByTestId('board-open')).toContainText('Antrag Tafel')
  await ballot(evaPhone.page, 'Antrag Tafel').getByLabel('Ja').check()
  await ballot(evaPhone.page, 'Antrag Tafel').getByRole('button', { name: 'Abstimmen' }).click()
  await ballot(finnPhone.page, 'Antrag Tafel').getByLabel('Nein').check()
  await ballot(finnPhone.page, 'Antrag Tafel').getByRole('button', { name: 'Abstimmen' }).click()
  await expect(board.getByTestId('board-open')).toContainText('2 von 2 abgestimmt · namentlich', { timeout: 15_000 })
  await expect(board.getByTestId('board-result')).toHaveCount(0)

  // Geschlossen: Ergebnis mit Namen (namentlich)
  await admin.getByTestId('open-polls').getByRole('button', { name: 'Schließen' }).click()
  await expect(board.getByTestId('board-result')).toContainText('Antrag Tafel')
  await expect(board.getByTestId('board-result')).toContainText('Eva')
  await expect(board.getByTestId('board-result')).toContainText('Finn')
  expect(poll.secretBallot).toBe(false)

  // Geheim: keine Namen; die namentliche rückt zu den früheren Ergebnissen
  await startPoll(admin, assembly.id, 'Wahl geheim', { secret: true })
  await ballot(evaPhone.page, 'Wahl geheim').getByLabel('Ja').check()
  await ballot(evaPhone.page, 'Wahl geheim').getByRole('button', { name: 'Abstimmen' }).click()
  await admin.goto(`/sitzung/${assembly.id}/verwalten`)
  await admin.getByTestId('open-polls').getByRole('button', { name: 'Schließen' }).click()
  await expect(board.getByTestId('board-result')).toContainText('Wahl geheim')
  await expect(board.getByTestId('board-result')).not.toContainText('Eva')
  await expect(board.getByTestId('board-earlier')).toContainText('Antrag Tafel: Ja 1 · Nein 1 · Enthaltung 0')

  // Rednerliste
  await finnPhone.page.getByRole('button', { name: '✋ Wortmeldung' }).click()
  await expect(board.getByTestId('board-speakers')).toContainText('Finn')

  // Neuer Link: alter gilt nicht mehr; abgeschaltet: keiner
  await admin.getByText('Tafel', { exact: true }).click()
  await admin.getByRole('button', { name: 'Neuen Link erzeugen' }).click()
  await expect(admin.getByText('Neuer Tafel-Link erzeugt')).toBeVisible()
  expect((await request.get(`/sitzung/${assembly.id}/tafel?k=${assembly.boardKey}`)).status()).toBe(404)
  const renewed = (await prisma.assembly.findUniqueOrThrow({ where: { id: assembly.id } })).boardKey
  await expect(admin.getByLabel('Tafel-Link', { exact: true })).toHaveValue(`${BASE_URL}/sitzung/${assembly.id}/tafel?k=${renewed}`)
  await admin.getByRole('button', { name: 'Tafel abschalten' }).click()
  await expect(admin.getByText('Die Tafel ist abgeschaltet.')).toBeVisible()
  expect((await request.get(`/sitzung/${assembly.id}/tafel?k=${renewed}`)).status()).toBe(404)
})

test('Zeitplan: Links nur aus dem eingerichteten Zeitplan, Tagesordnung für Mitglieder, Live-Steuerung eingebettet', async ({ browser }) => {
  const owner = await createAccount()
  const assembly = await createAssembly(owner.id)
  const slug = `mv-${unique().toLowerCase().replace(/[^a-z0-9]/g, '')}`
  setAgenda(slug, { items: [{ title: 'TOP 1: Bericht', status: 'now', start: new Date().toISOString(), delayMin: 5 }, { title: 'TOP 2: Sonstiges', status: 'upcoming', start: new Date(Date.now() + 3_600_000).toISOString() }] })
  setRoster(assembly.id, { present: [] })
  const admin = await newPage(browser)
  await login(admin, owner.email)
  const save = async (timelineUrl: string, timelineLiveUrl = '') => {
    // Jedes Mal frisch geladen: Die Meldung des vorigen Versuchs darf nicht als Ergebnis dieses Versuchs gelten.
    await admin.goto(`/sitzung/${assembly.id}/verwalten`)
    await admin.getByText('Zeitplan', { exact: true }).click()
    await admin.getByLabel('Gästeansicht oder Tafel-Link (Tagesordnung)').fill(timelineUrl)
    await admin.getByLabel('Live-Steuerung').fill(timelineLiveUrl)
    await admin.getByRole('button', { name: 'Zeitplan speichern' }).click()
  }
  // Fremde Adresse, falscher Pfad, ungültiger Schlüssel: abgelehnt
  for (const [url, live, message] of [
    [`https://zeitplan.example.test/${slug}`, '', 'Tagesordnung: Erwartet wird'],
    [`${ZEITPLAN_ORIGIN}/admin/events/x`, '', 'Tagesordnung: Erwartet wird'],
    [`${ZEITPLAN_ORIGIN}/${slug}/tafel?k=<script>`, '', 'Tagesordnung: Erwartet wird'],
    [`${ZEITPLAN_ORIGIN}/${slug}`, `${ZEITPLAN_ORIGIN}/admin/events/abc/plan`, 'Live-Steuerung: Erwartet wird'],
    [`${ZEITPLAN_ORIGIN}/${slug}`, `https://zeitplan.example.test/admin/events/abc/live`, 'Live-Steuerung: Erwartet wird']
  ]) {
    await save(url, live)
    await expect(admin.getByText(message)).toBeVisible()
  }
  expect((await prisma.assembly.findUniqueOrThrow({ where: { id: assembly.id } })).timelineUrl).toBeNull()

  // Tafel-Link wird zur Gästeansicht mit Schlüssel, Live-Steuerung normalisiert
  await save(`${ZEITPLAN_ORIGIN}/${slug}/tafel?k=abcdefgh12345678&x=1`, `${ZEITPLAN_ORIGIN}/admin/events/evt123/live/`)
  await expect(admin.getByText('Zeitplan gespeichert.')).toBeVisible()
  const stored = await prisma.assembly.findUniqueOrThrow({ where: { id: assembly.id } })
  expect(stored.timelineUrl).toBe(`${ZEITPLAN_ORIGIN}/${slug}?k=abcdefgh12345678`)
  expect(stored.timelineLiveUrl).toBe(`${ZEITPLAN_ORIGIN}/admin/events/evt123/live`)
  await expect(admin.getByTestId('timeline-live')).toHaveAttribute('src', `${ZEITPLAN_ORIGIN}/admin/events/evt123/live`)

  // Mitglieder sehen die Tagesordnung mit dem laufenden Punkt
  const phone = await member(browser, assembly, 'Gina')
  await expect(phone.page.getByTestId('agenda-current')).toHaveText('Jetzt: TOP 1: Bericht')
  await expect(phone.page.getByTestId('agenda')).toContainText('TOP 2: Sonstiges')
  await expect(phone.page.getByTestId('agenda')).toContainText('+5 Min')

  // Ohne Live-Steuerung zeigt die Sitzungsleitung die Tagesordnung selbst; Zeitplan nicht erreichbar: Hinweis, kein Fehler
  await save(`${ZEITPLAN_ORIGIN}/${slug}`)
  await expect(admin.getByTestId('agenda')).toContainText('TOP 1: Bericht')
  setAgenda(slug, { status: 503, items: [] })
  await new Promise(resolve => setTimeout(resolve, 5_500))
  await phone.page.reload()
  await expect(phone.page.getByTestId('agenda')).toHaveCount(0)
  await expect(phone.page.getByText('Angemeldet als Gina')).toBeVisible()
})

