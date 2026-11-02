import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { expect, test, type Browser } from '@playwright/test'
import { createAccount, login, prisma, unique, uniqueIp } from './helpers'
import { AI_FILE } from './ai-server'

// KI-Zusammenfassung von Freitext-Antworten (README „Fragebögen“, app/lib/survey-summary.ts) gegen das Test-Doppel
// tests/e2e/ai-server.ts: einschalten, Hinweis im Formular, nur Antworten seit dem Einschalten an die KI, Themen mit
// echten Zitaten, Löschen von Abgaben nimmt die Zusammenfassung mit, Fehler der KI, ausschalten.

const QUESTION = 'Was können wir besser machen?'

async function createTextSurvey(ownerId: string, question = QUESTION, data: { aiSince?: Date } = {}) {
  return prisma.survey.create({
    data: {
      title: `Feedback ${unique()}`, ownerId, ...data,
      questions: { create: [{ position: 0, text: question, kind: 'TEXT', multiline: true }] }
    },
    include: { questions: true }
  })
}

/** Beantwortet den Fragebogen als neue Person (eigener Kontext, eigene IP). */
async function answer(browser: Browser, surveyId: string, text: string) {
  const context = await browser.newContext({ locale: 'de-DE', extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  const page = await context.newPage()
  await page.goto(`/fragebogen/${surveyId}`)
  await page.getByLabel(QUESTION).fill(text)
  await page.getByRole('button', { name: 'Absenden' }).click()
  await expect(page.getByText('Danke!')).toBeVisible()
  await context.close()
}

const lastRequest = () => JSON.parse(readFileSync(AI_FILE, 'utf8')) as { model: string; store: boolean; instructions: string; text: string }

test('einschalten, Hinweis im Formular, nur neue Antworten zusammenfassen; Löschen nimmt die Zusammenfassung mit', async ({ page, browser }) => {
  const owner = await createAccount()
  const survey = await createTextSurvey(owner.id)
  await answer(browser, survey.id, 'Essen war vorher schon super')
  await login(page, owner.email)
  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  await expect(page.getByTestId('survey-result').getByText('Essen war vorher schon super')).toBeVisible()
  await expect(page.getByTestId('survey-summary')).toHaveCount(0)
  await expect(page.getByTestId('summary-hint')).toHaveCount(0)
  await page.goto(`/fragebogen/${survey.id}`)
  await expect(page.getByTestId('ai-notice')).toHaveCount(0)

  await page.goto(`/fragebogen/${survey.id}/bearbeiten`)
  await page.getByLabel('Freitext-Antworten mit KI zusammenfassen').check()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible()
  const since = (await prisma.survey.findUniqueOrThrow({ where: { id: survey.id } })).aiSince
  expect(since).not.toBeNull()
  // Erneut speichern lässt den Zeitpunkt stehen.
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText(/eingeschaltet am/)).toBeVisible()
  expect((await prisma.survey.findUniqueOrThrow({ where: { id: survey.id } })).aiSince).toEqual(since)

  // Hinweis vor dem Ausfüllen, auf Deutsch und Englisch.
  await page.goto(`/fragebogen/${survey.id}`)
  await expect(page.getByTestId('ai-notice')).toContainText('von einer KI (OpenAI) zusammengefasst')
  await page.goto(`/fragebogen/${survey.id}?lang=en`)
  await expect(page.getByTestId('ai-notice')).toContainText('summarised by an AI service (OpenAI)')

  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  await expect(page.getByTestId('summary-hint')).toContainText('bisher 0')
  for (const text of ['Mehr vegetarisches Essen bitte', 'Die Musik war zu laut', 'Musik und Essen top']) await answer(browser, survey.id, text)

  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  const panel = page.getByTestId('survey-summary')
  await expect(panel).toContainText('3 von 4 Antworten (nur die seit dem Einschalten) gehen an OpenAI.')
  await panel.getByRole('button', { name: 'Mit KI zusammenfassen' }).click()
  await expect(panel.getByText('Zusammenfassung erstellt.')).toBeVisible()
  await expect(panel).toContainText('Überwiegend zufrieden')
  await expect(panel).toContainText('aus 3 Antworten von einer KI (OpenAI) erstellt')
  const essen = panel.getByTestId('summary-theme').filter({ hasText: /^Essen/ })
  await expect(essen).toContainText('2 Antworten')
  await essen.getByText('Lob und Wünsche zum Essen.').click()
  await expect(essen.getByText('Mehr vegetarisches Essen bitte')).toBeVisible()
  // Die alte Antwort kommt auch dann nicht vor, wenn sie zum Thema passte.
  await expect(essen.getByText('Essen war vorher schon super')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Neu zusammenfassen' })).toBeVisible()

  const request = lastRequest()
  expect(request).toMatchObject({ model: 'gpt-6-luna', store: false })
  expect(request.text).toContain(`Frage: ${QUESTION}`)
  expect(request.text).toContain('Antworten (3):')
  expect(request.text).not.toContain('vorher')
  const ids = (await prisma.surveyAnswer.findMany({ where: { questionId: survey.questions[0].id }, include: { response: true } })).flatMap(a => [a.id, a.responseId])
  for (const id of [survey.id, survey.questions[0].id, ...ids]) expect(request.text).not.toContain(id)

  const { violations } = await new AxeBuilder({ page }).include('[data-testid="survey-summary"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(violations).toEqual([])

  // Eine Abgabe löschen: Die Zusammenfassung könnte sie wiedergeben und fällt weg.
  await page.getByText(/Alle 4 Abgaben ansehen/).click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('response-list').getByRole('listitem').filter({ hasText: 'Die Musik war zu laut' }).getByRole('button', { name: 'löschen' }).click()
  await expect(page.getByText('1 Antwort gelöscht.')).toBeVisible()
  expect(await prisma.surveySummary.count({ where: { questionId: survey.questions[0].id } })).toBe(0)
})

test('Fehler der KI, zu wenige Antworten, Freigabe darf zusammenfassen, Ausschalten nimmt Knopf und Hinweis weg', async ({ page }) => {
  const owner = await createAccount()
  const helper = await createAccount()
  const since = new Date(Date.now() - 60_000)
  const survey = await createTextSurvey(owner.id, 'Kaputt: was fehlt?', { aiSince: since })
  await prisma.surveyAccess.create({ data: { surveyId: survey.id, userId: helper.id } })
  const add = (text: string) => prisma.surveyResponse.create({ data: { surveyId: survey.id, answers: { create: [{ questionId: survey.questions[0].id, text }] } } })
  await add('Essen')
  await add('Musik')

  await login(page, helper.email)
  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  await expect(page.getByTestId('summary-hint')).toContainText('ab 3 Antworten seit dem Einschalten (bisher 2)')
  await add('Essen und Musik')
  await page.reload()
  await page.getByRole('button', { name: 'Mit KI zusammenfassen' }).click()
  await expect(page.getByText('Die KI hat nicht oder nicht brauchbar geantwortet.')).toBeVisible()
  expect(await prisma.surveySummary.count({ where: { questionId: survey.questions[0].id } })).toBe(0)

  await page.goto(`/fragebogen/${survey.id}/bearbeiten`)
  await page.getByLabel('Freitext-Antworten mit KI zusammenfassen').uncheck()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible()
  expect((await prisma.survey.findUniqueOrThrow({ where: { id: survey.id } })).aiSince).toBeNull()
  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  await expect(page.getByRole('button', { name: 'Mit KI zusammenfassen' })).toHaveCount(0)
  await page.goto(`/fragebogen/${survey.id}`)
  await expect(page.getByTestId('ai-notice')).toHaveCount(0)
})
