import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto'
import { expect, test } from '@playwright/test'
import ece from 'http_ece'
import { createAccount, createPoll, login, prisma, unique } from './helpers'
import { PUSH_ORIGIN, pushesTo } from './push-server'
import { TEST_VAPID_PUBLIC_KEY } from '../../playwright.config'

// Push-Mitteilungen (app/lib/push.ts). Den Browser-Teil (Abo beim Push-Dienst des Herstellers)
// kann ein Headless-Browser nicht - die Tests legen das Abo daher wie ein Browser an (eigenes
// Schlüsselpaar, auth-Geheimnis) und prüfen, was beim Push-Dienst ankommt: VAPID-Signatur und
// Inhalt, entschlüsselt mit einer UNABHÄNGIGEN Implementierung von RFC 8291 (Paket http_ece).

async function subscribe(userId: string, path: string) {
  const session = await prisma.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } })
  const browserKeys = createECDH('prime256v1')
  const auth = randomBytes(16)
  await prisma.pushSubscription.create({
    data: {
      userId, sessionId: session.id, endpoint: `${PUSH_ORIGIN}${path}`,
      p256dh: browserKeys.generateKeys().toString('base64url'), auth: auth.toString('base64url')
    }
  })
  return { browserKeys, auth }
}

async function waitForPush(path: string) {
  await expect.poll(() => pushesTo(path).length, { timeout: 5000 }).toBeGreaterThan(0)
  return pushesTo(path)[0]
}

test('Abstimmung beendet: verschlüsselte Mitteilung mit gültiger VAPID-Signatur', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  const path = `/push/${unique()}`
  const { browserKeys, auth } = await subscribe(owner.id, path)
  const poll = await createPoll(owner.id, { notifyOwnerOnClose: true })
  await prisma.vote.create({ data: { pollId: poll.id, optionId: poll.options[0].id, identityKind: 'COOKIE', voterKey: `cookie:p-${poll.id}` } })

  await page.goto(`/${poll.id}/verwalten`)
  await page.getByRole('button', { name: /Abstimmung jetzt schließen/ }).click()
  const push = await waitForPush(path)

  expect(push.headers['content-encoding']).toBe('aes128gcm')
  expect(Number(push.headers.ttl)).toBeGreaterThan(0)

  // VAPID (RFC 8292): JWT für genau diesen Push-Dienst, signiert mit unserem Schlüssel.
  const match = push.headers.authorization.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)
  expect(match).not.toBeNull()
  const [, header, claims, signature, k] = match!
  expect(k).toBe(TEST_VAPID_PUBLIC_KEY)
  const payload = JSON.parse(Buffer.from(claims, 'base64url').toString())
  expect(payload).toMatchObject({ aud: PUSH_ORIGIN, sub: 'mailto:test@example.test' })
  expect(payload.exp * 1000).toBeGreaterThan(Date.now())
  const publicKey = Buffer.from(TEST_VAPID_PUBLIC_KEY, 'base64url')
  const key = createPublicKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: publicKey.subarray(1, 33).toString('base64url'), y: publicKey.subarray(33).toString('base64url') }
  })
  expect(verify('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true)

  // Inhalt (RFC 8291): nur mit dem Schlüssel des "Browsers" lesbar.
  const plaintext = ece.decrypt(Buffer.from(push.body, 'base64'), { version: 'aes128gcm', privateKey: browserKeys, authSecret: auth })
  expect(JSON.parse(plaintext.toString())).toEqual({
    title: `Abstimmung beendet: ${poll.title}`,
    body: 'Ergebnis: "Pizza".',
    url: `/${poll.id}/verwalten`
  })
})

test('erloschenes Abo wird gelöscht, Abmelden beendet die Mitteilungen dieses Geräts', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await subscribe(owner.id, `/gone/${unique()}`)
  const active = `/push/${unique()}`
  await subscribe(owner.id, active)
  const poll = await createPoll(owner.id, { notifyOwnerOnClose: true })

  await page.goto(`/${poll.id}/verwalten`)
  await page.getByRole('button', { name: /Abstimmung jetzt schließen/ }).click()
  await waitForPush(active)
  await expect.poll(() => prisma.pushSubscription.count({ where: { userId: owner.id } })).toBe(1)

  // Abmelden löscht die Sitzung - und mit ihr das Abo dieses Geräts.
  await page.getByRole('button', { name: 'Abmelden' }).click()
  await expect.poll(() => prisma.pushSubscription.count({ where: { userId: owner.id } })).toBe(0)
})

test('Mein Konto zeigt den Bereich Mitteilungen, wenn Push eingerichtet ist', async ({ page }) => {
  const owner = await createAccount()
  await login(page, owner.email)
  await page.goto('/konto')
  await expect(page.getByRole('heading', { name: 'Mitteilungen' })).toBeVisible()
  // Headless-Chromium blockiert Mitteilungen von sich aus - die Seite sagt das.
  await expect(page.getByText('Mitteilungen sind für diese Seite im Browser blockiert.')).toBeVisible()

  // Den Knopf "einschalten" und das echte Abo kann ein Headless-Browser nicht zeigen: Er meldet
  // Mitteilungen auch mit erteilter Berechtigung als verweigert (siehe README "Tests").
})
