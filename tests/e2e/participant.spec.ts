import { expect, test, type Page } from '@playwright/test'
import { createAccount, createPoll, pageAlert, prisma, unique, uniqueEmail } from './helpers'
import { setIdentity, SUITE_TOOLS, type TestIdentity } from './suite-server'
import { TEST_CRON_SECRET } from '../../playwright.config'

// Teilnehmendenkonten aus dem Verbund (TODO.md D1, suite-kit v0.2.0): Abstimmen im Modus ACCOUNT mit
// einem Konto eines anderen Tools, ohne dass hier ein Verwaltungskonto entsteht. Den Anbieter spielt
// Tool A aus tests/e2e/suite-server.ts (participants: true), Tool B liefert keine Teilnehmenden.

const PARTICIPANT_COOKIE = '__Host-participant'

function person(overrides: Partial<TestIdentity> = {}): TestIdentity {
  return { sub: `paarweise-${unique()}`, email: uniqueEmail('gast'), name: 'Gast Gisela', ...overrides }
}

async function participantLogin(page: Page, pollId: string) {
  await page.goto(`/${pollId}`)
  await page.getByRole('link', { name: `Mit deinem Konto bei ${SUITE_TOOLS.a.label} abstimmen` }).click()
  await page.waitForURL(url => url.pathname === `/${pollId}`)
}

test.afterEach(() => setIdentity('a', null))

test('Abstimmen mit Teilnehmendenkonto: eigene Tabelle, kein Verwaltungskonto, eine Stimme pro Person', async ({ page, browser }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'ACCOUNT', showVoterNames: true })
  const gisela = person()
  setIdentity('a', gisela)

  await page.goto(`/${poll.id}`)
  // Tool B liefert keine Teilnehmenden - dafür gibt es keinen Knopf.
  await expect(page.getByRole('link', { name: `Mit deinem Konto bei ${SUITE_TOOLS.b.label} abstimmen` })).toHaveCount(0)
  await participantLogin(page, poll.id)

  await expect(page.getByText(`Du stimmst mit deinem Konto bei ${SUITE_TOOLS.a.label} ab: Gast Gisela`)).toBeVisible()
  await page.getByRole('radio', { name: 'Pizza' }).check()
  await page.getByRole('button', { name: 'Abstimmen' }).click()
  await expect(page.getByText('Pizza ✓')).toBeVisible()

  const participant = await prisma.participant.findUniqueOrThrow({ where: { issuer_subject: { issuer: SUITE_TOOLS.a.origin, subject: gisela.sub } } })
  expect(participant.name).toBe('Gast Gisela')
  const stored = await prisma.vote.findFirstOrThrow({ where: { pollId: poll.id } })
  expect(stored).toMatchObject({ identityKind: 'ACCOUNT', voterKey: `participant:${participant.id}`, voterName: 'Gast Gisela' })
  // Kein Verwaltungskonto, keine Verbund-Verknüpfung, keine E-Mail.
  expect(await prisma.externalIdentity.count({ where: { subject: gisela.sub } })).toBe(0)
  expect(await prisma.user.count({ where: { email: gisela.email } })).toBe(0)

  // Cookie: eigenes, HttpOnly, höchstens 24 Stunden.
  const cookie = (await page.context().cookies()).find(c => c.name === PARTICIPANT_COOKIE)!
  expect(cookie.httpOnly).toBe(true)
  expect(cookie.expires * 1000 - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 60_000)

  // Strukturell keine Verwaltungsrechte: Verwaltungsseiten verlangen weiter eine Anmeldung.
  await page.goto('/meine-abstimmungen')
  await expect(page).toHaveURL(/\/anmelden/)
  expect((await page.goto(`/${poll.id}/verwalten`))!.url()).toContain('/anmelden')

  // Anderes Gerät, dieselbe Person: dieselbe Stimme, keine zweite.
  const other = await (await browser.newContext()).newPage()
  await participantLogin(other, poll.id)
  await expect(other.getByText('Pizza ✓')).toBeVisible()
  await other.getByRole('radio', { name: 'Sushi' }).check()
  await other.getByRole('button', { name: 'Auswahl speichern' }).click()
  await expect(other.getByText('Sushi ✓')).toBeVisible()
  expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(1)
  await other.context().close()

  // Abmelden: Sitzung weg, wieder der Hinweis.
  await page.goto(`/${poll.id}`)
  await page.getByRole('button', { name: 'abmelden' }).click()
  await expect(page.getByText('Für diese Abstimmung brauchst du ein Konto')).toBeVisible()
})

test('Login-Bestätigung statt Teilnehmenden-Bestätigung (älterer Anbieter) wird abgelehnt', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'ACCOUNT' })
  const old = person({ tamper: 'login-typ', role: 'ADMIN' })
  setIdentity('a', old)

  await participantLogin(page, poll.id)
  await expect(pageAlert(page)).toContainText('Die Anmeldung über das andere Tool ist fehlgeschlagen.')
  expect(await prisma.participant.count({ where: { subject: old.sub } })).toBe(0)
  expect(await prisma.user.count({ where: { email: old.email } })).toBe(0)
  await expect(page.getByRole('button', { name: 'Abstimmen' })).toHaveCount(0)
})

test('Nur Anbieter mit participants: Tool B wird auch direkt nicht angefragt', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'ACCOUNT' })
  const params = new URLSearchParams({ idp: SUITE_TOOLS.b.origin, mode: 'participant', next: `/${poll.id}` })
  await page.goto(`/api/suite/login?${params}`)
  await expect(page).toHaveURL(new RegExp(`/${poll.id}\\?hinweis=anmeldung-fehlgeschlagen`))
})

test('Abgelaufene Sitzung gilt nicht mehr; Cleanup löscht alte Teilnehmende, Stimmen bleiben ohne Namen', async ({ page, request }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { voterIdentity: 'ACCOUNT' })
  setIdentity('a', person())
  await participantLogin(page, poll.id)
  await page.getByRole('radio', { name: 'Pizza' }).check()
  await page.getByRole('button', { name: 'Abstimmen' }).click()
  await expect(page.getByText('Pizza ✓')).toBeVisible()

  const vote = await prisma.vote.findFirstOrThrow({ where: { pollId: poll.id } })
  const participantId = vote.voterKey.slice('participant:'.length)
  await prisma.participantSession.updateMany({ where: { participantId }, data: { expiresAt: new Date(Date.now() - 1000) } })
  await page.goto(`/${poll.id}`)
  await expect(page.getByText('Für diese Abstimmung brauchst du ein Konto')).toBeVisible()

  await prisma.participant.update({ where: { id: participantId }, data: { lastLoginAt: new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000) } })
  expect((await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)).ok()).toBe(true)
  expect(await prisma.participant.findUnique({ where: { id: participantId } })).toBeNull()
  expect(await prisma.participantSession.count({ where: { participantId } })).toBe(0)
  const kept = await prisma.vote.findUniqueOrThrow({ where: { id: vote.id } })
  expect(kept.voterName).toBeNull()
})
