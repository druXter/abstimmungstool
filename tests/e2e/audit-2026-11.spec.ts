import { execFileSync } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { BASE_URL, createAccount, createPoll, login, openSection, prisma, unique, uniqueEmail, uniqueIp } from './helpers'
import { TEST_CRON_SECRET, TEST_RSVP_SECRET } from '../../playwright.config'
import { resultMessages, RSVP_ORIGIN, setRoster, setRsvpScenario } from './rsvp-server'
import { waitForMail } from './mail-server'
import { AI_FILE } from './ai-server'

// Sicherheitsprüfung November 2026 (docs/AUDIT-2026-11.md), Rechte, Sitzungen und Routen. Jeder Test beginnt mit einer
// Gegenprobe (der erlaubte Fall geht durch) und scheitert erst an der Zeile, die den Fund zeigt. Logik:
// tests/unit/audit-2026-11.test.ts. rsvp-app, die anderen Tools der Suite, Mail und OpenAI spielen die Test-Doppel.

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/** Nachricht von rsvp-app im Format der Suite; `aud` (wir), `iat` und `exp` ergänzt. */
function sign(payload: object): string {
  const iat = Math.floor(Date.now() / 1000)
  const part = Buffer.from(JSON.stringify({ aud: new URL(BASE_URL).origin, iat, exp: iat + 600, ...payload })).toString('base64url')
  return `${part}.${createHmac('sha256', TEST_RSVP_SECRET).update(part).digest('base64url')}`
}
const subject = () => createHmac('sha256', 'x').update(unique()).digest('base64url')

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: 'de-DE', extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  return context.newPage()
}

async function addVote(pollId: string, optionId: string, voterKey: string, voterName: string | null = null, identityKind: 'COOKIE' | 'EMAIL' | 'LINK' | 'RSVP' | 'ACCOUNT' = 'COOKIE') {
  await prisma.vote.create({ data: { pollId, optionId, identityKind, voterKey, voterName } })
}

// ---------------------------------------------------------------------------------------------------------------------
// Kopplung mit rsvp-app

test('V-01 Bindung an rsvp-app: die Meldung eines fremden Termins bindet keine Abstimmung, die gar nicht über rsvp-app läuft - ihr Ergebnis geht nicht dorthin', async ({ request }) => {
  const owner = await createAccount()
  const past = new Date(Date.now() - 60_000)
  const attendance = (pollId: string, eventId: string) => request.post('/api/rsvp-webhook', {
    headers: { 'content-type': 'text/plain' },
    data: sign({ typ: 'poll-attendance', email: uniqueEmail('gast'), pollId, eventId, attending: true })
  })
  const closeExpired = async () => expect((await request.get(`/api/cron/close-expired-polls?secret=${TEST_CRON_SECRET}`)).ok()).toBe(true)

  // Gegenprobe: Abstimmung "nur über rsvp-app", an den Termin gebunden - er meldet eine Zusage und bekommt das Ergebnis.
  const linked = await createPoll(owner.id, { voterIdentity: 'RSVP', rsvpEventId: 'event-eigen', closesAt: past })
  await addVote(linked.id, linked.options[0].id, `rsvp:${uniqueEmail('gast')}`, null, 'RSVP')
  expect((await attendance(linked.id, 'event-eigen')).ok()).toBe(true)
  await closeExpired()
  expect(resultMessages(linked.id)).toEqual([expect.objectContaining({ eventId: 'event-eigen', winners: [{ label: 'Pizza', votes: 1 }] })])

  // Fund: Abstimmung "offen für alle" mit Zugangscode, mit rsvp-app hat sie nichts zu tun. Die Verwaltung eines
  // beliebigen Termins in rsvp-app trägt ihren Link ein (frei wählbar), eine Zusage dort löst die Meldung aus.
  const foreign = await createPoll(owner.id, { title: `Vorstandswahl ${unique()}`, voterIdentity: 'COOKIE', accessCode: 'nur-fuer-mitglieder', closesAt: past })
  await addVote(foreign.id, foreign.options[1].id, `cookie:${unique()}`)
  expect((await attendance(foreign.id, 'event-fremd')).ok()).toBe(true)
  expect((await prisma.poll.findUniqueOrThrow({ where: { id: foreign.id } })).rsvpEventId).toBeNull()
  await closeExpired()
  // Titel und Gewinner einer Abstimmung hinter Zugangscode gingen an den fremden Termin und stünden dort auf der Seite.
  expect(resultMessages(foreign.id)).toEqual([])
})

test('V-01 b Bindung: ein Termin, der den Link speichert, bindet nur, wenn er dem verknüpften Konto der Besitzerin gehört - sonst bestätigt sie ihn', async ({ page, request }) => {
  const owner = await createAccount()
  const rsvpSubject = `rsvp-${unique()}`
  await prisma.externalIdentity.create({ data: { issuer: RSVP_ORIGIN, subject: rsvpSubject, userId: owner.id } })
  const announce = (pollId: string, eventId: string, eventTitle: string, eventOwner: { rsvpUserId: string | null; toolUserId: string | null }) =>
    request.post('/api/rsvp-poll-link', {
      headers: { 'content-type': 'text/plain' },
      data: sign({ typ: 'poll-link', pollId, eventId, eventTitle, owner: eventOwner, exp: Math.floor(Date.now() / 1000) + 240 })
    })
  const stranger = { rsvpUserId: 'rsvp-fremd', toolUserId: null }
  const state = async (pollId: string) => prisma.poll.findUniqueOrThrow({ where: { id: pollId }, select: { rsvpEventId: true, rsvpEventTitle: true } })

  // Gegenprobe: Termin des verknüpften Kontos (über seine rsvp-app-Konto-ID oder unsere Konto-ID) bindet sofort
  const own = await createPoll(owner.id, { voterIdentity: 'RSVP' })
  expect(await (await announce(own.id, 'ev-eigen', 'Sommerfest', { rsvpUserId: rsvpSubject, toolUserId: null })).json()).toMatchObject({ state: 'linked' })
  expect(await state(own.id)).toEqual({ rsvpEventId: 'ev-eigen', rsvpEventTitle: 'Sommerfest' })
  const own2 = await createPoll(owner.id, { voterIdentity: 'RSVP' })
  expect(await (await announce(own2.id, 'ev-eigen2', 'Grillen', { rsvpUserId: 'egal', toolUserId: owner.id })).json()).toMatchObject({ state: 'linked' })

  // Fund: Ein fremder Termin speichert den Link zuerst - er wird nur vorgemerkt, abstimmen kann über ihn niemand
  const poll = await createPoll(owner.id, { voterIdentity: 'RSVP' })
  expect(await (await announce(poll.id, 'ev-fremd', 'Sommerfest', stranger)).json()).toMatchObject({ state: 'pending' })
  expect((await state(poll.id)).rsvpEventId).toBeNull()
  // ... auch ein danach gemeldeter eigener Termin bindet (der fremde verhindert es nicht)
  expect(await (await announce(poll.id, 'ev-eigen3', 'Sommerfest', { rsvpUserId: rsvpSubject, toolUserId: null })).json()).toMatchObject({ state: 'linked' })
  // Gebunden: ein weiterer fremder Termin ändert nichts, der gebundene bekommt nur den neuen Titel
  expect(await (await announce(poll.id, 'ev-fremd2', 'Sommerfest', stranger)).json()).toMatchObject({ state: 'pending' })
  expect(await (await announce(poll.id, 'ev-eigen3', 'Sommerfest 2027', stranger)).json()).toMatchObject({ state: 'linked' })
  expect(await state(poll.id)).toEqual({ rsvpEventId: 'ev-eigen3', rsvpEventTitle: 'Sommerfest 2027' })

  // Abstimmung in einem anderen Modus: nichts vorgemerkt, nichts gebunden
  const cookie = await createPoll(owner.id, { voterIdentity: 'COOKIE' })
  expect(await (await announce(cookie.id, 'ev-eigen', 'Sommerfest', { rsvpUserId: rsvpSubject, toolUserId: null })).json()).toMatchObject({ state: 'not-needed' })
  expect(await prisma.rsvpEventCandidate.count({ where: { pollId: cookie.id } })).toBe(0)

  // Länger als 5 Minuten gültig: abgelehnt
  const bad = await request.post('/api/rsvp-poll-link', { headers: { 'content-type': 'text/plain' }, data: sign({ typ: 'poll-link', pollId: poll.id, eventId: 'x', eventTitle: 'x', owner: stranger }) })
  expect(bad.status()).toBe(401)

  // Fremder Termin: Die Besitzerin sieht Titel und Kennung, verwirft ihn - abstimmen kann weiter niemand
  const pending = await createPoll(owner.id, { voterIdentity: 'RSVP' })
  await announce(pending.id, 'ev-fremd', 'Sommerfest', stranger)
  await login(page, owner.email)
  await page.goto(`/${pending.id}/verwalten`)
  const candidates = page.getByTestId('rsvp-candidates')
  await expect(candidates).toContainText('Sommerfest')
  await expect(candidates).toContainText('ev-fremd')
  await candidates.getByRole('button', { name: 'Verwerfen' }).click()
  await expect(page.getByTestId('rsvp-candidates')).toHaveCount(0)
  expect((await state(pending.id)).rsvpEventId).toBeNull()
})

test('V-01 b Bindung lösen: die Besitzerin kann die Stimmen eines falsch gebundenen Termins mit entfernen', async ({ page }) => {
  const owner = await createAccount()
  const boundPoll = async () => {
    const poll = await createPoll(owner.id, { voterIdentity: 'RSVP', rsvpEventId: 'event-falsch' })
    await addVote(poll.id, poll.options[0].id, `rsvp:${uniqueEmail('gast')}`, null, 'RSVP')
    return poll
  }
  const unlink = async (pollId: string, deleteVotes: boolean) => {
    await page.goto(`/${pollId}/verwalten`)
    if (deleteVotes) await page.getByLabel(/Stimmen über diesen Termin entfernen/).check()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Verknüpfung lösen' }).click()
    await expect(page.getByText('Die Verknüpfung ist gelöst')).toBeVisible()
  }
  await login(page, owner.email)

  // Gegenprobe: Lösen allein lässt die Stimmen stehen.
  const kept = await boundPoll()
  await unlink(kept.id, false)
  expect(await prisma.vote.count({ where: { pollId: kept.id } })).toBe(1)

  // Mit "Stimmen entfernen" zählen die Gäste des falschen Termins nicht weiter.
  const dropped = await boundPoll()
  await unlink(dropped.id, true)
  expect(await prisma.vote.count({ where: { pollId: dropped.id } })).toBe(0)
})

test('V-02 Terminübergabe: der Link eines Termins, an den die Abstimmung nicht gebunden ist, geht nicht an die Abstimmenden und steht nicht auf der Abstimmungsseite', async ({ page, browser }) => {
  const owner = await prisma.user.update({ where: { id: (await createAccount()).id }, data: { email: uniqueEmail('owner') } })
  const dates = ['2026-12-07T19:00', '2026-12-08T18:30']
  const datePoll = async () => {
    const poll = await createPoll(owner.id, { optionKind: 'DATETIME', confirmDate: true, voterIdentity: 'EMAIL', rsvpEventId: 'ev-eigen' }, ['Mo., 07.12.2026, 19:00 Uhr', 'Di., 08.12.2026, 18:30 Uhr'])
    for (const [i, option] of poll.options.entries()) await prisma.pollOption.update({ where: { id: option.id }, data: { startsAt: new Date(`${dates[i]}:00+01:00`) } })
    const voter = uniqueEmail('waehlerin')
    await addVote(poll.id, poll.options[0].id, `email:${voter}`, voter, 'EMAIL')
    return { poll, voter }
  }
  const confirm = async (pollId: string) => {
    await page.goto(`/${pollId}/verwalten`)
    await page.getByRole('button', { name: 'Jetzt schließen' }).click()
    await expect(page.getByTestId('stat-status')).toContainText('geschlossen')
    await page.reload()
    await page.getByRole('button', { name: 'Termin bestätigen' }).click()
    await page.waitForURL(/festgelegt=1/)
  }
  await login(page, owner.email)
  const visitor = await newPage(browser)

  // Gegenprobe: Der gebundene Termin übernimmt das Datum - sein Link steht in der Mail und auf der Seite.
  const own = await datePoll()
  const ownUrl = `${RSVP_ORIGIN}/eigenes-fest-${unique()}`
  setRsvpScenario({ events: [{ id: 'ev-eigen', title: 'Sommerfest', datePending: true }], updated: [{ id: 'ev-eigen', title: 'Sommerfest', url: ownUrl }] })
  await confirm(own.poll.id)
  expect(await waitForMail(own.voter)).toContain(ownUrl)
  await visitor.goto(`/${own.poll.id}`)
  await expect(visitor.locator(`a[href="${ownUrl}"]`)).toBeVisible()

  // Fund: Ein anderer Termin in rsvp-app (fremder Mandant, gleicher Titel) zeigt auf dieselbe Abstimmung und hat
  // "Datum noch offen". rsvp-app gibt ihm das Datum und meldet ihn als übernommen - zugestimmt hat nur dessen Verwaltung.
  const hijacked = await datePoll()
  const foreignUrl = `${RSVP_ORIGIN}/fremdes-fest-${unique()}`
  setRsvpScenario({ events: [{ id: 'ev-fremd', title: 'Sommerfest', datePending: true }], updated: [{ id: 'ev-fremd', title: 'Sommerfest', url: foreignUrl }] })
  await confirm(hijacked.poll.id)
  const mail = await waitForMail(hijacked.voter)
  expect(mail).toContain('Termin steht fest')
  // "Zur Veranstaltung (Zu-/Absage)" führte alle Abstimmenden zum fremden Termin - dort geben sie Name, Adresse, Allergien an.
  expect(mail).not.toContain(foreignUrl)
  await visitor.goto(`/${hijacked.poll.id}`)
  await expect(visitor.getByText('Termin steht fest')).toBeVisible()
  await expect(visitor.locator(`a[href="${foreignUrl}"]`)).toHaveCount(0)
})

// ---------------------------------------------------------------------------------------------------------------------
// Sitzungen

async function joinAssembly(browser: Browser, assembly: { id: string; rsvpEventId: string | null }, name: string, sub: string) {
  const page = await newPage(browser)
  const token = sign({ typ: 'assembly-access', assemblyId: assembly.id, eventId: assembly.rsvpEventId, sub, name })
  await page.goto(`/sitzung/${assembly.id}/beitreten?verify=${encodeURIComponent(token)}`)
  await expect(page.getByText(`Angemeldet als ${name}`)).toBeVisible()
  return page
}

const ballot = (page: Page, title: string) => page.getByTestId('assembly-ballot').filter({ hasText: title })

async function assemblyPoll(assembly: { id: string; ownerId: string }, title: string, data: { secretBallot?: boolean; assemblyMajority?: string } = {}) {
  const poll = await prisma.poll.create({
    data: {
      title, ownerId: assembly.ownerId, assemblyId: assembly.id, voterIdentity: 'ASSEMBLY', secretBallot: false, showVoterNames: true, resultsVisibility: 'AFTER_CLOSE', ...data,
      options: { create: ['Ja', 'Nein', 'Enthaltung'].map((label, position) => ({ label, position })) }
    }
  })
  await prisma.assembly.update({ where: { id: assembly.id }, data: { version: { increment: 1 } } })
  return poll
}

test('V-04 Schließen: eine Stimme, die erst nach dem Schließen gespeichert wird, zählt nicht', async ({ browser }) => {
  const owner = await createAccount()
  const assembly = await prisma.assembly.create({ data: { title: `Sitzung ${unique()}`, ownerId: owner.id, rsvpEventId: `ev${unique()}`, presenceRequired: true } })
  const [anna, ben] = [subject(), subject()]
  setRoster(assembly.id, { present: [anna, ben] })
  const annaPage = await joinAssembly(browser, assembly, 'Anna', anna)
  const benPage = await joinAssembly(browser, assembly, 'Ben', ben)

  // Gegenprobe: Stimme vor dem Schließen zählt.
  const first = await assemblyPoll(assembly, 'Antrag eins')
  await annaPage.reload()
  await ballot(annaPage, 'Antrag eins').getByLabel('Ja').check()
  await ballot(annaPage, 'Antrag eins').getByRole('button', { name: 'Abstimmen' }).click()
  await expect(ballot(annaPage, 'Antrag eins')).toContainText('Deine Stimme ist abgegeben.')
  await prisma.poll.update({ where: { id: first.id }, data: { closedAt: new Date() } })
  expect(await prisma.vote.count({ where: { pollId: first.id } })).toBe(1)

  // Fund: Beim Abstimmen fragt das Tool rsvp-app nach der Anwesenheit (bis zu 4 Sekunden). In dieser Zeit schließt die
  // Leitung und liest das Ergebnis vor - die Stimme wird danach trotzdem gespeichert und ändert das Ergebnis.
  const second = await assemblyPoll(assembly, 'Antrag zwei')
  await benPage.reload()
  await ballot(benPage, 'Antrag zwei').getByLabel('Nein').check()
  setRoster(assembly.id, { present: [anna, ben], delayMs: 2500 })
  await ballot(benPage, 'Antrag zwei').getByRole('button', { name: 'Abstimmen' }).click()
  await benPage.waitForTimeout(500)
  // Wie closeAssemblyPoll (bedingtes Update) - direkt, damit der Test nicht selbst auf die langsame Antwort wartet.
  await prisma.poll.updateMany({ where: { id: second.id, closedAt: null }, data: { closedAt: new Date() } })
  expect(await prisma.vote.count({ where: { pollId: second.id } })).toBe(0)
  await benPage.waitForTimeout(4000)
  setRoster(assembly.id, { present: [anna, ben] })
  expect(await prisma.vote.count({ where: { pollId: second.id } })).toBe(0)
})

test('V-07 Beschlussfähigkeit: lässt sie sich beim Schließen nicht prüfen, gilt ein Antrag nicht als angenommen', async ({ browser }) => {
  const owner = await createAccount()
  const assembly = await prisma.assembly.create({ data: { title: `Sitzung ${unique()}`, ownerId: owner.id, rsvpEventId: `ev${unique()}`, presenceRequired: true, quorum: 10 } })
  const subs = Array.from({ length: 12 }, subject)
  setRoster(assembly.id, { present: subs })
  const voters = [await joinAssembly(browser, assembly, 'Anna', subs[0]), await joinAssembly(browser, assembly, 'Ben', subs[1])]
  const admin = await newPage(browser)
  await login(admin, owner.email)
  const voteAndClose = async (title: string) => {
    const poll = await assemblyPoll(assembly, title, { assemblyMajority: 'SIMPLE' })
    for (const page of voters) {
      await page.reload()
      await ballot(page, title).getByLabel('Ja').check()
      await ballot(page, title).getByRole('button', { name: 'Abstimmen' }).click()
      await expect(ballot(page, title)).toContainText('Deine Stimme ist abgegeben.')
    }
    return async () => {
      await admin.goto(`/sitzung/${assembly.id}/verwalten`)
      await admin.getByTestId('open-polls').locator('li').filter({ hasText: title }).getByRole('button', { name: 'Schließen' }).click()
      await expect(admin.getByTestId('closed-polls')).toContainText(title)
      return { poll: await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } }), verdict: admin.getByTestId('closed-polls').locator('li').filter({ hasText: title }).first().getByTestId('verdict') }
    }
  }

  // Gegenprobe: 12 anwesend (beschlussfähig ab 10), 2 Ja - angenommen.
  const ok = await (await voteAndClose('Antrag bei Verbindung'))()
  expect(ok.poll.assemblyQuorumMet).toBe(true)
  await expect(ok.verdict).toContainText('angenommen')

  // Gegenprobe: nur 2 anwesend - kein Beschluss.
  const closeFew = await voteAndClose('Antrag zu wenige')
  setRoster(assembly.id, { present: subs.slice(0, 2) })
  const few = await closeFew()
  expect(few.poll.assemblyQuorumMet).toBe(false)
  await expect(few.verdict).toContainText('kein Beschluss')

  // Fund: rsvp-app antwortet beim Schließen nicht. Ob die Sitzung beschlussfähig war, weiß niemand - das Tool
  // behandelt "unbekannt" wie "kein Quorum eingestellt" und schreibt "angenommen" in Ergebnis, CSV und Protokoll.
  setRoster(assembly.id, { present: subs })
  const closeBlind = await voteAndClose('Antrag ohne Verbindung')
  setRoster(assembly.id, { present: [], status: 503 })
  const blind = await closeBlind()
  setRoster(assembly.id, { present: subs })
  expect(blind.poll.assemblyQuorumMet).toBeNull()
  await expect(blind.verdict).not.toContainText('angenommen')
})

// ---------------------------------------------------------------------------------------------------------------------
// Ergebnis und Wahlgeheimnis

test('V-05 Namentliche Anzeige: wer mit der Zusage "öffentlich bleibt das Ergebnis anonym" abgestimmt hat, steht später nicht mit Namen auf der Seite', async ({ page, browser }) => {
  const owner = await createAccount()
  const moderator = await createAccount('MODERATOR')
  const poll = await createPoll(owner.id, { voterIdentity: 'LINK', showVoterNames: false })
  await prisma.pollAccess.create({ data: { pollId: poll.id, userId: moderator.id } })
  const token = `link-${unique()}-${unique()}`
  await prisma.voterLink.create({ data: { pollId: poll.id, tokenHash: sha256(token), label: 'Anna Beispiel' } })

  const voter = await newPage(browser)
  await voter.goto(`/${poll.id}?k=${token}`)
  await expect(voter.getByText('Öffentlich bleibt das Ergebnis anonym.')).toBeVisible()
  await voter.getByRole('radio', { name: 'Sushi' }).check()
  await voter.getByRole('button', { name: 'Abstimmen' }).click()
  await expect(voter.getByText('Sushi ✓')).toBeVisible()

  // Gegenprobe: Die öffentliche Seite zeigt das Ergebnis ohne Namen.
  const visitor = await newPage(browser)
  await visitor.goto(`/${poll.id}`)
  await expect(visitor.getByText('Live-Ergebnis (1 Person)')).toBeVisible()
  await expect(visitor.getByText('Anna Beispiel')).toHaveCount(0)

  // Fund: Wer die Abstimmung verwaltet (hier: ein Konto mit Freigabe), schaltet die namentliche Anzeige nachträglich ein.
  await login(page, moderator.email)
  await page.goto(`/${poll.id}/verwalten/bearbeiten`)
  await openSection(page, 'ergebnis')
  // Das Formular sperrt den Schalter inzwischen - ein von Hand geschicktes Formular muss trotzdem scheitern.
  await page.locator('input[name="showVoterNames"]').evaluate(e => e.removeAttribute('disabled'))
  await page.getByLabel(/Abstimmende namentlich anzeigen/).check()
  await Promise.all([page.waitForResponse(r => r.request().method() === 'POST'), page.getByRole('button', { name: 'Änderungen speichern' }).click()])
  await page.waitForLoadState('networkidle')

  await visitor.reload()
  await expect(visitor.getByText('Live-Ergebnis (1 Person)')).toBeVisible()
  await expect(visitor.getByText('Anna Beispiel')).toHaveCount(0)
})

test('V-06 Nach dem Ende: Optionen umbenennen und Mindestbeteiligung ändern dreht das Ergebnis einer beendeten Abstimmung nicht mehr', async ({ page }) => {
  const owner = await createAccount()
  const moderator = await createAccount('MODERATOR')
  const poll = await createPoll(owner.id, { quorum: 3 }, ['Dafuer', 'Dagegen'])
  await prisma.pollAccess.create({ data: { pollId: poll.id, userId: moderator.id } })
  for (const optionId of [poll.options[0].id, poll.options[0].id, poll.options[1].id]) await addVote(poll.id, optionId, `cookie:${unique()}`)
  const labels = async () => (await prisma.pollOption.findMany({ where: { pollId: poll.id }, orderBy: { position: 'asc' } })).map(o => o.label)
  const save = async (first: string, second: string, quorum: string) => {
    await page.goto(`/${poll.id}/verwalten/bearbeiten`)
    // Nach dem Ende sperrt das Formular die Felder - ein von Hand geschicktes Formular muss trotzdem scheitern.
    await page.locator('input[disabled]').evaluateAll(inputs => inputs.forEach(e => e.removeAttribute('disabled')))
    await openSection(page, 'optionen')
    await page.locator('input[name="existingOptionLabel"]').nth(0).fill(first)
    await page.locator('input[name="existingOptionLabel"]').nth(1).fill(second)
    await openSection(page, 'ergebnis')
    await page.getByLabel('Mindestbeteiligung (Quorum)').fill(quorum)
    await Promise.all([page.waitForResponse(r => r.request().method() === 'POST'), page.getByRole('button', { name: 'Änderungen speichern' }).click()])
    await page.waitForLoadState('networkidle')
  }
  await login(page, moderator.email)

  // Gegenprobe: Solange die Abstimmung läuft, lässt sich ein Tippfehler korrigieren.
  await save('Dafür', 'Dagegen', '3')
  expect(await labels()).toEqual(['Dafür', 'Dagegen'])

  // Fund: Die Abstimmung ist beendet (2 Dafür, 1 Dagegen, beschlussfähig ab 3) und das Ergebnis verkündet. Danach
  // tauscht ein Konto mit Freigabe die Beschriftungen und hebt die Mindestbeteiligung an - ohne Spur.
  await prisma.poll.update({ where: { id: poll.id }, data: { closedAt: new Date() } })
  await save('Dagegen', 'Dafür', '50')
  expect(await labels()).toEqual(['Dafür', 'Dagegen'])
  expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).quorum).toBe(3)
})

// ---------------------------------------------------------------------------------------------------------------------
// Fragebögen mit KI

test('V-08 KI-Zusammenfassung: eine Antwort aus einem Formular, das vor dem Einschalten geladen wurde (ohne Hinweis), geht nicht an OpenAI', async ({ page, browser }) => {
  const QUESTION = 'Was können wir besser machen?'
  const owner = await createAccount()
  const survey = await prisma.survey.create({
    data: { title: `Feedback ${unique()}`, ownerId: owner.id, questions: { create: [{ position: 0, text: QUESTION, kind: 'TEXT', multiline: true }] } }
  })
  const answer = async (text: string) => {
    const tab = await newPage(browser)
    await tab.goto(`/fragebogen/${survey.id}`)
    await expect(tab.getByTestId('ai-notice')).toBeVisible()
    await tab.getByLabel(QUESTION).fill(text)
    await tab.getByRole('button', { name: 'Absenden' }).click()
    await expect(tab.getByText('Danke!')).toBeVisible()
  }

  // Jemand öffnet den Fragebogen, bevor die KI eingeschaltet ist: kein Hinweis.
  const early = await newPage(browser)
  await early.goto(`/fragebogen/${survey.id}`)
  await expect(early.getByLabel(QUESTION)).toBeVisible()
  await expect(early.getByTestId('ai-notice')).toHaveCount(0)

  // Die Verwaltung schaltet die KI ein (Survey.aiSince wie parseAiSince). Das offene Formular bleibt bis zu 20 Stunden gültig.
  await prisma.survey.update({ where: { id: survey.id }, data: { aiSince: new Date() } })
  for (const text of ['Mehr vegetarisches Essen', 'Die Musik war zu laut', 'Essen und Musik prima']) await answer(text)
  await early.getByLabel(QUESTION).fill('Privates aus dem alten Tab, Musik egal')
  await early.getByRole('button', { name: 'Absenden' }).click()
  await expect(early.getByText('Danke!')).toBeVisible()

  await login(page, owner.email)
  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  const panel = page.getByTestId('survey-summary')
  await panel.getByRole('button', { name: 'Mit KI zusammenfassen' }).click()
  await expect(panel.getByText('Zusammenfassung erstellt.')).toBeVisible()
  const sent = (JSON.parse(readFileSync(AI_FILE, 'utf8')) as { text: string }).text
  // Gegenprobe: Antworten mit Hinweis gehen hinaus.
  expect(sent).toContain('Mehr vegetarisches Essen')
  // Fund: Die Antwort ohne Hinweis auch.
  expect(sent).not.toContain('Privates aus dem alten Tab')
})

// ---------------------------------------------------------------------------------------------------------------------
// Auskunft

test('V-09 Auskunft: Stimmen über einen persönlichen Stimmlink mit dieser Adresse und Stimmen des eigenen Kontos gehören dazu', async () => {
  const run = (...args: string[]) => JSON.parse(execFileSync('node', ['auskunft.js', ...args], { env: { ...process.env, DATABASE_URL: 'file:./test.db' }, encoding: 'utf8' }))
  const email = uniqueEmail('auskunft')
  const owner = await createAccount()
  const titles = { email: `Per Mail ${unique()}`, link: `Per Link ${unique()}`, account: `Per Konto ${unique()}` }

  // Gegenprobe: Stimme mit bestätigter Adresse (Modus EMAIL) steht in der Auskunft.
  const byEmail = await createPoll(owner.id, { title: titles.email, voterIdentity: 'EMAIL' })
  await addVote(byEmail.id, byEmail.options[0].id, `email:${email}`, email, 'EMAIL')
  expect(run(email).daten.stimmen).toEqual([expect.objectContaining({ abstimmung: titles.email, option: 'Pizza' })])

  // Fund: Der Stimmlink wurde an diese Adresse ausgestellt, die Stimme trägt den Namen aus der Liste; und das Konto
  // mit dieser Adresse hat in einer Abstimmung "mit Konto" abgestimmt. Beide Stimmen sagen, wofür die Person war.
  const byLink = await createPoll(owner.id, { title: titles.link, voterIdentity: 'LINK' })
  const link = await prisma.voterLink.create({ data: { pollId: byLink.id, tokenHash: sha256(unique()), label: 'Anna Beispiel', email, hasVoted: true } })
  await addVote(byLink.id, byLink.options[1].id, `link:${link.id}`, 'Anna Beispiel', 'LINK')
  const account = await prisma.user.create({ data: { email, name: 'Anna Beispiel', role: 'MODERATOR' } })
  const byAccount = await createPoll(owner.id, { title: titles.account, voterIdentity: 'ACCOUNT' })
  await addVote(byAccount.id, byAccount.options[1].id, `account:${account.id}`, 'Anna Beispiel', 'ACCOUNT')

  const found = (run(email).daten.stimmen as { abstimmung: string }[]).map(v => v.abstimmung)
  expect(found).toContain(titles.email)
  expect(found).toContain(titles.link)
  expect(found).toContain(titles.account)
})

// ---------------------------------------------------------------------------------------------------------------------
// Zweiter Durchgang: Ergebnis nach dem Ende, Wahlgeheimnis, Zwischenstand

/** Abruf mit der Sitzung der Seite (das Sitzungs-Cookie ist "Secure", page.request schickt es über http nicht mit). */
async function getAs(page: Page, url: string) {
  return page.request.get(url, { headers: { Cookie: (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ') } })
}

test('V-10 Absage nach dem Ende: eine Zu-/Absage aus rsvp-app entfernt keine Stimme aus einer beendeten Abstimmung', async ({ request }) => {
  const owner = await createAccount()
  const eventId = `ev${unique()}`
  const decline = (pollId: string, email: string) => request.post('/api/rsvp-webhook', {
    headers: { 'content-type': 'text/plain' },
    data: sign({ typ: 'poll-attendance', email, pollId, eventId, attending: false })
  })
  const guests = [uniqueEmail('gast'), uniqueEmail('gast'), uniqueEmail('gast')]

  // Gegenprobe: laufende Abstimmung - wer absagt, verliert seine Stimme (so gewollt).
  const open = await createPoll(owner.id, { voterIdentity: 'RSVP', rsvpEventId: eventId })
  await addVote(open.id, open.options[0].id, `rsvp:${guests[0]}`, guests[0], 'RSVP')
  expect((await decline(open.id, guests[0])).ok()).toBe(true)
  expect(await prisma.vote.count({ where: { pollId: open.id } })).toBe(0)

  // Fund: beendet mit 2:1 für Pizza, das Ergebnis steht in rsvp-app. Danach sagen die beiden Pizza-Stimmen ab (oder die
  // Verwaltung des Termins trägt sie aus) - das Ergebnis der beendeten Abstimmung kippt auf Sushi.
  const closed = await createPoll(owner.id, { voterIdentity: 'RSVP', rsvpEventId: eventId, closedAt: new Date() })
  await addVote(closed.id, closed.options[0].id, `rsvp:${guests[0]}`, guests[0], 'RSVP')
  await addVote(closed.id, closed.options[0].id, `rsvp:${guests[1]}`, guests[1], 'RSVP')
  await addVote(closed.id, closed.options[1].id, `rsvp:${guests[2]}`, guests[2], 'RSVP')
  expect((await decline(closed.id, guests[0])).ok()).toBe(true)
  expect((await decline(closed.id, guests[1])).ok()).toBe(true)
  expect(await prisma.vote.count({ where: { pollId: closed.id, optionId: closed.options[0].id } })).toBe(2)
})

test('V-11 Geheime Wahl: solange sie läuft, sieht die Verwaltung nicht zugleich, wer abgestimmt hat, und den Zwischenstand', async ({ browser }) => {
  const owner = await createAccount()
  const admin = await newPage(browser)
  await login(admin, owner.email)
  const hash = (token: string) => createHash('sha256').update(token).digest('hex')
  const linkPoll = async (secretBallot: boolean) => {
    const poll = await createPoll(owner.id, { voterIdentity: 'LINK', secretBallot, resultsVisibility: 'AFTER_CLOSE' })
    const token = `tok${unique()}${unique()}`
    await prisma.voterLink.create({ data: { pollId: poll.id, tokenHash: hash(token), label: 'Anna' } })
    await prisma.voterLink.create({ data: { pollId: poll.id, tokenHash: hash(`x${token}`), label: 'Ben' } })
    const voter = await newPage(browser)
    await voter.goto(`/${poll.id}?k=${token}`)
    await voter.getByLabel('Sushi').check()
    await voter.getByRole('button', { name: 'Abstimmen' }).click()
    await expect(voter.getByRole('button', { name: 'Auswahl speichern' })).toBeVisible()
    return poll
  }

  // Gegenprobe: Stimmlinks ohne geheime Wahl - die Verwaltung sieht, wer was gewählt hat (so steht es im Formular).
  const named = await linkPoll(false)
  await admin.goto(`/${named.id}/verwalten`)
  await expect(admin.getByRole('main')).toContainText('1 · 100%')
  await expect(admin.getByRole('main')).toContainText('Anna')

  // Geheime Wahl: Die Beteiligung darf die Verwaltung sehen ("nur, wer schon abgestimmt hat").
  const secret = await linkPoll(true)
  expect(await prisma.vote.count({ where: { pollId: secret.id, voterName: { not: null } } })).toBe(0)
  await admin.goto(`/${secret.id}/verwalten/stimmlinks`)
  await expect(admin.getByText('Beteiligung: 1 von 2 haben abgestimmt')).toBeVisible()
  await expect(admin.getByRole('listitem').filter({ hasText: 'Anna' })).toContainText('abgestimmt')

  // Fund: Dieselbe Verwaltung (auch ein Konto mit Freigabe, das die Links nie in der Hand hatte) sieht daneben den
  // Zwischenstand. Nach jeder einzelnen Stimme neu geladen, steht fest, wer wofür gestimmt hat - hier: Anna für Sushi.
  await admin.goto(`/${secret.id}/verwalten`)
  await expect(admin.getByTestId('stat-voters')).toContainText('1')
  await expect(admin.getByTestId('stat-leader')).not.toContainText('Sushi')
  await expect(admin.getByRole('main')).not.toContainText('1 · 100%')
  const csv = await getAs(admin, `/${secret.id}/verwalten/export`)
  expect(csv.status()).toBe(200)
  expect(await csv.text()).not.toMatch(/Sushi;"?1/)
  // Nach dem Ende steht das Ergebnis da.
  await prisma.poll.update({ where: { id: secret.id }, data: { closedAt: new Date() } })
  await admin.reload()
  await expect(admin.getByRole('main')).toContainText('1 · 100%')
})

test('V-12 Sitzung: der CSV-Export einer einzelnen Abstimmung verrät der Leitung keinen Zwischenstand einer laufenden Abstimmung', async ({ browser }) => {
  const owner = await createAccount()
  const assembly = await prisma.assembly.create({ data: { title: `Sitzung ${unique()}`, ownerId: owner.id, rsvpEventId: `ev${unique()}`, presenceRequired: true } })
  const anna = subject()
  setRoster(assembly.id, { present: [anna] })
  const annaPage = await joinAssembly(browser, assembly, 'Anna Beispiel', anna)
  const admin = await newPage(browser)
  await login(admin, owner.email)

  const poll = await assemblyPoll(assembly, 'Antrag Haushalt')
  await annaPage.reload()
  await ballot(annaPage, 'Antrag Haushalt').getByLabel('Nein').check()
  await ballot(annaPage, 'Antrag Haushalt').getByRole('button', { name: 'Abstimmen' }).click()
  await expect(ballot(annaPage, 'Antrag Haushalt')).toContainText('Deine Stimme ist abgegeben.')

  // Gegenprobe: Die Leitung sieht bei der laufenden Abstimmung die Zahl der Stimmen, mehr nicht; der Export der
  // Beschlüsse enthält nur geschlossene Abstimmungen.
  await admin.goto(`/sitzung/${assembly.id}/verwalten`)
  await expect(admin.getByTestId('open-polls')).toContainText('1 abgestimmt')
  await expect(admin.getByTestId('open-polls')).not.toContainText('Anna Beispiel')
  const decisions = await getAs(admin, `/sitzung/${assembly.id}/verwalten/export`)
  expect(decisions.status()).toBe(200)
  expect(await decisions.text()).not.toContain('Antrag Haushalt')

  // Fund: Der Export der gewöhnlichen Abstimmungsverwaltung prüft nicht, dass die Abstimmung zu einer Sitzung gehört.
  // Die Seite daneben leitet um, die Route liefert Zählstand und - namentlich - wer wie gestimmt hat, vor dem Schließen.
  const single = await (await getAs(admin, `/${poll.id}/verwalten/export`)).text()
  expect(single).not.toContain('Anna Beispiel')
  expect(single).not.toMatch(/Nein;"?1/)
})
