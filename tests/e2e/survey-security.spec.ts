import { createHash } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { BASE_URL, createAccount, login, prisma, unique, uniqueIp } from './helpers'

// Angriffe auf Fragebögen (docs/KONZEPT-FRAGEBOGEN.md, "Schutz vor Manipulation"): Abgaben per Skript ohne Browser,
// Replay, gefälschte Tokens, Lockfeld, Riesen-Anfragen, gefälschte Header, IPv6-Adresswechsel, manipulierte Felder,
// XSS/CSV-Injection und Zugriff auf fremde Fragebögen über manipulierte versteckte Felder (IDOR).

async function createTarget(ownerId: string, data: { identity?: 'ANONYMOUS' | 'COOKIE'; closedAt?: Date } = {}) {
  return prisma.survey.create({
    data: {
      title: `Ziel ${unique()}`, ownerId, ...data,
      questions: {
        create: [
          { position: 0, kind: 'SINGLE', text: 'Einfach', options: { create: ['A', 'B'].map((label, position) => ({ label, position })) } },
          { position: 1, kind: 'TEXT', text: 'Freitext' },
          { position: 2, kind: 'SCALE_GRID', text: 'Skala', scaleMin: 1, scaleMax: 5, options: { create: [{ label: 'Zeile', position: 0, isRow: true }] } }
        ]
      }
    },
    include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } } }
  })
}

type Target = Awaited<ReturnType<typeof createTarget>>

/** Was ein Skript aus der Seite liest: Aktions-ID und Einmal-Token. */
async function scrape(request: APIRequestContext, surveyId: string) {
  const html = await (await request.get(`/fragebogen/${surveyId}`)).text()
  const action = /name="(\$ACTION_ID_[a-f0-9]+)"/.exec(html)?.[1]
  const token = /name="formToken" value="([^"]+)"/.exec(html)?.[1]
  expect(action, 'Aktions-ID in der Seite').toBeTruthy()
  expect(token, 'Token in der Seite').toBeTruthy()
  return { action: action!, token: token! }
}

/** Abgabe wie ein Skript: multipart-POST ohne Browser, liefert Status und Ziel der Weiterleitung. */
async function scriptedSubmit(request: APIRequestContext, survey: Target, fields: Record<string, string>, opts: { action?: string; token?: string | null; headers?: Record<string, string> } = {}) {
  const scraped = opts.action && opts.token !== undefined ? { action: opts.action, token: opts.token } : await scrape(request, survey.id)
  const multipart: Record<string, string> = { [scraped.action]: '', surveyId: survey.id, ...fields }
  if (scraped.token !== null) multipart.formToken = scraped.token
  const response = await request.post(`/fragebogen/${survey.id}`, {
    multipart, maxRedirects: 0, headers: { Origin: new URL(BASE_URL).origin, ...opts.headers }
  })
  return { status: response.status(), location: response.headers().location ?? '', ...scraped }
}

const responsesOf = (surveyId: string) => prisma.surveyResponse.count({ where: { surveyId } })

test('Skript ohne Browser: ein Token gilt genau einmal, ohne, gefälscht oder von einem anderen Fragebogen nie', async ({ playwright }) => {
  const owner = await createAccount()
  const survey = await createTarget(owner.id)
  const other = await createTarget(owner.id)
  const request = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  const a = survey.questions[0].options[0].id

  const first = await scriptedSubmit(request, survey, { [`q_${survey.questions[0].id}`]: a })
  expect(first.status).toBe(303)
  expect(first.location).toContain('danke=1')
  // Dasselbe Token noch einmal (Replay): abgelehnt.
  const replay = await scriptedSubmit(request, survey, { [`q_${survey.questions[0].id}`]: a }, { action: first.action, token: first.token })
  expect(replay.location).toContain('hinweis=ungueltig')
  // Ohne Token, mit gefälschter Signatur, mit dem Token eines anderen Fragebogens: abgelehnt.
  const missing = await scriptedSubmit(request, survey, { [`q_${survey.questions[0].id}`]: a }, { action: first.action, token: null })
  expect(missing.location).toContain('hinweis=ungueltig')
  const [issued, nonce] = first.token!.split('.')
  const forged = await scriptedSubmit(request, survey, { [`q_${survey.questions[0].id}`]: a }, { action: first.action, token: `${issued}.${nonce}x.AAAA` })
  expect(forged.location).toContain('hinweis=ungueltig')
  const foreign = await scrape(request, other.id)
  const crossed = await scriptedSubmit(request, survey, { [`q_${survey.questions[0].id}`]: a }, { action: first.action, token: foreign.token })
  expect(crossed.location).toContain('hinweis=ungueltig')
  // Zeitpunkt im Token verändert (z.B. um die Mindestzeit zu umgehen): Signatur passt nicht mehr, abgelehnt.
  const old = `${Date.now() - 21 * 3600_000}.${nonce}.${first.token!.split('.')[2]}`
  expect((await scriptedSubmit(request, survey, { [`q_${survey.questions[0].id}`]: a }, { action: first.action, token: old })).location).toContain('hinweis=ungueltig')

  expect(await responsesOf(survey.id)).toBe(1)
  await request.dispose()
})

test('Lockfeld: ausgefüllt sieht es für den Bot wie Erfolg aus, gespeichert wird nichts', async ({ playwright }) => {
  const owner = await createAccount()
  const survey = await createTarget(owner.id)
  const request = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  const result = await scriptedSubmit(request, survey, { [`q_${survey.questions[0].id}`]: survey.questions[0].options[0].id, website: 'http://spam.example' })
  expect(result.location).toContain('danke=1')
  expect(await responsesOf(survey.id)).toBe(0)
  await request.dispose()
})

test('Manipulierte Felder: fremde Optionen, unzulässige Werte, überlange Texte, geschlossener Fragebogen', async ({ playwright }) => {
  const owner = await createAccount()
  const survey = await createTarget(owner.id)
  const foreign = await createTarget(owner.id)
  const request = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  const [single, text, grid] = survey.questions
  const field = (q: Target['questions'][number], row?: string) => `q_${q.id}${row ? `_${row}` : ''}`
  const row = grid.options[0].id

  // Skalenwert außerhalb, negativ, Ausweich-Antwort ohne Ausweich-Option, Kommazahl: abgelehnt. (Zwei Werte für eine
  // Einfachauswahl prüft der Browser-Test darunter - ein multipart-Objekt kann keinen Schlüssel doppelt enthalten.)
  expect((await scriptedSubmit(request, survey, { [field(grid, row)]: '9' })).location).toContain('hinweis=auswahl')
  expect((await scriptedSubmit(request, survey, { [field(grid, row)]: '-1' })).location).toContain('hinweis=auswahl')
  expect((await scriptedSubmit(request, survey, { [field(grid, row)]: 'x' })).location).toContain('hinweis=auswahl')
  expect((await scriptedSubmit(request, survey, { [field(grid, row)]: '3.5' })).location).toContain('hinweis=auswahl')
  // Option eines anderen Fragebogens bzw. einer anderen Frage: wird ignoriert, nicht gespeichert.
  await scriptedSubmit(request, survey, { [field(single)]: foreign.questions[0].options[0].id, [field(text)]: 'mit fremder Option' })
  // Überlanger Text wird gekürzt (einzeiliger Freitext höchstens 300 Zeichen).
  await scriptedSubmit(request, survey, { [field(text)]: 'Z'.repeat(5000) })

  const answers = await prisma.surveyAnswer.findMany({ where: { response: { surveyId: survey.id } } })
  expect(answers.some(a => a.optionId === foreign.questions[0].options[0].id)).toBe(false)
  expect(answers.every(a => (a.text ?? '').length <= 300)).toBe(true)
  expect(answers.find(a => a.text?.startsWith('ZZZ'))?.text).toHaveLength(300)

  // Geschlossen: auch ein frisches Token hilft nicht.
  const scraped = await scrape(request, survey.id)
  await prisma.survey.update({ where: { id: survey.id }, data: { closedAt: new Date() } })
  const before = await responsesOf(survey.id)
  expect((await scriptedSubmit(request, survey, { [field(text)]: 'zu spät' }, scraped)).location).toContain('hinweis=geschlossen')
  expect(await responsesOf(survey.id)).toBe(before)
  await request.dispose()
})

test('Zwei Werte für eine Einfachauswahl (mehrfaches Feld) werden abgelehnt', async ({ page }) => {
  const owner = await createAccount()
  const survey = await createTarget(owner.id)
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await page.goto(`/fragebogen/${survey.id}`)
  // Im Browser: ein zweites Feld mit demselben Namen untergeschoben.
  await page.evaluate(([name, value]) => {
    const extra = document.createElement('input')
    extra.type = 'hidden'; extra.name = name; extra.value = value
    document.querySelector('form')!.appendChild(extra)
  }, [`q_${survey.questions[0].id}`, survey.questions[0].options[1].id])
  await page.getByRole('radio', { name: 'A' }).check()
  await page.getByRole('button', { name: 'Absenden' }).click()
  await expect(page.getByText('Bei einer Frage passt die Auswahl nicht')).toBeVisible()
  expect(await responsesOf(survey.id)).toBe(0)
})

test('Riesen-Anfrage (über 512 KB) wird abgewiesen, bevor sie verarbeitet wird', async ({ playwright }) => {
  const owner = await createAccount()
  const survey = await createTarget(owner.id)
  const request = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  const result = await scriptedSubmit(request, survey, { [`q_${survey.questions[1].id}`]: 'x'.repeat(600 * 1024) })
  expect(result.status).toBe(413)
  expect(await responsesOf(survey.id)).toBe(0)
  await request.dispose()
})

test('Drosselung: IPv6-Adressen eines /64-Netzes zählen gemeinsam, gefälschte vordere X-Forwarded-For-Einträge nie', async ({ playwright }) => {
  const owner = await createAccount()
  const survey = await createTarget(owner.id)
  const prefix = `2001:db8:${(Date.now() % 65536).toString(16)}:${Math.floor(Math.random() * 65536).toString(16)}`
  const key = (ip: string) => createHash('sha256').update(`survey:ip\u0000${survey.id}\u0000${ip}`).digest('hex')
  // Drei verschiedene Adressen desselben /64 (ausgeschrieben, mit '::' gekürzt, groß geschrieben), davor jeweils ein
  // gefälschter Eintrag - gezählt wird nur der letzte (vom Proxy gesetzte) und nur als Netz.
  for (const address of [`${prefix}:0:0:0:1`, `${prefix}::dead:beef`, `${prefix}:FFFF:FFFF:FFFF:FFFF`.toUpperCase()]) {
    const request = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': `203.0.113.66, ${address}` } })
    const res = await scriptedSubmit(request, survey, { [`q_${survey.questions[1].id}`]: 'v6' })
    expect(res.location).toContain('danke=1')
    await request.dispose()
  }
  const bucket = `${prefix.split(':').map(g => g.replace(/^0+(?=.)/, '')).join(':')}::/64`
  expect((await prisma.loginThrottle.findUnique({ where: { key: key(bucket) } }))?.count).toBe(3)
  expect(await prisma.loginThrottle.findUnique({ where: { key: key('203.0.113.66') } })).toBeNull()
})

test('XSS und CSV-Injection: Texte erscheinen in der Verwaltung als Text, Formeln im CSV entschärft', async ({ page, playwright }) => {
  const owner = await createAccount()
  const survey = await createTarget(owner.id)
  const request = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  const payload = '=HYPERLINK("http://evil.example","klick")<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>'
  await scriptedSubmit(request, survey, { [`q_${survey.questions[1].id}`]: payload })
  await request.dispose()

  let dialog = false
  page.on('dialog', d => { dialog = true; d.dismiss() })
  await login(page, owner.email)
  await page.goto(`/fragebogen/${survey.id}/verwalten`)
  await expect(page.getByTestId('survey-result').nth(1)).toContainText('<script>window.__xss=2</script>')
  await page.getByTestId('response-list').locator('summary').click()
  await expect(page.getByTestId('response-list')).toContainText('onerror')
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  expect(await page.locator('img[src="x"]').count()).toBe(0)
  expect(dialog).toBe(false)

  const csv = await page.evaluate(async url => (await fetch(url)).text(), `/fragebogen/${survey.id}/verwalten/export`)
  expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""klick"")`)
  expect(csv).not.toMatch(/;"=HYPERLINK/)
})

test('Manipulierte URL-Parameter: hinweis und lang nur mit festen Werten', async ({ page }) => {
  const owner = await createAccount()
  const survey = await createTarget(owner.id)
  for (const hinweis of ['__proto__', 'constructor', 'toString', '<script>alert(1)</script>']) {
    const response = await page.goto(`/fragebogen/${survey.id}?hinweis=${encodeURIComponent(hinweis)}&lang=${encodeURIComponent('"><script>alert(1)</script>')}`)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Absenden' })).toBeVisible()
  }
})

/** Setzt alle versteckten surveyId-Felder der Seite auf `id` - wie jemand, der in den Entwicklertools herumspielt. */
async function retarget(page: Page, id: string) {
  await page.evaluate(target => document.querySelectorAll<HTMLInputElement>('input[name="surveyId"]').forEach(i => { i.value = target }), id)
}

test('IDOR: manipulierte surveyId in allen Verwaltungs-Formularen ändert fremde Fragebögen nie', async ({ page, playwright }) => {
  const victimOwner = await createAccount()
  const attacker = await createAccount()
  const victim = await createTarget(victimOwner.id)
  const own = await createTarget(attacker.id)
  const request = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  await scriptedSubmit(request, victim, { [`q_${victim.questions[1].id}`]: 'Antwort des Opfers' })
  await scriptedSubmit(request, own, { [`q_${own.questions[1].id}`]: 'eigene Antwort' })
  await request.dispose()
  const victimResponse = await prisma.surveyResponse.findFirstOrThrow({ where: { surveyId: victim.id } })

  page.on('dialog', d => d.accept())
  await login(page, attacker.email)

  // Bearbeiten: Titel und Fragen des Opfers überschreiben.
  await page.goto(`/fragebogen/${own.id}/bearbeiten`)
  await retarget(page, victim.id)
  await page.getByLabel('Titel', { exact: true }).fill('GEHACKT')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await page.waitForLoadState('networkidle')

  // Schließen, Teilen, eine Abgabe des Opfers löschen, alle Antworten löschen, Fragebogen löschen.
  for (const [button, prepare] of [
    ['Jetzt schließen', null],
    ['Teilen', async () => page.getByPlaceholder('E-Mail-Adresse eines Kontos').fill(attacker.email)],
    ['löschen', async () => {
      await page.getByTestId('response-list').locator('summary').click()
      await page.evaluate(id => document.querySelectorAll<HTMLInputElement>('input[name="responseId"]').forEach(i => { i.value = id }), victimResponse.id)
    }],
    ['Alle Antworten löschen', null],
    ['Löschen', null]
  ] as const) {
    await page.goto(`/fragebogen/${own.id}/verwalten`)
    if (prepare) await prepare()
    await retarget(page, victim.id)
    await page.getByRole('button', { name: button, exact: true }).first().click()
    await page.waitForLoadState('networkidle')
  }

  const after = await prisma.survey.findUniqueOrThrow({ where: { id: victim.id }, include: { access: true, _count: { select: { responses: true, questions: true } } } })
  expect(after).toMatchObject({ title: victim.title, closedAt: null, _count: { responses: 1, questions: 3 } })
  expect(after.access).toHaveLength(0)
  // Fremde Abgabe-IDs mit der EIGENEN surveyId (die man verwalten darf) löschen ebenfalls nichts.
  await page.goto(`/fragebogen/${own.id}/verwalten`)
  await page.getByTestId('response-list').locator('summary').click()
  await page.evaluate(id => document.querySelectorAll<HTMLInputElement>('input[name="responseId"]').forEach(i => { i.value = id }), victimResponse.id)
  await page.getByRole('button', { name: 'löschen', exact: true }).first().click()
  await expect(page.getByText('0 Antworten gelöscht.')).toBeVisible()
  expect(await prisma.surveyResponse.findUnique({ where: { id: victimResponse.id } })).not.toBeNull()

  // Und ohne jede Anmeldung: Verwaltung, Bearbeiten und Export des Opfers bleiben zu.
  const anonymous = await playwright.request.newContext({ baseURL: BASE_URL })
  expect((await anonymous.get(`/fragebogen/${victim.id}/verwalten/export`)).status()).toBe(404)
  const manage = await anonymous.get(`/fragebogen/${victim.id}/verwalten`, { maxRedirects: 0 })
  expect([307, 303, 302]).toContain(manage.status())
  await anonymous.dispose()
})
