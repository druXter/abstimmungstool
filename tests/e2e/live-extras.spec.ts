import { expect, test, type Browser, type Page } from '@playwright/test'
import type { LiveQuestionKind } from '@prisma/client'
import { createAccount, login, prisma, unique, uniqueIp } from './helpers'
import { readImage } from '../../app/lib/live-images'

// Live-Runden, Ausbau (TODO.md E, Ideen-Punkt): Mehrfachauswahl, Schätzfrage, Wortwolke, Teilen mit
// anderen Konten, CSV-Export und Bilder zu Fragen.

type Q = { text: string; kind?: LiveQuestionKind; timeLimit?: number | null; answers?: [string, boolean][]; target?: number; tolerance?: number; unit?: string }

async function createLive(ownerId: string, questions: Q[]) {
  return prisma.liveSession.create({
    data: {
      title: `Quiz ${unique()}`,
      ownerId,
      pin: String(100_000 + Math.floor(Math.random() * 900_000)),
      questions: {
        create: questions.map((q, position) => ({
          position,
          text: q.text,
          kind: q.kind ?? 'CHOICE',
          timeLimit: q.timeLimit === undefined ? null : q.timeLimit,
          target: q.target ?? null,
          tolerance: q.tolerance ?? null,
          unit: q.unit ?? null,
          answers: { create: (q.answers ?? []).map(([label, isCorrect], i) => ({ position: i, label, isCorrect })) }
        }))
      }
    }
  })
}

async function joinAs(browser: Browser, pin: string, nickname: string): Promise<Page> {
  const context = await browser.newContext({ locale: 'de-DE', extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  const page = await context.newPage()
  await page.goto(`/live?pin=${pin}`)
  await page.getByLabel('Spitzname').fill(nickname)
  await page.getByRole('button', { name: /Los geht/ }).click()
  await expect(page.getByText(`Du bist dabei, ${nickname}!`)).toBeVisible()
  return page
}

async function startedRound(page: Page, browser: Browser, questions: Q[], names: string[]) {
  const owner = await createAccount()
  const live = await createLive(owner.id, questions)
  await login(page, owner.email)
  await page.goto(`/live/${live.id}/praesentieren`)
  const phones = []
  for (const name of names) phones.push(await joinAs(browser, live.pin!, name))
  await page.getByRole('button', { name: 'Starten' }).click()
  return { live, owner, phones }
}

async function pointsOf(sessionId: string) {
  const rows = await prisma.liveResponse.findMany({ where: { question: { sessionId } }, include: { player: true } })
  return Object.fromEntries(rows.map(r => [r.player.nickname, r.points]))
}

test('Mehrfachauswahl: Punkte nur für genau die richtige Kombination', async ({ page, browser }) => {
  const { live, phones: [anna, ben] } = await startedRound(page, browser, [
    { text: 'Welche sind Primzahlen?', kind: 'MULTI', answers: [['2', true], ['3', true], ['4', false]] }
  ], ['Anna', 'Ben'])
  await expect(page.getByText('mehrere Antworten möglich')).toBeVisible()

  await anna.getByRole('button', { name: /^Dreieck 2/ }).click()
  await anna.getByRole('button', { name: /^Raute 3/ }).click()
  await anna.getByRole('button', { name: '2 Antworten abschicken' }).click()
  await expect(anna.getByText('Antwort gespeichert')).toBeVisible()
  await expect(anna.getByText('2, 3')).toBeVisible()

  await ben.getByRole('button', { name: /^Dreieck 2/ }).click()
  await ben.getByRole('button', { name: '1 Antwort abschicken' }).click()

  await expect(anna.getByText('Richtig!')).toBeVisible()
  await expect(ben.getByText('Leider falsch')).toBeVisible()
  await expect(ben.getByText('Richtig war: 2 + 3')).toBeVisible()
  const points = await pointsOf(live.id)
  expect(points.Anna).toBeGreaterThanOrEqual(500)
  expect(points.Ben).toBe(0)
  await expect(page.getByLabel('richtig')).toHaveCount(2)
})

test('Schätzfrage: Punkte nach Nähe, Komma als Dezimaltrenner, Verteilung auf der Leinwand', async ({ page, browser }) => {
  const { live, phones: [anna, ben, cem] } = await startedRound(page, browser, [
    { text: 'Wie hoch ist der Turm?', kind: 'ESTIMATE', target: 100, tolerance: 10, unit: 'm' }
  ], ['Anna', 'Ben', 'Cem'])
  await expect(page.getByText('Schätzt jetzt auf dem Handy (in m)!')).toBeVisible()

  for (const [phone, value] of [[anna, '100'], [ben, '99,5'], [cem, '120']] as const) {
    await phone.getByLabel('Deine Schätzung').fill(value)
    await phone.getByRole('button', { name: 'Schätzung abschicken' }).click()
  }

  await expect(anna.getByText('Gut geschätzt!')).toBeVisible()
  await expect(anna.getByText('+1000 Punkte')).toBeVisible()
  await expect(ben.getByText('+975 Punkte')).toBeVisible()
  await expect(cem.getByText('Leider zu weit weg')).toBeVisible()
  await expect(cem.getByText('Richtig: 100 m - du: 120 m')).toBeVisible()
  await expect(page.getByText('3 Schätzungen · Median 100 m · Durchschnitt 106,5 m')).toBeVisible()
  await expect(page.getByLabel('Verteilung der Schätzungen')).toBeVisible()
  expect(await pointsOf(live.id)).toEqual({ Anna: 1000, Ben: 975, Cem: 0 })
})

test('Wortwolke: wächst live, Leinwand blendet Unpassendes aus, keine Punkte', async ({ page, browser }) => {
  const { live, phones: [anna, ben, cem] } = await startedRound(page, browser, [
    { text: 'Ein Wort zum Abend?', kind: 'WORDCLOUD' }
  ], ['Anna', 'Ben', 'Cem'])
  const cloud = page.getByRole('list', { name: 'Wortwolke' })

  await anna.getByLabel('Dein Begriff').fill('Pizza')
  await anna.getByRole('button', { name: 'Abschicken' }).click()
  await ben.getByLabel('Dein Begriff').fill('  pizza ')
  await ben.getByRole('button', { name: 'Abschicken' }).click()
  // Live auf der Leinwand, Groß-/Kleinschreibung zusammengefasst.
  await expect(cloud.getByText('Pizza')).toBeVisible()
  await expect(cloud.getByRole('listitem')).toHaveCount(1)
  await expect(cloud.getByRole('listitem')).toHaveAttribute('title', '2×')

  await cem.getByLabel('Dein Begriff').fill('Mist')
  await cem.getByRole('button', { name: 'Abschicken' }).click()
  await expect(cloud.getByText('Mist')).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await cloud.getByRole('button', { name: /Mist/ }).click()
  await expect(cloud.getByText('Mist')).toHaveCount(0)

  // Alle haben geantwortet -> Auflösung; die Handys sehen die Wolke ohne das ausgeblendete Wort.
  await expect(anna.getByText('Danke für deinen Beitrag!')).toBeVisible()
  await expect(anna.getByRole('list', { name: 'Wortwolke' }).getByText('Pizza')).toBeVisible()
  await expect(anna.getByRole('list', { name: 'Wortwolke' }).getByText('Mist')).toHaveCount(0)
  expect(await pointsOf(live.id)).toEqual({ Anna: 0, Ben: 0, Cem: 0 })
  expect((await prisma.liveResponse.findFirstOrThrow({ where: { textKey: 'mist', question: { sessionId: live.id } } })).hidden).toBe(true)
  // Nach einer Wortwolke kommt keine Rangliste.
  await expect(page.getByRole('button', { name: 'Zum Ergebnis' })).toBeVisible()
})

test('Teilen: Moderation darf präsentieren und exportieren, nicht löschen oder teilen; CSV-Export', async ({ page, browser }) => {
  const owner = await createAccount()
  const moderator = await createAccount('MODERATOR')
  const live = await createLive(owner.id, [
    { text: 'Hauptstadt?', answers: [['Paris', true], ['Lyon', false]] },
    { text: 'Ein Wort?', kind: 'WORDCLOUD' }
  ])
  const q = await prisma.liveQuestion.findMany({ where: { sessionId: live.id }, orderBy: { position: 'asc' }, include: { answers: true } })
  const player = await prisma.livePlayer.create({ data: { sessionId: live.id, nickname: '=1+1', nicknameKey: '=1+1', tokenHash: `h-${unique()}` } })
  await prisma.liveResponse.create({ data: { questionId: q[0].id, playerId: player.id, answerId: q[0].answers.find(a => a.label === 'Paris')!.id, elapsedMs: 2500, points: 875 } })
  await prisma.liveResponse.create({ data: { questionId: q[1].id, playerId: player.id, text: 'Sonne', textKey: 'sonne', elapsedMs: 4000 } })

  await login(page, owner.email)
  await page.goto(`/live/${live.id}/verwalten`)
  await page.getByLabel('E-Mail-Adresse des Kontos').fill(moderator.email)
  await page.getByRole('button', { name: 'Teilen' }).click()
  await expect(page.getByText('Freigabe hinzugefügt.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Freigaben' })).toContainText(moderator.email)

  const mod = await (await browser.newContext()).newPage()
  await login(mod, moderator.email)
  await mod.goto('/meine-abstimmungen')
  await expect(mod.getByRole('link', { name: live.title })).toBeVisible()
  await mod.goto(`/live/${live.id}/verwalten`)
  await expect(mod.getByText('Du moderierst diese Live-Runde')).toBeVisible()
  await expect(mod.getByRole('button', { name: /Löschen/ })).toHaveCount(0)
  await expect(mod.getByRole('heading', { name: 'Gemeinsam moderieren' })).toHaveCount(0)
  expect((await mod.goto(`/live/${live.id}/praesentieren`))!.status()).toBe(200)

  await mod.goto(`/live/${live.id}/verwalten`)
  const downloadPromise = mod.waitForEvent('download')
  await mod.getByRole('link', { name: /CSV-Export/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`live-runde-${live.id}.csv`)
  const csv = (await (await download.createReadStream()).toArray()).map(c => c.toString('utf8')).join('')
  expect(csv.startsWith('﻿')).toBe(true)
  expect(csv).toContain('"1";"Hauptstadt?";"Auswahl";"Paris";"1";"ja"')
  expect(csv).toContain('"2";"Ein Wort?";"Wortwolke";"Sonne";"1";""')
  expect(csv).toContain(`"'=1+1";"1";"Hauptstadt?";"Paris";"ja";"875";"2,5";""`)
  expect(csv).toContain(`"1";"'=1+1";"875"`)

  // Freigabe zurücknehmen -> kein Zugriff mehr.
  await page.goto(`/live/${live.id}/verwalten`)
  await page.getByRole('list', { name: 'Freigaben' }).getByRole('button', { name: 'Entfernen' }).click()
  await expect(page.getByRole('list', { name: 'Freigaben' })).toHaveCount(0)
  expect((await mod.goto(`/live/${live.id}/verwalten`))!.status()).toBe(404)
  expect((await mod.request.get(`/live/${live.id}/verwalten/export`)).status()).toBe(404)
  await mod.context().close()
})

// Kleinstes gültiges PNG (1x1 Pixel, rot).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

test('Bilder: im Browser verkleinert und neu kodiert, beim Bearbeiten behalten, nur für Beteiligte sichtbar', async ({ page, browser }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/live/neu')
  await page.getByLabel('Titel').fill('Bilderquiz')
  await page.getByLabel('Frage 1', { exact: true }).fill('Was ist das?')
  await page.getByLabel('Frage 1, Antwort 1').fill('Rot')
  await page.getByLabel('Frage 1, Antwort 2').fill('Blau')
  await page.getByLabel('Frage 1, Bild').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('img', { name: 'Bild zu Frage 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Live-Runde anlegen' }).click()
  await page.waitForURL(/verwalten\?angelegt=1/)

  const id = new URL(page.url()).pathname.split('/')[2]
  const question = await prisma.liveQuestion.findFirstOrThrow({ where: { sessionId: id }, include: { image: true } })
  // Neu kodiert: aus dem PNG wurde im Browser ein JPEG.
  expect(question.image?.type).toBe('image/jpeg')
  const imageUrl = `/api/live/bild/${question.imageId}`
  const fetchStatus = (p: Page) => p.evaluate(async url => (await fetch(url)).status, imageUrl)

  expect(await fetchStatus(page)).toBe(200)
  const stranger = await (await browser.newContext()).newPage()
  await stranger.goto('/impressum')
  expect(await fetchStatus(stranger)).toBe(404)

  // Teilnehmende sehen es während der Frage.
  const live = await prisma.liveSession.findUniqueOrThrow({ where: { id } })
  await page.goto(`/live/${id}/praesentieren`)
  const anna = await joinAs(browser, live.pin!, 'Anna')
  expect(await fetchStatus(anna)).toBe(200)
  await page.getByRole('button', { name: 'Starten' }).click()
  await expect(anna.getByRole('img', { name: 'Bild zur Frage' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Bild zur Frage' })).toBeVisible()

  // Bearbeiten (nach Neu starten) behält das Bild, "Bild entfernen" löscht es.
  await prisma.livePlayer.deleteMany({ where: { sessionId: id } })
  await page.goto(`/live/${id}/bearbeiten`)
  await page.getByRole('button', { name: 'Speichern' }).click()
  await page.waitForURL(/gespeichert=1/)
  const kept = await prisma.liveQuestion.findFirstOrThrow({ where: { sessionId: id } })
  expect(kept.imageId).toBe(question.imageId)
  await page.goto(`/live/${id}/bearbeiten`)
  await page.getByLabel('Bild entfernen').check()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await page.waitForURL(/gespeichert=1/)
  expect((await prisma.liveQuestion.findFirstOrThrow({ where: { sessionId: id } })).imageId).toBeNull()
  expect(await prisma.liveImage.count({ where: { sessionId: id } })).toBe(0)
  await stranger.context().close()
})

test('Bildprüfung: nur echte Rasterbilder bis 1,5 MB, kein SVG', async () => {
  expect((await readImage(new File([PNG], 'a.png', { type: 'image/png' })))?.type).toBe('image/png')
  // Typ kommt aus dem Inhalt, nicht aus der Angabe des Browsers.
  expect((await readImage(new File([PNG], 'a.jpg', { type: 'image/jpeg' })))?.type).toBe('image/png')
  expect(await readImage(new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'a.svg', { type: 'image/svg+xml' }))).toBeNull()
  expect(await readImage(new File([Buffer.concat([PNG, Buffer.alloc(1_600_000)])], 'gross.png', { type: 'image/png' }))).toBeNull()
  expect(await readImage('kein Bild')).toBeNull()
})
