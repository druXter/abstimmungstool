import { expect, test, type Browser, type Page } from '@playwright/test'
import { createAccount, login, prisma, unique, uniqueIp } from './helpers'
import { TEST_CRON_SECRET } from '../../playwright.config'

// Live-Runden wie bei Kahoot (TODO.md E): Anlegen, Beitritt per PIN, Leinwand und Handys im
// Gleichtakt (Long-Polling), Punkte, Zeitablauf, Entfernen, Berechtigungen.

async function createLive(ownerId: string, questions: { text: string; timeLimit?: number | null; answers: [string, boolean][] }[]) {
  return prisma.liveSession.create({
    data: {
      title: `Quiz ${unique()}`,
      ownerId,
      pin: String(100_000 + Math.floor(Math.random() * 900_000)),
      questions: {
        create: questions.map((q, position) => ({
          position,
          text: q.text,
          timeLimit: q.timeLimit === undefined ? 30 : q.timeLimit,
          answers: { create: q.answers.map(([label, isCorrect], i) => ({ position: i, label, isCorrect })) }
        }))
      }
    }
  })
}

/** Neues Handy: eigener Browser-Kontext (eigene Cookies) und eigene IP. */
async function joinAs(browser: Browser, pin: string, nickname: string): Promise<Page> {
  const context = await browser.newContext({ locale: 'de-DE', extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })
  const page = await context.newPage()
  await page.goto(`/live?pin=${pin}`)
  await page.getByLabel('Spitzname').fill(nickname)
  await page.getByRole('button', { name: /Los geht/ }).click()
  return page
}

test('Live-Runde anlegen: Fragen mit Antworten, richtige markieren, Verwaltungsseite mit PIN', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/meine-abstimmungen')
  await page.getByRole('link', { name: 'Neue Live-Runde' }).click()

  await page.getByLabel('Titel').fill('Vereinsquiz')
  await page.getByLabel('Frage 1', { exact: true }).fill('Hauptstadt von Frankreich?')
  await page.getByLabel('Frage 1, Antwort 1').fill('Paris')
  await page.getByLabel('Frage 1, Antwort 2').fill('Lyon')
  await page.locator('input[name="q0_c0"]').check()
  await page.getByRole('button', { name: '+ Weitere Frage' }).click()
  await page.getByLabel('Frage 2', { exact: true }).fill('Lieblingsfarbe?')
  await page.getByLabel('Frage 2, Antwort 1').fill('Rot')
  await page.getByLabel('Frage 2, Antwort 2').fill('Blau')
  await page.getByLabel('Zeitlimit').nth(1).selectOption('0')
  await page.getByRole('button', { name: 'Live-Runde anlegen' }).click()

  await page.waitForURL(/\/live\/[^/]+\/verwalten\?angelegt=1/)
  await expect(page.getByText('Live-Runde angelegt')).toBeVisible()
  await expect(page.getByText('2 Fragen (Quiz mit Punkten)')).toBeVisible()

  const id = new URL(page.url()).pathname.split('/')[2]
  const session = await prisma.liveSession.findUniqueOrThrow({
    where: { id },
    include: { questions: { orderBy: { position: 'asc' }, include: { answers: { orderBy: { position: 'asc' } } } } }
  })
  expect(session.pin).toMatch(/^\d{6}$/)
  expect(session.questions.map(q => [q.text, q.timeLimit])).toEqual([['Hauptstadt von Frankreich?', 20], ['Lieblingsfarbe?', null]])
  expect(session.questions[0].answers.map(a => [a.label, a.isCorrect])).toEqual([['Paris', true], ['Lyon', false]])
  expect(session.questions[1].answers.every(a => !a.isCorrect)).toBe(true)
})

test('Ganze Runde: Beitritt, Antworten, Punkte, Rangliste, Siegertreppchen', async ({ page, browser }) => {
  const owner = await createAccount()
  const live = await createLive(owner.id, [
    { text: 'Wie viele Beine hat eine Spinne?', answers: [['6', false], ['8', true], ['10', false]] },
    { text: 'Pizza oder Pasta?', timeLimit: null, answers: [['Pizza', false], ['Pasta', false]] }
  ])

  await login(page, owner.email)
  await page.goto(`/live/${live.id}/praesentieren`)
  await expect(page.getByLabel('PIN')).toHaveText(live.pin!.replace(/(\d{3})(\d{3})/, '$1 $2'))
  await expect(page.getByRole('button', { name: 'Starten' })).toBeDisabled()

  const anna = await joinAs(browser, live.pin!, 'Anna')
  await expect(anna.getByText('Du bist dabei, Anna!')).toBeVisible()
  // Gleicher Spitzname (Groß-/Kleinschreibung egal) ist vergeben.
  const dup = await joinAs(browser, live.pin!, 'anna')
  await expect(dup.getByText('Diesen Spitznamen hat schon jemand')).toBeVisible()
  const ben = await joinAs(browser, live.pin!, 'Ben')
  await expect(ben.getByText('Du bist dabei, Ben!')).toBeVisible()

  // Die Leinwand sieht die Beitritte ohne Neuladen.
  const players = page.getByRole('list', { name: 'Teilnehmende' })
  await expect(players.getByRole('button', { name: 'Anna' })).toBeVisible()
  await expect(players.getByRole('button', { name: 'Ben' })).toBeVisible()

  // Wer schon dabei ist und die Beitrittsseite erneut nutzt, landet wieder im Spiel.
  await anna.goto(`/live?pin=${live.pin}`)
  await anna.getByLabel('Spitzname').fill('Egal')
  await anna.getByRole('button', { name: /Los geht/ }).click()
  await expect(anna.getByText('Du bist dabei, Anna!')).toBeVisible()

  await page.getByRole('button', { name: 'Starten' }).click()
  await expect(page.getByRole('heading', { name: 'Wie viele Beine hat eine Spinne?' })).toBeVisible()
  await expect(page.getByText('0 von 2 haben geantwortet')).toBeVisible()

  // Vor der Auflösung verrät die Schnittstelle nicht, was richtig ist.
  // (Abfrage im Browser des Handys - nur dort liegt dessen Cookie.)
  const state = await anna.evaluate(async url => (await fetch(url)).json(), `/api/live/${live.id}`)
  expect(state.phase).toBe('QUESTION')
  expect(state.question.answers.some((a: { correct?: boolean }) => 'correct' in a)).toBe(false)

  await anna.getByRole('button', { name: /8/ }).click()
  await expect(anna.getByText('Antwort gespeichert')).toBeVisible()
  await expect(page.getByText('1 von 2 haben geantwortet')).toBeVisible()

  // Letzte Antwort -> alle haben geantwortet -> Auflösung ohne Klick.
  await ben.getByRole('button', { name: /10/ }).click()
  await expect(page.getByRole('button', { name: 'Rangliste' })).toBeVisible()
  await expect(page.getByLabel('richtig')).toHaveCount(1)
  await expect(anna.getByText('Richtig!')).toBeVisible()
  await expect(anna.getByText(/^\+\d+ Punkte$/)).toBeVisible()
  await expect(ben.getByText('Leider falsch')).toBeVisible()
  await expect(ben.getByText('Richtig war: 8')).toBeVisible()

  const points = (await prisma.liveResponse.findMany({ where: { question: { sessionId: live.id } }, include: { player: true } }))
    .map(r => [r.player.nickname, r.points])
  const annaPoints = points.find(p => p[0] === 'Anna')![1] as number
  expect(annaPoints).toBeGreaterThanOrEqual(500)
  expect(annaPoints).toBeLessThanOrEqual(1000)
  expect(points.find(p => p[0] === 'Ben')![1]).toBe(0)

  await page.getByRole('button', { name: 'Rangliste' }).click()
  const ranking = page.getByRole('list', { name: 'Rangliste' })
  await expect(ranking.getByRole('listitem').first()).toContainText('Anna')
  await expect(ranking.getByRole('listitem').first()).toContainText(String(annaPoints))
  await expect(anna.getByText('Platz 1 von 2')).toBeVisible()
  await expect(ben.getByText('Platz 2 von 2')).toBeVisible()

  // Umfragefrage ohne Zeitlimit: keine Punkte, die Leinwand löst auf.
  await page.getByRole('button', { name: 'Nächste Frage' }).click()
  await expect(page.getByRole('heading', { name: 'Pizza oder Pasta?' })).toBeVisible()
  await anna.getByRole('button', { name: /Pasta/ }).click()
  await expect(anna.getByText('Antwort gespeichert')).toBeVisible()
  await page.getByRole('button', { name: 'Jetzt auflösen' }).click()
  await expect(anna.getByText('Danke für deine Antwort!')).toBeVisible()
  await expect(ben.getByText('Keine Antwort')).toBeVisible()

  // Letzte Frage: direkt zum Ergebnis (nach einer Umfragefrage gibt es keine Rangliste).
  await page.getByRole('button', { name: 'Zum Ergebnis' }).click()
  await expect(page.getByRole('heading', { name: 'Siegertreppchen' })).toBeVisible()
  await expect(page.getByLabel('Siegertreppchen')).toContainText('Anna')
  await expect(anna.getByText('Platz 1', { exact: true })).toBeVisible()

  const finished = await prisma.liveSession.findUniqueOrThrow({ where: { id: live.id } })
  expect(finished.phase).toBe('FINISHED')
  expect(finished.pin).toBeNull()

  // Verwaltungsseite: Ergebnisse je Frage und Rangliste, Bearbeiten gesperrt.
  await page.goto(`/live/${live.id}/verwalten`)
  await expect(page.getByText('1. Anna')).toBeVisible()
  await expect(page.getByText('1 · 50%').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /Bearbeiten/ })).toHaveCount(0)
  await page.goto(`/live/${live.id}/bearbeiten`)
  await expect(page.getByText('Es wurde schon geantwortet')).toBeVisible()

  // Neu starten: Lobby, neue PIN, ohne Teilnehmende - die alten Handys merken es.
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: /Neu starten/ }).click()
  await expect(page.getByText('Zurück in der Lobby')).toBeVisible()
  const reset = await prisma.liveSession.findUniqueOrThrow({ where: { id: live.id }, include: { _count: { select: { players: true } } } })
  expect(reset.phase).toBe('LOBBY')
  expect(reset.pin).toMatch(/^\d{6}$/)
  expect(reset._count.players).toBe(0)
  await expect(anna.getByText('Du bist nicht (mehr) Teil dieser Live-Runde.')).toBeVisible()
})

test('Zeitablauf löst automatisch auf', async ({ page, browser }) => {
  const owner = await createAccount()
  const live = await createLive(owner.id, [
    { text: 'Schnell!', timeLimit: 5, answers: [['A', true], ['B', false]] },
    { text: 'Noch eine', answers: [['C', true], ['D', false]] }
  ])
  await login(page, owner.email)
  await page.goto(`/live/${live.id}/praesentieren`)
  const anna = await joinAs(browser, live.pin!, 'Anna')
  await joinAs(browser, live.pin!, 'Ben')
  await page.getByRole('button', { name: 'Starten' }).click()

  await expect(page.getByLabel('Verbleibende Sekunden')).toBeVisible()
  await expect(anna.getByRole('button', { name: 'Dreieck A' })).toBeVisible()
  // Niemand antwortet: Nach 5 s (+ Kulanz) kommt die Auflösung von selbst - auf Leinwand und Handy.
  await expect(page.getByRole('button', { name: 'Rangliste' })).toBeVisible({ timeout: 10_000 })
  await expect(anna.getByText('Keine Antwort')).toBeVisible()
  await expect(anna.getByRole('button', { name: 'Dreieck A' })).toHaveCount(0)
  expect(await prisma.liveResponse.count({ where: { question: { sessionId: live.id } } })).toBe(0)
})

test('Leinwand kann Teilnehmende entfernen und den Beitritt sperren', async ({ page, browser }) => {
  const owner = await createAccount()
  const live = await createLive(owner.id, [{ text: 'Frage', answers: [['Ja', false], ['Nein', false]] }])
  await login(page, owner.email)
  await page.goto(`/live/${live.id}/praesentieren`)

  const troll = await joinAs(browser, live.pin!, 'Unsinn')
  await expect(troll.getByText('Du bist dabei, Unsinn!')).toBeVisible()
  await page.getByRole('list', { name: 'Teilnehmende' }).getByRole('button', { name: 'Unsinn' }).click()
  await page.getByRole('button', { name: 'Ja', exact: true }).click()
  await expect(page.getByText('Warte auf Teilnehmende …')).toBeVisible()
  await expect(troll.getByText('Du bist nicht (mehr) Teil dieser Live-Runde.')).toBeVisible()

  await page.getByRole('button', { name: 'Beitritt sperren' }).click()
  await expect(page.getByText('Beitritt ist gesperrt.')).toBeVisible()
  const late = await joinAs(browser, live.pin!, 'Zu spät')
  await expect(late.getByText('Der Beitritt zu dieser Runde ist gerade gesperrt.')).toBeVisible()
})

test('Falsche PIN, fremde Konten und Handys ohne Beitritt kommen nicht an die Runde', async ({ page, browser, request }) => {
  const owner = await createAccount()
  const other = await createAccount()
  const live = await createLive(owner.id, [{ text: 'Geheim', answers: [['X', true], ['Y', false]] }])

  const stranger = await joinAs(browser, '000000', 'Fremd')
  await expect(stranger.getByText('Zu dieser PIN läuft gerade keine Live-Runde.')).toBeVisible()

  expect((await request.get(`/api/live/${live.id}`)).status()).toBe(410)
  expect((await request.get(`/api/live/${live.id}?as=host`)).status()).toBe(404)

  await login(page, other.email)
  expect((await page.goto(`/live/${live.id}/praesentieren`))!.status()).toBe(404)
  expect((await page.goto(`/live/${live.id}/verwalten`))!.status()).toBe(404)
  expect((await page.request.get(`/api/live/${live.id}?as=host`)).status()).toBe(404)

  // Ohne Cookie führt die Spielseite zum Beitritt (PIN vorausgefüllt).
  const visitor = await browser.newContext()
  const visitorPage = await visitor.newPage()
  await visitorPage.goto(`/live/${live.id}`)
  await expect(visitorPage).toHaveURL(new RegExp(`/live\\?pin=${live.pin}$`))
  await expect(visitorPage.getByLabel('PIN')).toHaveValue(live.pin!)
})

test('Cleanup: alte Runden werden gelöscht, PINs untätiger Runden freigegeben', async ({ request }) => {
  const owner = await createAccount()
  const old = await createLive(owner.id, [{ text: 'Alt', answers: [['A', true], ['B', false]] }])
  const idle = await createLive(owner.id, [{ text: 'Untätig', answers: [['A', true], ['B', false]] }])
  const fresh = await createLive(owner.id, [{ text: 'Frisch', answers: [['A', true], ['B', false]] }])
  await prisma.livePlayer.create({ data: { sessionId: old.id, nickname: 'Anna', nicknameKey: 'anna', tokenHash: `hash-${unique()}` } })
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
  await prisma.$executeRaw`UPDATE LiveSession SET phase = 'FINISHED', pin = NULL, finishedAt = ${twoYearsAgo} WHERE id = ${old.id}`
  await prisma.$executeRaw`UPDATE LiveSession SET updatedAt = ${new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)} WHERE id = ${idle.id}`

  const res = await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)
  expect(res.ok()).toBe(true)

  expect(await prisma.liveSession.findUnique({ where: { id: old.id } })).toBeNull()
  expect(await prisma.livePlayer.count({ where: { sessionId: old.id } })).toBe(0)
  expect((await prisma.liveSession.findUniqueOrThrow({ where: { id: idle.id } })).pin).toBeNull()
  expect((await prisma.liveSession.findUniqueOrThrow({ where: { id: fresh.id } })).pin).toBe(fresh.pin)
})
