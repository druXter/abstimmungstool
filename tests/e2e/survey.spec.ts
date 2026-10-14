import { createServer, type Server } from 'node:http'
import { expect, test, type Browser, type Page } from '@playwright/test'
import type { Prisma } from '@prisma/client'
import { BASE_URL, createAccount, login, prisma, unique, uniqueIp } from './helpers'
import { EMBED_HOST, FOREIGN_HOST, SAME_SITE_HOST } from '../../playwright.config'

// Fragebogen (docs/KONZEPT-FRAGEBOGEN.md): Anlegen, Ausfüllen anonym und einmal pro Gerät, Pflichtfragen,
// Auswertung und CSV, Sperre der Fragen nach der ersten Antwort, Einbetten per iFrame nur auf freigegebenen Seiten.

type QuestionSeed = Omit<Prisma.SurveyQuestionCreateWithoutSurveyInput, 'position' | 'options'> & { options?: string[] }

async function createSurvey(ownerId: string, questions: QuestionSeed[], data: Partial<Prisma.SurveyUncheckedCreateInput> = {}) {
  return prisma.survey.create({
    data: {
      title: `Feedback ${unique()}`,
      ownerId,
      ...data,
      questions: {
        create: questions.map(({ options = [], ...q }, position) => ({
          ...q, position, options: { create: options.map((label, i) => ({ position: i, label })) }
        }))
      }
    },
    include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } } }
  })
}

const STANDARD: QuestionSeed[] = [
  { text: 'Wie hat es dir gefallen?', kind: 'SCALE', required: true, scaleMin: 1, scaleMax: 5, minLabel: 'gar nicht', maxLabel: 'sehr' },
  { text: 'Wo hast du davon erfahren?', kind: 'SINGLE', options: ['Instagram', 'Freunde', 'Plakat'] },
  { text: 'Was war gut?', kind: 'MULTI', options: ['Essen', 'Musik', 'Programm'], maxChoices: 2 },
  { text: 'Was können wir besser machen?', kind: 'TEXT', multiline: true }
]

/** Neue Person: eigener Browser-Kontext (eigene Cookies) und eigene IP. */
async function visitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: 'de-DE', extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  return context.newPage()
}

/** Ein Wert der linearen Skala - der Knopf, den man sieht (der Radiobutton darunter ist nur für Screenreader sichtbar). */
function scaleValue(page: Page | ReturnType<Page['frameLocator']>, value: string) {
  return page.locator('label').filter({ has: page.getByRole('radio', { name: new RegExp(`^${value}( |$)`) }) })
}

/** Füllt den Standard-Fragebogen aus (Skala-Wert, Einfachauswahl, Kreuze, Text) und schickt ihn ab. */
async function fillStandard(page: Page, answers: { scale: string; single?: string; multi?: string[]; text?: string }) {
  await scaleValue(page, answers.scale).click()
  if (answers.single) await page.getByRole('radio', { name: answers.single }).check()
  for (const label of answers.multi ?? []) await page.getByRole('checkbox', { name: label }).check()
  if (answers.text) await page.getByLabel('Was können wir besser machen?').fill(answers.text)
  await page.getByRole('button', { name: /Absenden|Änderungen speichern/ }).click()
}

test('Fragebogen anlegen: alle Fragearten, Pflicht, Skala, Höchstzahl - Übersicht und Liste', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/meine-abstimmungen')
  await page.getByRole('link', { name: 'Neuer Fragebogen' }).click()

  await page.getByLabel('Titel', { exact: true }).fill('Feedback Erstiwoche')
  await page.getByLabel('Beschreibung (optional)').fill('Dauert zwei Minuten.')
  await page.getByLabel('Frage 1', { exact: true }).fill('Wie fandest du die Woche?')
  await page.getByLabel('Art').first().selectOption('SCALE')
  await page.getByLabel('Pflichtfrage').first().check()
  await page.getByLabel('bis', { exact: true }).selectOption('10')
  await page.getByLabel('Frage 1, Beschriftung für 1', { exact: true }).fill('schlecht')
  await page.getByLabel('Frage 1, Beschriftung für 10', { exact: true }).fill('super')

  await page.getByRole('button', { name: '+ Weitere Frage' }).click()
  await page.getByLabel('Frage 2', { exact: true }).fill('Was hast du besucht?')
  await page.getByLabel('Art').nth(1).selectOption('MULTI')
  await page.getByLabel('Frage 2, Option 1').fill('Rallye')
  await page.getByLabel('Frage 2, Option 2').fill('Kneipentour')
  await page.getByRole('button', { name: '+ Option hinzufügen' }).click()
  await page.getByLabel('Frage 2, Option 3').fill('Stadtführung')
  await page.getByLabel('Höchstens').selectOption('2')

  await page.getByRole('button', { name: '+ Weitere Frage' }).click()
  await page.getByLabel('Frage 3', { exact: true }).fill('Sonst noch was?')
  await page.getByLabel('Art').nth(2).selectOption('TEXT')
  await page.getByLabel('Mehrzeilig').check()
  await page.getByRole('button', { name: 'Fragebogen anlegen' }).click()

  await page.waitForURL(/\/fragebogen\/[^/]+\/verwalten\?angelegt=1/)
  await expect(page.getByText('Fragebogen angelegt')).toBeVisible()
  const id = new URL(page.url()).pathname.split('/')[2]
  const survey = await prisma.survey.findUniqueOrThrow({
    where: { id },
    include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } } }
  })
  expect(survey).toMatchObject({ title: 'Feedback Erstiwoche', description: 'Dauert zwei Minuten.', identity: 'ANONYMOUS', ownerId: owner.id })
  expect(survey.questions.map(q => [q.kind, q.required])).toEqual([['SCALE', true], ['MULTI', false], ['TEXT', false]])
  expect(survey.questions[0]).toMatchObject({ scaleMin: 1, scaleMax: 10, minLabel: 'schlecht', maxLabel: 'super' })
  expect(survey.questions[1].options.map(o => o.label)).toEqual(['Rallye', 'Kneipentour', 'Stadtführung'])
  expect(survey.questions[1].maxChoices).toBe(2)
  expect(survey.questions[2].multiline).toBe(true)

  await page.goto('/meine-abstimmungen')
  const row = page.getByTestId('poll-row').filter({ hasText: 'Feedback Erstiwoche' })
  await expect(row).toContainText('Fragebogen · offen')
  await expect(row).toContainText('3 Fragen · anonym')
})

test('Anonym ausfüllen: jede Abgabe zählt, Danke-Text, Pflichtfrage und Höchstzahl, Auswertung und CSV', async ({ page, browser }) => {
  const owner = await createAccount()
  const survey = await createSurvey(owner.id, STANDARD, { thanksText: 'Merci fürs Mitmachen!' })

  const guest = await visitor(browser)
  await guest.goto(`/fragebogen/${survey.id}`)
  await expect(guest.getByRole('heading', { name: survey.title })).toBeVisible()
  await expect(guest.getByText('Anonym, ohne Konto.')).toBeVisible()

  // Pflichtfrage leer: der Browser hält das Formular an.
  await guest.getByRole('button', { name: 'Absenden' }).click()
  await expect(guest).toHaveURL(new RegExp(`/fragebogen/${survey.id}$`))
  expect(await prisma.surveyResponse.count({ where: { surveyId: survey.id } })).toBe(0)

  // Höchstzahl 2: das dritte Kästchen ist gesperrt.
  await guest.getByRole('checkbox', { name: 'Essen' }).check()
  await guest.getByRole('checkbox', { name: 'Musik' }).check()
  await expect(guest.getByRole('checkbox', { name: 'Programm' })).toBeDisabled()
  await guest.getByRole('checkbox', { name: 'Musik' }).uncheck()

  await fillStandard(guest, { scale: '4', single: 'Freunde', text: 'Mehr Sitzplätze' })
  await expect(guest.getByText('Merci fürs Mitmachen!')).toBeVisible()
  await expect(guest.getByRole('link', { name: /ändern/ })).toHaveCount(0)

  // Dieselbe Person noch einmal: anonym gibt es keinen Gerätebezug, also eine zweite Antwort.
  await guest.goto(`/fragebogen/${survey.id}`)
  await fillStandard(guest, { scale: '2', multi: ['Musik', 'Programm'] })
  await expect(guest.getByText('Merci fürs Mitmachen!')).toBeVisible()
  await expect.poll(() => prisma.surveyResponse.count({ where: { surveyId: survey.id, voterKey: null } })).toBe(2)

  // Ohne JavaScript-Prüfung (direkt ans Formular): leere Pflichtfrage bzw. zu viele Kreuze werden abgelehnt.
  await guest.goto(`/fragebogen/${survey.id}`)
  await guest.evaluate(() => document.querySelectorAll('form').forEach(f => f.setAttribute('novalidate', '')))
  await guest.getByRole('radio', { name: 'Plakat' }).check()
  await guest.getByRole('button', { name: 'Absenden' }).click()
  await expect(guest.getByText('Bitte beantworte alle Pflichtfragen')).toBeVisible()
  expect(await prisma.surveyResponse.count({ where: { surveyId: survey.id } })).toBe(2)

  // Auswertung für die Verwaltung.
  await login(page, owner.email)
  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  await expect(page.getByTestId('stat-responses')).toContainText('2')
  const results = page.getByTestId('survey-result')
  await expect(results.nth(0)).toContainText('Durchschnitt 3')
  await expect(results.nth(0)).toContainText('2 Antworten')
  await expect(results.nth(1)).toContainText('1 Antwort')
  await expect(results.nth(1).locator('li').filter({ hasText: 'Freunde' })).toContainText('1 · 100%')
  await expect(results.nth(2).locator('li').filter({ hasText: 'Essen' })).toContainText('1 · 50%')
  await expect(results.nth(3)).toContainText('Mehr Sitzplätze')

  const csv = await page.evaluate(async url => {
    const response = await fetch(url)
    return response.ok ? response.text() : `HTTP ${response.status}`
  }, `/fragebogen/${survey.id}/verwalten/export`)
  expect(csv).toContain('"Durchschnitt: 3";"2"')
  expect(csv).toContain('"Essen";"1";"50 %"')
  expect(csv).toContain('"4";"Freunde";"Essen";"Mehr Sitzplätze"')
  expect(csv).toContain('"2";"";"Musik, Programm";""')

  // Fremde sehen weder Verwaltung noch Export.
  expect((await guest.request.get(`/fragebogen/${survey.id}/verwalten/export`)).status()).toBe(404)
})

test('Einmal pro Gerät: zweite Abgabe ersetzt die erste, vorausgefüllt, andere Geräte zählen extra', async ({ browser }) => {
  const owner = await createAccount()
  const survey = await createSurvey(owner.id, STANDARD, { identity: 'COOKIE' })

  const guest = await visitor(browser)
  await guest.goto(`/fragebogen/${survey.id}`)
  await fillStandard(guest, { scale: '5', single: 'Plakat', multi: ['Essen'] })
  await expect(guest.getByText('Deine Antworten sind angekommen.')).toBeVisible()

  await guest.getByRole('link', { name: 'Antworten ansehen oder ändern' }).click()
  await expect(guest.getByText('Du hast schon geantwortet')).toBeVisible()
  await expect(guest.getByRole('radio', { name: 'Plakat' })).toBeChecked()
  await expect(guest.getByRole('checkbox', { name: 'Essen' })).toBeChecked()
  await guest.getByRole('checkbox', { name: 'Essen' }).uncheck()
  await guest.getByRole('checkbox', { name: 'Programm' }).check()
  await guest.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(guest.getByText('Deine Antworten sind angekommen.')).toBeVisible()

  const responses = await prisma.surveyResponse.findMany({ where: { surveyId: survey.id }, include: { answers: { include: { option: true } } } })
  expect(responses).toHaveLength(1)
  expect(responses[0].voterKey).toMatch(/^cookie:/)
  expect(responses[0].answers.flatMap(a => (a.option ? [a.option.label] : [])).sort()).toEqual(['Plakat', 'Programm'])
  expect(responses[0].answers.find(a => a.number !== null)?.number).toBe(5)

  const other = await visitor(browser)
  await other.goto(`/fragebogen/${survey.id}`)
  await fillStandard(other, { scale: '1' })
  await expect.poll(() => prisma.surveyResponse.count({ where: { surveyId: survey.id } })).toBe(2)
})

test('Beendet: Schließen und Schließdatum sperren das Ausfüllen, Wieder öffnen hebt es auf', async ({ page, browser }) => {
  const owner = await createAccount()
  const survey = await createSurvey(owner.id, STANDARD)
  const guest = await visitor(browser)
  await guest.goto(`/fragebogen/${survey.id}`)

  await login(page, owner.email)
  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  await page.getByRole('button', { name: 'Jetzt schließen' }).click()
  await expect(page.getByText('Fragebogen · beendet')).toBeVisible()

  // Formular war noch offen - die Abgabe kommt zu spät.
  await fillStandard(guest, { scale: '3' })
  await expect(guest.getByText('Dieser Fragebogen ist beendet')).toBeVisible()

  await page.getByRole('button', { name: 'Wieder öffnen' }).click()
  await expect(page.getByText('Fragebogen · offen')).toBeVisible()
  await prisma.survey.update({ where: { id: survey.id }, data: { closesAt: new Date(Date.now() - 60_000) } })
  await guest.goto(`/fragebogen/${survey.id}`)
  await expect(guest.getByText('Dieser Fragebogen ist beendet')).toBeVisible()
  expect(await prisma.surveyResponse.count({ where: { surveyId: survey.id } })).toBe(0)
})

test('Bearbeiten: Fragen bis zur ersten Antwort, danach nur Grunddaten; Antworten löschen gibt sie frei', async ({ page, browser }) => {
  const owner = await createAccount()
  const survey = await createSurvey(owner.id, [{ text: 'Alte Frage', kind: 'TEXT' }])
  await login(page, owner.email)

  await page.goto(`/fragebogen/${survey.id}/bearbeiten`)
  await page.getByLabel('Frage 1', { exact: true }).fill('Neue Frage')
  await page.getByLabel('Einmal pro Gerät').check()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible()
  const updated = await prisma.survey.findUniqueOrThrow({ where: { id: survey.id }, include: { questions: true } })
  expect(updated.identity).toBe('COOKIE')
  expect(updated.questions.map(q => q.text)).toEqual(['Neue Frage'])

  const guest = await visitor(browser)
  await guest.goto(`/fragebogen/${survey.id}`)
  await guest.getByLabel('Neue Frage').fill('Hallo')
  await guest.getByRole('button', { name: 'Absenden' }).click()
  await expect(guest.getByText('Danke!')).toBeVisible()

  await page.goto(`/fragebogen/${survey.id}/bearbeiten`)
  await expect(page.getByText('die Fragen lassen sich nicht mehr')).toBeVisible()
  await expect(page.getByLabel('Frage 1', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Anonym')).toBeDisabled()
  await page.getByLabel('Titel', { exact: true }).fill('Umbenannt')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible()
  const renamed = await prisma.survey.findUniqueOrThrow({ where: { id: survey.id }, include: { questions: true, _count: { select: { responses: true } } } })
  expect(renamed).toMatchObject({ title: 'Umbenannt', identity: 'COOKIE', _count: { responses: 1 } })
  expect(renamed.questions.map(q => q.text)).toEqual(['Neue Frage'])

  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Alle Antworten löschen' }).click()
  await expect(page.getByText('Alle Antworten gelöscht')).toBeVisible()
  await page.getByRole('link', { name: 'Bearbeiten' }).click()
  await expect(page.getByLabel('Frage 1', { exact: true })).toHaveValue('Neue Frage')
})

test('Berechtigungen: Fremde nicht, Freigabe darf verwalten, aber nicht löschen', async ({ page }) => {
  const owner = await createAccount()
  const stranger = await createAccount()
  const survey = await createSurvey(owner.id, STANDARD)

  await login(page, stranger.email)
  const denied = await page.goto(`/fragebogen/${survey.id}/verwalten`)
  expect(denied?.status()).toBe(404)

  await prisma.surveyAccess.create({ data: { surveyId: survey.id, userId: stranger.id } })
  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  await expect(page.getByText(`freigegeben von ${owner.email}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Teilen' })).toHaveCount(0)
  await page.goto('/meine-abstimmungen')
  await expect(page.getByTestId('poll-row').filter({ hasText: survey.title })).toContainText('freigegeben')
})

test('Einbetten: nur /einbetten mit erlaubten Seiten, alles andere bleibt uneinbettbar', async ({ request }) => {
  const owner = await createAccount()
  const survey = await createSurvey(owner.id, STANDARD)

  const embed = await request.get(`/fragebogen/${survey.id}/einbetten`)
  expect(embed.status()).toBe(200)
  // Ungültige Einträge aus EMBED_ALLOWED_ORIGINS (playwright.config.ts) fallen weg.
  expect(embed.headers()['content-security-policy']).toBe(`frame-ancestors 'self' ${EMBED_HOST} ${SAME_SITE_HOST} https://*.ramonroeser.de`)
  expect(embed.headers()['x-frame-options']).toBeUndefined()
  expect(embed.headers()['x-content-type-options']).toBe('nosniff')

  for (const path of [`/fragebogen/${survey.id}`, `/fragebogen/${survey.id}/verwalten`, `/fragebogen/${survey.id}/einbetten/x`, '/anmelden']) {
    const response = await request.get(path, { maxRedirects: 0 })
    expect(response.headers()['content-security-policy'], path).toBe("frame-ancestors 'none'")
    expect(response.headers()['x-frame-options'], path).toBe('DENY')
  }
})

// Die einbettenden Seiten kommen von echten kleinen Servern auf localhost (auf IPv4 und IPv6, je nachdem, wie der
// Browser localhost auflöst): Chromium lässt iFrames auf lokale Adressen nur aus Seiten zu, die selbst lokal sind -
// eine per page.route nur vorgetäuschte Seite gälte als öffentlich und würde gesperrt.
const hostPages = new Map<string, string>()
const hostServers: Server[] = []

test.beforeAll(async () => {
  for (const origin of [EMBED_HOST, FOREIGN_HOST, SAME_SITE_HOST]) {
    for (const address of new URL(origin).hostname === 'localhost' ? ['127.0.0.1', '::1'] : [new URL(origin).hostname]) {
      const server = createServer((req, res) => {
        const body = hostPages.get(`${origin}${req.url}`)
        res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' }).end(body ?? 'nicht gefunden')
      })
      await new Promise<void>((resolve, reject) => server.once('error', reject).listen(Number(new URL(origin).port), address, resolve))
      hostServers.push(server)
    }
  }
})

test.afterAll(async () => {
  await Promise.all(hostServers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

/** Öffnet unter `host` eine Seite, die `src` per iFrame einbettet und die gemeldete Höhe übernimmt (wie der Schnipsel). */
async function hostPage(page: Page, host: string, src: string) {
  const url = `${host}/feedback-${unique()}`
  hostPages.set(url, `<!doctype html><html><body>
      <iframe id="f" src="${src}" style="width:420px;height:200px;border:0"></iframe>
      <script>
        window.addEventListener('message', function (e) {
          if (e.origin !== '${new URL(BASE_URL).origin}' || !e.data || e.data.type !== 'abstimmungstool:hoehe') return;
          document.getElementById('f').style.height = e.data.height + 'px';
          document.body.dataset.height = e.data.height;
        });
      </script>
    </body></html>`)
  await page.goto(url)
}

test('Eingebettet in einer anderen Website: ohne Kopfzeile, anonym ausfüllbar, Höhe wird gemeldet', async ({ browser }) => {
  const owner = await createAccount()
  const survey = await createSurvey(owner.id, STANDARD, { thanksText: 'Danke aus dem iFrame' })
  const page = await visitor(browser)
  await hostPage(page, EMBED_HOST, `${BASE_URL}/fragebogen/${survey.id}/einbetten`)

  const frame = page.frameLocator('#f')
  await expect(frame.getByRole('heading', { name: survey.title })).toBeVisible()
  await expect(frame.getByRole('link', { name: 'Anmelden' })).toBeHidden()
  await expect(frame.getByRole('link', { name: 'Impressum' })).toBeHidden()
  // Die einbettende Seite hat die Höhe übernommen (deutlich mehr als die anfänglichen 200 px).
  await expect.poll(async () => Number(await page.locator('body').getAttribute('data-height'))).toBeGreaterThan(400)

  await scaleValue(frame, '4').click()
  await frame.getByRole('radio', { name: 'Instagram' }).check()
  await frame.getByRole('button', { name: 'Absenden' }).click()
  await expect(frame.getByText('Danke aus dem iFrame')).toBeVisible()
  await expect.poll(() => prisma.surveyResponse.count({ where: { surveyId: survey.id } })).toBe(1)
  // Nach dem Danke ist der Inhalt kürzer - auch das kommt an.
  await expect.poll(async () => Number(await page.locator('body').getAttribute('data-height'))).toBeLessThan(400)
})

test('Eingebettet, einmal pro Gerät, fremde Website: statt Formular ein Link in einen neuen Tab', async ({ browser }) => {
  const owner = await createAccount()
  const survey = await createSurvey(owner.id, STANDARD, { identity: 'COOKIE' })
  const page = await visitor(browser)
  await hostPage(page, EMBED_HOST, `${BASE_URL}/fragebogen/${survey.id}/einbetten`)

  const frame = page.frameLocator('#f')
  await expect(frame.getByTestId('cookie-blocked')).toBeVisible()
  await expect(frame.getByRole('button', { name: 'Absenden' })).toHaveCount(0)
  await expect(frame.getByRole('link', { name: /neuem Tab/ })).toHaveAttribute('href', `/fragebogen/${survey.id}`)
})

test('Eingebettet, einmal pro Gerät, App unter derselben Domain: Cookie klappt, Antwort lässt sich ändern', async ({ browser }) => {
  const owner = await createAccount()
  const survey = await createSurvey(owner.id, STANDARD, { identity: 'COOKIE' })
  const page = await visitor(browser)
  await hostPage(page, SAME_SITE_HOST, `${BASE_URL}/fragebogen/${survey.id}/einbetten`)

  const frame = page.frameLocator('#f')
  await expect(frame.getByText('Ohne Konto, eine Antwort pro Gerät.')).toBeVisible()
  await scaleValue(frame, '2').click()
  await frame.getByRole('button', { name: 'Absenden' }).click()
  await frame.getByRole('link', { name: 'Antworten ansehen oder ändern' }).click()
  await expect(frame.getByText('Du hast schon geantwortet')).toBeVisible()
  await scaleValue(frame, '5').click()
  await frame.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(frame.getByText('Deine Antworten sind angekommen.')).toBeVisible()

  const responses = await prisma.surveyResponse.findMany({ where: { surveyId: survey.id }, include: { answers: true } })
  expect(responses).toHaveLength(1)
  expect(responses[0].answers.map(a => a.number)).toEqual([5])
})

test('Nicht freigegebene Website und normale Seiten lassen sich nicht einbetten', async ({ browser }) => {
  const owner = await createAccount()
  const survey = await createSurvey(owner.id, STANDARD)
  const page = await visitor(browser)

  await hostPage(page, FOREIGN_HOST, `${BASE_URL}/fragebogen/${survey.id}/einbetten`)
  await expect(page.frameLocator('#f').getByRole('heading', { name: survey.title })).toHaveCount(0)

  await hostPage(page, EMBED_HOST, `${BASE_URL}/fragebogen/${survey.id}`)
  await expect(page.frameLocator('#f').getByRole('heading', { name: survey.title })).toHaveCount(0)
})

const GRID: QuestionSeed[] = [
  { text: 'Wie fandest du die Angebote?', kind: 'GRID_SINGLE', required: true },
  { text: 'An welchen Tagen warst du dabei?', kind: 'GRID_MULTI', required: true }
]

/** Raster-Fragebogen: Zeilen und Spalten als Optionen (isRow), wie ihn der Editor anlegt. */
async function createGridSurvey(ownerId: string, data: Partial<Prisma.SurveyUncheckedCreateInput> = {}) {
  const survey = await createSurvey(ownerId, GRID, data)
  const [rating, days] = survey.questions
  const add = (questionId: string, labels: string[], isRow: boolean) =>
    prisma.surveyOption.createMany({ data: labels.map((label, position) => ({ questionId, label, position, isRow })) })
  await add(rating.id, ['Rallye', 'Kneipentour', 'Stadtführung'], true)
  await add(rating.id, ['gut', 'okay', 'schlecht'], false)
  await add(days.id, ['Rallye', 'Kneipentour'], true)
  await add(days.id, ['Mo', 'Di', 'Mi'], false)
  return survey
}

test('Raster anlegen: Zeilen und Spalten im Editor, eine bzw. mehrere pro Zeile', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/fragebogen/neu')
  await page.getByLabel('Titel', { exact: true }).fill('Raster-Test')
  await page.getByLabel('Frage 1', { exact: true }).fill('Wie fandest du die Angebote?')
  await page.getByLabel('Art').selectOption('GRID_SINGLE')
  await page.getByLabel('Frage 1, Zeile 1', { exact: true }).fill('Rallye')
  await page.getByLabel('Frage 1, Zeile 2', { exact: true }).fill('Kneipentour')
  await page.getByRole('button', { name: '+ Zeile hinzufügen' }).click()
  await page.getByLabel('Frage 1, Zeile 3', { exact: true }).fill('Stadtführung')
  await page.getByLabel('Frage 1, Spalte 1', { exact: true }).fill('gut')
  await page.getByLabel('Frage 1, Spalte 2', { exact: true }).fill('schlecht')
  await page.getByRole('button', { name: '+ Spalte hinzufügen' }).click()
  await page.getByLabel('Frage 1, Spalte 3', { exact: true }).fill('okay')
  await page.getByRole('button', { name: 'Spalte 2 entfernen' }).click()
  await page.getByRole('button', { name: 'Fragebogen anlegen' }).click()
  await page.waitForURL(/\/fragebogen\/[^/]+\/verwalten\?angelegt=1/)

  const id = new URL(page.url()).pathname.split('/')[2]
  const [question] = await prisma.surveyQuestion.findMany({ where: { surveyId: id }, include: { options: { orderBy: { position: 'asc' } } } })
  expect(question.kind).toBe('GRID_SINGLE')
  expect(question.options.filter(o => o.isRow).map(o => o.label)).toEqual(['Rallye', 'Kneipentour', 'Stadtführung'])
  expect(question.options.filter(o => !o.isRow).map(o => o.label)).toEqual(['gut', 'okay'])

  // Bearbeiten lädt Zeilen und Spalten wieder in den Editor.
  await page.getByRole('link', { name: 'Bearbeiten' }).click()
  await expect(page.getByLabel('Frage 1, Zeile 3', { exact: true })).toHaveValue('Stadtführung')
  await expect(page.getByLabel('Frage 1, Spalte 2', { exact: true })).toHaveValue('okay')
})

test('Raster am Handy: Block je Zeile mit Knöpfen, Pflicht je Zeile, Antworten landen pro Zeile', async ({ browser }) => {
  const owner = await createAccount()
  const survey = await createGridSurvey(owner.id)
  const context = await browser.newContext({ locale: 'de-DE', viewport: { width: 375, height: 800 }, extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  const page = await context.newPage()
  await page.goto(`/fragebogen/${survey.id}`)

  const rating = page.getByRole('radiogroup', { name: 'Kneipentour' })
  // Knöpfe statt Tabelle: kein Spaltenkopf, Spaltennamen sichtbar, kein waagrechtes Scrollen.
  await expect(rating.getByText('schlecht')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.getByRole('radiogroup', { name: 'Rallye' }).getByText('gut').click()
  await rating.getByText('okay').click()
  await expect(rating.getByRole('radio', { name: 'okay' })).toBeChecked()
  await page.getByRole('group', { name: 'Rallye' }).getByText('Mo').click()
  await page.getByRole('group', { name: 'Rallye' }).getByText('Mi').click()
  await page.getByRole('group', { name: 'Kneipentour' }).getByText('Di').click()

  // Stadtführung fehlt noch: der Browser hält das Formular an.
  await page.getByRole('button', { name: 'Absenden' }).click()
  await expect(page).toHaveURL(new RegExp(`/fragebogen/${survey.id}$`))
  await page.getByRole('radiogroup', { name: 'Stadtführung' }).getByText('schlecht').click()
  // Ein Tag-Kreuz wieder weg: die Zeile ist leer, die Pflicht greift auch bei mehreren pro Zeile.
  await page.getByRole('group', { name: 'Kneipentour' }).getByText('Di').click()
  await page.getByRole('button', { name: 'Absenden' }).click()
  await expect(page).toHaveURL(new RegExp(`/fragebogen/${survey.id}$`))
  await page.getByRole('group', { name: 'Kneipentour' }).getByText('Di').click()
  await page.getByRole('button', { name: 'Absenden' }).click()
  await expect(page.getByText('Danke!')).toBeVisible()

  const answers = await prisma.surveyAnswer.findMany({ where: { response: { surveyId: survey.id } }, include: { row: true, option: true } })
  expect(answers.map(a => `${a.row?.label}: ${a.option?.label}`).sort()).toEqual(
    ['Kneipentour: Di', 'Kneipentour: okay', 'Rallye: Mi', 'Rallye: Mo', 'Rallye: gut', 'Stadtführung: schlecht']
  )
  await context.close()
})

test('Raster am Desktop: Tabelle mit Spaltenköpfen, ohne JS-Prüfung serverseitig abgelehnt, Auswertung und CSV', async ({ page, browser }) => {
  const owner = await createAccount()
  const survey = await createGridSurvey(owner.id, { identity: 'COOKIE' })
  const guest = await visitor(browser)
  await guest.setViewportSize({ width: 1100, height: 900 })
  await guest.goto(`/fragebogen/${survey.id}`)

  // Echte Radiobuttons in der Tabelle, Spaltennamen nur als Kopf (in der Zelle nur für Screenreader, 1 px).
  const row = guest.getByRole('radiogroup', { name: 'Rallye' })
  await expect(row.getByRole('radio', { name: 'gut' })).toBeVisible()
  expect((await row.getByText('gut').boundingBox())?.width).toBeLessThanOrEqual(1)

  // Ohne Browser-Prüfung abgeschickt: fehlende Zeilen lehnt der Server ab.
  await guest.evaluate(() => document.querySelectorAll('form').forEach(f => f.setAttribute('novalidate', '')))
  await row.getByRole('radio', { name: 'gut' }).check()
  await guest.getByRole('button', { name: 'Absenden' }).click()
  await expect(guest.getByText('Bitte beantworte alle Pflichtfragen')).toBeVisible()

  for (const [name, column] of [['Rallye', 'gut'], ['Kneipentour', 'gut'], ['Stadtführung', 'schlecht']]) {
    await guest.getByRole('radiogroup', { name }).getByRole('radio', { name: column }).check()
  }
  await guest.getByRole('group', { name: 'Rallye' }).getByRole('checkbox', { name: 'Mo' }).check()
  await guest.getByRole('group', { name: 'Kneipentour' }).getByRole('checkbox', { name: 'Mo' }).check()
  await guest.getByRole('group', { name: 'Kneipentour' }).getByRole('checkbox', { name: 'Mi' }).check()
  await guest.getByRole('button', { name: 'Absenden' }).click()
  await expect(guest.getByText('Deine Antworten sind angekommen.')).toBeVisible()

  // Einmal pro Gerät: vorausgefüllt, auch im Raster.
  await guest.getByRole('link', { name: 'Antworten ansehen oder ändern' }).click()
  await expect(guest.getByRole('radiogroup', { name: 'Stadtführung' }).getByRole('radio', { name: 'schlecht' })).toBeChecked()
  await expect(guest.getByRole('group', { name: 'Kneipentour' }).getByRole('checkbox', { name: 'Mi' })).toBeChecked()

  await login(page, owner.email)
  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  const grid = page.getByTestId('survey-result').first()
  await expect(grid.getByRole('row', { name: /Rallye/ })).toContainText('1 · 100%')
  await expect(grid.getByRole('row', { name: /Stadtführung/ }).getByRole('cell').nth(2)).toContainText('1 · 100%')

  const csv = await page.evaluate(async url => (await fetch(url)).text(), `/fragebogen/${survey.id}/verwalten/export`)
  expect(csv).toContain('"Kneipentour: gut";"1";"100 %"')
  expect(csv).toContain('"Rallye: gut; Kneipentour: gut; Stadtführung: schlecht";"Rallye: Mo; Kneipentour: Mo, Mi"')
})

/**
 * Fragebogen mit Überschrift, einer normalen Skala und einem UEQ-S-Ausschnitt: zwei Skalen-Raster mit ausgeblendetem
 * Titel (Gegensatzpaare), dazu ein Skalen-Raster mit Aussagen.
 */
async function createBlockSurvey(ownerId: string, data: Partial<Prisma.SurveyUncheckedCreateInput> = {}) {
  const pair = (list: [string, string][]) => ({ create: list.map(([label, labelRight], position) => ({ label, labelRight, position, isRow: true })) })
  return prisma.survey.create({
    data: {
      title: `UEQ ${unique()}`, ownerId, ...data,
      questions: {
        create: [
          { position: 0, kind: 'INFO', text: 'Teil 1: Dein Eindruck', hint: 'Bitte bewerte anhand der Gegensatzpaare.' },
          { position: 1, kind: 'SCALE_GRID', text: 'UEQ-S: Pragmatische Qualität', hideTitle: true, required: true, scaleMin: 1, scaleMax: 7, options: pair([['behindernd', 'unterstützend'], ['kompliziert', 'einfach']]) },
          { position: 2, kind: 'SCALE_GRID', text: 'UEQ-S: Hedonische Qualität', hideTitle: true, scaleMin: 1, scaleMax: 7, options: pair([['langweilig', 'spannend']]) },
          { position: 3, kind: 'INFO', text: '', hint: 'Jetzt noch ein paar Aussagen.' },
          {
            position: 4, kind: 'SCALE_GRID', text: 'Wie sehr stimmst du zu?', scaleMin: 1, scaleMax: 5, minLabel: 'gar nicht', maxLabel: 'voll',
            options: { create: ['Die App war hilfreich.', 'Ich nutze sie weiter.'].map((label, position) => ({ label, position, isRow: true })) }
          },
          { position: 5, kind: 'TEXT', text: 'Sonst noch was?' }
        ]
      }
    }
  })
}

/** Skalenknopf `value` in der Zeile `row` (Gruppe nach "links ↔ rechts" bzw. Aussage benannt) - der sichtbare Knopf. */
function scaleRowButton(page: Page, row: string, value: string) {
  return page.getByRole('radiogroup', { name: row, exact: true }).locator('label').filter({ has: page.getByRole('radio', { name: new RegExp(`^${value}( |$)`) }) })
}

test('Editor: Überschrift/Text, Titel ausblenden und UEQ-S einfügen', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/fragebogen/neu')
  await page.getByLabel('Titel', { exact: true }).fill('Mit Blöcken')
  // UEQ-S ersetzt die noch leere erste Frage.
  await page.getByRole('button', { name: '+ UEQ-S einfügen' }).click()
  await expect(page.getByTestId('survey-question')).toHaveCount(3)
  await page.getByRole('button', { name: '+ Überschrift / Text' }).click()
  await page.getByLabel('Überschrift 4', { exact: true }).fill('Zum Schluss')
  await page.getByRole('button', { name: '+ Weitere Frage' }).click()
  await page.getByLabel('Frage 5', { exact: true }).fill('Lieblingsfunktion?')
  await page.getByLabel('Art').nth(4).selectOption('TEXT')
  await page.getByLabel('Titel ausblenden').nth(2).check()
  await page.getByRole('button', { name: 'Fragebogen anlegen' }).click()
  await page.waitForURL(/\/fragebogen\/[^/]+\/verwalten\?angelegt=1/)

  const id = new URL(page.url()).pathname.split('/')[2]
  const questions = await prisma.surveyQuestion.findMany({ where: { surveyId: id }, orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } })
  expect(questions.map(q => [q.kind, q.hideTitle])).toEqual([['INFO', false], ['SCALE_GRID', true], ['SCALE_GRID', true], ['INFO', false], ['TEXT', true]])
  expect(questions[1]).toMatchObject({ text: 'UEQ-S: Pragmatische Qualität', scaleMin: 1, scaleMax: 7 })
  expect(questions[1].options.map(o => `${o.label}|${o.labelRight}`)).toEqual(['behindernd|unterstützend', 'kompliziert|einfach', 'ineffizient|effizient', 'verwirrend|übersichtlich'])
  expect(questions[2].options.map(o => o.labelRight)).toEqual(['spannend', 'interessant', 'originell', 'neuartig'])
  expect(questions[3]).toMatchObject({ text: 'Zum Schluss', hint: null })

  // Bearbeiten lädt alles wieder in den Editor.
  await page.getByRole('link', { name: 'Bearbeiten' }).click()
  await expect(page.getByLabel('Frage 2, Zeile 2, rechts')).toHaveValue('einfach')
  await expect(page.getByLabel('Titel ausblenden').nth(0)).toBeChecked()
  await expect(page.getByLabel('Überschrift 4', { exact: true })).toHaveValue('Zum Schluss')
})

test('Blöcke am Handy: Überschrift, Nummern ohne Lücken, Gegensatzpaare als Block je Zeile, Pflicht je Zeile', async ({ browser }) => {
  const owner = await createAccount()
  const survey = await createBlockSurvey(owner.id)
  const context = await browser.newContext({ locale: 'de-DE', viewport: { width: 375, height: 800 }, extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  const page = await context.newPage()
  await page.goto(`/fragebogen/${survey.id}`)

  // Die Überschrift über den Fragen mit ausgeblendetem Titel ist deren Titel und trägt die Nummer; der reine
  // Text-Block danach bleibt ohne Nummer, die Zählung läuft ohne Lücke weiter.
  await expect(page.getByRole('heading', { name: '1. Teil 1: Dein Eindruck' })).toBeVisible()
  await expect(page.getByText('Jetzt noch ein paar Aussagen.')).toBeVisible()
  expect((await page.getByText('UEQ-S: Pragmatische Qualität').boundingBox())?.width).toBeLessThanOrEqual(1)
  await expect(page.getByText('2. Wie sehr stimmst du zu?')).toBeVisible()
  await expect(page.getByText('3. Sonst noch was?')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // Am Handy stehen beide Begriffe über den Knöpfen.
  const row = page.getByRole('radiogroup', { name: 'kompliziert ↔ einfach' })
  const [left, right, button] = await Promise.all([row.getByText('kompliziert').boundingBox(), row.getByText('einfach').boundingBox(), scaleRowButton(page, 'kompliziert ↔ einfach', '4').boundingBox()])
  expect(left!.y + left!.height).toBeLessThanOrEqual(button!.y)
  expect(right!.x).toBeGreaterThan(left!.x)

  await scaleRowButton(page, 'behindernd ↔ unterstützend', '6').click()
  await scaleRowButton(page, 'Die App war hilfreich.', '5').click()
  // "kompliziert ↔ einfach" fehlt noch (Pflicht je Zeile): der Browser hält an.
  await page.getByRole('button', { name: 'Absenden' }).click()
  await expect(page).toHaveURL(new RegExp(`/fragebogen/${survey.id}$`))
  await scaleRowButton(page, 'kompliziert ↔ einfach', '2').click()
  await page.getByRole('button', { name: 'Absenden' }).click()
  await expect(page.getByText('Danke!')).toBeVisible()

  const answers = await prisma.surveyAnswer.findMany({ where: { response: { surveyId: survey.id } }, include: { row: true } })
  expect(answers.map(a => `${a.row?.label}=${a.number}`).sort()).toEqual(['Die App war hilfreich.=5', 'behindernd=6', 'kompliziert=2'])
  await context.close()
})

test('Blöcke am Desktop: Gegensatzpaar links | Knöpfe | rechts, serverseitige Pflicht, Auswertung zentriert und CSV je Zeile', async ({ page, browser }) => {
  const owner = await createAccount()
  const survey = await createBlockSurvey(owner.id)
  const guest = await visitor(browser)
  await guest.setViewportSize({ width: 1100, height: 900 })
  await guest.goto(`/fragebogen/${survey.id}`)

  const row = guest.getByRole('radiogroup', { name: 'kompliziert ↔ einfach' })
  const [left, right, first, last] = await Promise.all([
    row.getByText('kompliziert').boundingBox(), row.getByText('einfach').boundingBox(),
    scaleRowButton(guest, 'kompliziert ↔ einfach', '1').boundingBox(), scaleRowButton(guest, 'kompliziert ↔ einfach', '7').boundingBox()
  ])
  expect(left!.x + left!.width).toBeLessThanOrEqual(first!.x)
  expect(right!.x).toBeGreaterThanOrEqual(last!.x + last!.width)
  // Die Knöpfe aller Gegensatzpaare stehen genau untereinander.
  const other = await scaleRowButton(guest, 'langweilig ↔ spannend', '1').boundingBox()
  expect(Math.abs(other!.x - first!.x)).toBeLessThan(1)

  // Ohne Browser-Prüfung: fehlende Pflichtzeile lehnt der Server ab.
  await guest.evaluate(() => document.querySelectorAll('form').forEach(f => f.setAttribute('novalidate', '')))
  await scaleRowButton(guest, 'behindernd ↔ unterstützend', '7').click()
  await guest.getByRole('button', { name: 'Absenden' }).click()
  await expect(guest.getByText('Bitte beantworte alle Pflichtfragen')).toBeVisible()

  await scaleRowButton(guest, 'behindernd ↔ unterstützend', '7').click()
  await scaleRowButton(guest, 'kompliziert ↔ einfach', '4').click()
  await scaleRowButton(guest, 'langweilig ↔ spannend', '1').click()
  await guest.getByRole('button', { name: 'Absenden' }).click()
  await expect(guest.getByText('Danke!')).toBeVisible()

  const second = await visitor(browser)
  await second.goto(`/fragebogen/${survey.id}`)
  await scaleRowButton(second, 'behindernd ↔ unterstützend', '5').click()
  await scaleRowButton(second, 'kompliziert ↔ einfach', '6').click()
  await second.getByRole('button', { name: 'Absenden' }).click()
  await expect(second.getByText('Danke!')).toBeVisible()

  await login(page, owner.email)
  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  await expect(page.getByTestId('survey-result-info').first()).toContainText('1. Teil 1: Dein Eindruck')
  const pragmatic = page.getByTestId('survey-result').first()
  await expect(pragmatic).toContainText('1. UEQ-S: Pragmatische Qualität')
  // (7 + 4 + 5 + 6) / 4 = 5,5, Mitte 4 -> +1,5.
  await expect(pragmatic).toContainText('Gesamt: Durchschnitt 5,5 · zentriert +1,5')
  await expect(pragmatic.getByRole('row', { name: /behindernd ↔ unterstützend/ })).toContainText('6')
  await expect(pragmatic.getByRole('row', { name: /behindernd ↔ unterstützend/ })).toContainText('+2')
  await expect(page.getByTestId('survey-result').nth(1)).toContainText('zentriert −3')

  const csv = await page.evaluate(async url => (await fetch(url)).text(), `/fragebogen/${survey.id}/verwalten/export`)
  // Beide UEQ-S-Skalen tragen die Nummer ihrer Überschrift.
  expect(csv).toContain('"1. UEQ-S: Pragmatische Qualität: behindernd ↔ unterstützend";"1. UEQ-S: Pragmatische Qualität: kompliziert ↔ einfach";"1. UEQ-S: Hedonische Qualität: langweilig ↔ spannend";"2. Wie sehr stimmst du zu?: Die App war hilfreich."')
  expect(csv).toContain('"7";"4";"1";"";"";""')
  expect(csv).toContain('"Gesamt: Durchschnitt 5,5 (zentriert 1,5)";"4"')
  expect(csv).not.toContain('Teil 1: Dein Eindruck')
})

test('Nummern ausschalten: keine Nummern beim Ausfüllen, in der Auswertung und im CSV', async ({ page, browser }) => {
  const owner = await createAccount()
  const survey = await createBlockSurvey(owner.id)
  await login(page, owner.email)
  await page.goto(`/fragebogen/${survey.id}/bearbeiten`)
  await expect(page.getByLabel('Fragen nummerieren')).toBeChecked()
  await page.getByLabel('Fragen nummerieren').uncheck()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible()
  expect((await prisma.survey.findUniqueOrThrow({ where: { id: survey.id } })).numbered).toBe(false)

  const guest = await visitor(browser)
  await guest.goto(`/fragebogen/${survey.id}`)
  await expect(guest.getByRole('heading', { name: 'Teil 1: Dein Eindruck', exact: true })).toBeVisible()
  await expect(guest.getByText('Wie sehr stimmst du zu?', { exact: true })).toBeVisible()
  await expect(guest.getByText(/^\d+\. /)).toHaveCount(0)

  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  await expect(page.getByTestId('survey-result').first().getByRole('heading')).toHaveText(/^UEQ-S: Pragmatische Qualität/)
  const csv = await page.evaluate(async url => (await fetch(url)).text(), `/fragebogen/${survey.id}/verwalten/export`)
  expect(csv).toContain('"UEQ-S: Pragmatische Qualität: behindernd ↔ unterstützend"')
})

test('Editor warnt, wenn eine Frage ohne Titel an eine andere Frage anschließt', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/fragebogen/neu')
  await page.getByLabel('Frage 1', { exact: true }).fill('Erste Frage')
  await page.getByRole('button', { name: '+ Weitere Frage' }).click()
  await page.getByLabel('Frage 2', { exact: true }).fill('Zweite Frage')
  await page.getByLabel('Titel ausblenden').nth(1).check()
  await expect(page.getByTestId('hidden-title-warning')).toContainText('Wird an Frage 1 angehängt')

  // Mit einem Hinweis steht die Frage für sich - keine Warnung.
  await page.getByLabel('Frage 2, Hinweis').fill('Bitte jede Zeile bewerten')
  await expect(page.getByTestId('hidden-title-warning')).toHaveCount(0)
  await page.getByLabel('Frage 2, Hinweis').fill('')

  // Unter einer Überschrift ist es gewollt: die Überschrift bekommt die Nummer.
  await page.getByRole('button', { name: '+ Überschrift / Text' }).click()
  await page.getByLabel('Überschrift 3', { exact: true }).fill('Dein Eindruck')
  await page.getByRole('button', { name: 'nach oben' }).nth(2).click()
  await expect(page.getByTestId('hidden-title-warning')).toHaveCount(0)
  await expect(page.getByText('gehört zur Überschrift in Block 2')).toBeVisible()
})
