import { createHmac } from 'node:crypto'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { createAccount, login, prisma, unique, uniqueIp } from './helpers'
import { TEST_RSVP_SECRET } from '../../playwright.config'

// Fragebogen im Modus RSVP (Idee L8 Teil 2, verifyRsvpSurveyToken in app/lib/rsvp-verification.ts): Antworten nur
// mit dem Link-Nachweis, den rsvp-app bei "Feedback geben" ausstellt - eine Antwort pro Zusage (Pseudonym `sub`),
// änderbar. rsvp-app spielen die Tests selbst: Sie signieren den Nachweis im selben Format wie rsvp-app
// (app/lib/feedback-link.ts dort). Jeder abgelehnte Fall hat eine positive Gegenprobe im selben Test.

function sign(payload: object, secret = TEST_RSVP_SECRET): string {
  const part = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${part}.${createHmac('sha256', secret).update(part).digest('base64url')}`
}

const now = () => Math.floor(Date.now() / 1000)
const subject = () => createHmac('sha256', 'x').update(unique()).digest('base64url')

function surveyToken(surveyId: string, sub: string, extra: Record<string, unknown> = {}): string {
  return sign({ typ: 'survey-access', surveyId, sub, exp: now() + 3600, ...extra })
}

async function createRsvpSurvey(ownerId: string) {
  return prisma.survey.create({
    data: {
      title: `Feedback ${unique()}`,
      ownerId,
      identity: 'RSVP',
      questions: {
        create: [
          { position: 0, text: 'Wie hat es dir gefallen?', kind: 'SCALE', required: true, scaleMin: 1, scaleMax: 5 },
          { position: 1, text: 'Was können wir besser machen?', kind: 'TEXT' }
        ]
      }
    }
  })
}

async function visitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: 'de-DE', extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  return context.newPage()
}

function scaleValue(page: Page, value: string) {
  return page.locator('label').filter({ has: page.getByRole('radio', { name: new RegExp(`^${value}( |$)`) }) })
}

const submit = (page: Page) => page.getByRole('button', { name: /Absenden|Änderungen speichern/ })

test('nur mit gültigem Nachweis aus rsvp-app: fremde, abgelaufene und falsche Tokens zeigen kein Formular', async ({ browser }) => {
  const owner = await createAccount()
  const survey = await createRsvpSurvey(owner.id)
  const other = await createRsvpSurvey(owner.id)
  const page = await visitor(browser)
  const sub = subject()

  await page.goto(`/fragebogen/${survey.id}`)
  await expect(page.getByText('über deinen persönlichen Link zum Event')).toBeVisible()
  await expect(submit(page)).toHaveCount(0)

  const rejected: [string, string][] = [
    ['anderer Fragebogen', surveyToken(other.id, sub)],
    ['abgelaufen', surveyToken(survey.id, sub, { exp: now() - 10 })],
    ['länger als 24 h gültig', surveyToken(survey.id, sub, { exp: now() + 25 * 3600 })],
    ['ohne typ', sign({ surveyId: survey.id, sub, exp: now() + 3600 })],
    ['Abstimmungs-Token', sign({ email: 'a@example.test', pollId: survey.id, attending: true, exp: now() + 600 })],
    ['Pseudonym ungültig', surveyToken(survey.id, 'a b')],
    ['falsches Secret', sign({ typ: 'survey-access', surveyId: survey.id, sub, exp: now() + 3600 }, 'ein-anderes-secret')]
  ]
  for (const [label, token] of rejected) {
    await page.goto(`/fragebogen/${survey.id}?verify=${encodeURIComponent(token)}`)
    await expect(page.getByText('Dein Link ist abgelaufen'), label).toBeVisible()
    await expect(submit(page), label).toHaveCount(0)
  }

  // Gegenprobe: derselbe Aufbau mit gültigem Nachweis zeigt das Formular
  await page.goto(`/fragebogen/${survey.id}?verify=${encodeURIComponent(surveyToken(survey.id, sub))}`)
  await expect(page.getByText('Eine Antwort pro Gast, ohne Namen und E-Mail-Adresse.')).toBeVisible()
  await expect(submit(page)).toHaveText('Absenden')
})

test('eine Antwort pro Zusage, mit neuem Nachweis änderbar; andere Zusage = eigene Antwort', async ({ browser }) => {
  const owner = await createAccount()
  const survey = await createRsvpSurvey(owner.id)
  const page = await visitor(browser)
  const sub = subject()

  await page.goto(`/fragebogen/${survey.id}?verify=${encodeURIComponent(surveyToken(survey.id, sub))}`)
  await scaleValue(page, '2').click()
  await page.getByLabel('Was können wir besser machen?').fill('Mehr Kuchen')
  await submit(page).click()
  await expect(page.getByText('Deine Antworten sind angekommen.')).toBeVisible()
  // Der Nachweis reist mit: "ansehen oder ändern" führt wieder ins Formular, vorausgefüllt
  await page.getByRole('link', { name: 'Antworten ansehen oder ändern' }).click()
  await expect(page.getByText('Du hast schon geantwortet')).toBeVisible()
  await expect(page.getByLabel('Was können wir besser machen?')).toHaveValue('Mehr Kuchen')

  // Später, neuer Klick in rsvp-app (neuer Nachweis, gleiches Pseudonym): dieselbe Antwort, geändert
  const again = await visitor(browser)
  await again.goto(`/fragebogen/${survey.id}?verify=${encodeURIComponent(surveyToken(survey.id, sub))}`)
  await expect(again.getByText('Du hast schon geantwortet')).toBeVisible()
  await scaleValue(again, '5').click()
  await submit(again).click()
  await expect(again.getByText('Deine Antworten sind angekommen.')).toBeVisible()

  const responses = await prisma.surveyResponse.findMany({ where: { surveyId: survey.id }, include: { answers: { include: { question: true } } } })
  expect(responses).toHaveLength(1)
  expect(responses[0].voterKey).toBe(`rsvp:${sub}`)
  expect(responses[0].answers.find(a => a.question.kind === 'SCALE')?.number).toBe(5)

  // Eine andere Zusage antwortet für sich
  const guest = await visitor(browser)
  await guest.goto(`/fragebogen/${survey.id}?verify=${encodeURIComponent(surveyToken(survey.id, subject()))}`)
  await expect(guest.getByText('Du hast schon geantwortet')).toHaveCount(0)
  await scaleValue(guest, '4').click()
  await submit(guest).click()
  await expect(guest.getByText('Deine Antworten sind angekommen.')).toBeVisible()
  expect(await prisma.surveyResponse.count({ where: { surveyId: survey.id } })).toBe(2)
})

test('Abgabe mit manipuliertem oder abgelaufenem Nachweis speichert nichts', async ({ browser }) => {
  const owner = await createAccount()
  const survey = await createRsvpSurvey(owner.id)
  const other = await createRsvpSurvey(owner.id)
  const page = await visitor(browser)

  for (const [label, forged] of [
    ['abgelaufen', surveyToken(survey.id, subject(), { exp: now() - 1 })],
    ['anderer Fragebogen', surveyToken(other.id, subject())],
    ['leer', '']
  ] as const) {
    await page.goto(`/fragebogen/${survey.id}?verify=${encodeURIComponent(surveyToken(survey.id, subject()))}`)
    await scaleValue(page, '3').click()
    await page.locator('input[name="verify"]').evaluate((input, value) => { (input as HTMLInputElement).value = value }, forged)
    await submit(page).click()
    await expect(page.getByText('Dein Link ist abgelaufen'), label).toBeVisible()
    expect(await prisma.surveyResponse.count({ where: { surveyId: survey.id } }), label).toBe(0)
  }

  // Gegenprobe: unverändert abgeschickt wird gespeichert
  await page.goto(`/fragebogen/${survey.id}?verify=${encodeURIComponent(surveyToken(survey.id, subject()))}`)
  await scaleValue(page, '3').click()
  await submit(page).click()
  await expect(page.getByText('Deine Antworten sind angekommen.')).toBeVisible()
  expect(await prisma.surveyResponse.count({ where: { surveyId: survey.id } })).toBe(1)
})

test('in anderen Modi ist ein mitgeschickter Nachweis bedeutungslos', async ({ browser }) => {
  const owner = await createAccount()
  const survey = await prisma.survey.create({
    data: { title: `Feedback ${unique()}`, ownerId: owner.id, identity: 'COOKIE', questions: { create: [{ position: 0, text: 'Wie hat es dir gefallen?', kind: 'SCALE', required: true, scaleMin: 1, scaleMax: 5 }] } }
  })
  const page = await visitor(browser)
  await page.goto(`/fragebogen/${survey.id}?verify=${encodeURIComponent(surveyToken(survey.id, subject()))}`)
  await expect(page.locator('input[name="verify"]')).toHaveCount(0)
  await scaleValue(page, '1').click()
  await submit(page).click()
  await expect(page.getByText('Deine Antworten sind angekommen.')).toBeVisible()
  const [response] = await prisma.surveyResponse.findMany({ where: { surveyId: survey.id } })
  expect(response.voterKey).toMatch(/^cookie:/)
})

test('Verwaltung: Modus wählbar, Hinweis auf rsvp-app statt QR-Code und Einbetten', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/fragebogen/neu')
  await expect(page.getByRole('radio', { name: /Gäste aus rsvp-app/ })).toBeVisible()

  const survey = await createRsvpSurvey(owner.id)
  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  await expect(page.getByTestId('rsvp-survey-hint')).toBeVisible()
  await expect(page.getByTestId('embed-details')).toHaveCount(0)
})
