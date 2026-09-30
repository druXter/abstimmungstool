// app/lib/push.ts
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto'
import { prisma } from './prisma'

/**
 * Web Push ohne Zusatzpaket, bewusst an einer Stelle auditierbar (wie app/lib/rsvp-verification.ts):
 * - VAPID (RFC 8292): Jede Anfrage an den Push-Dienst trägt ein mit unserem privaten Schlüssel
 *   signiertes JWT (ES256), damit nur wir an unsere Abos schicken können.
 * - Inhalt verschlüsselt nach RFC 8291 ("aes128gcm"): Nur der Browser mit dem Abo kann ihn
 *   lesen, der Push-Dienst (Google, Mozilla, Apple) sieht nur Empfänger-Adresse und Größe.
 *
 * Konfiguration: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url, erzeugen mit
 * `node scripts/generate-vapid-keys.js`) und VAPID_SUBJECT (mailto:… oder https://…, damit
 * der Push-Dienst bei Problemen jemanden erreicht). Ohne sie gibt es keine Push-Mitteilungen,
 * alles andere funktioniert unverändert. Versand ist immer best-effort.
 */

export type PushMessage = { title: string; body: string; url: string }

type VapidKeys = { publicKey: string; privateKey: string; subject: string }

function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

export function isPushConfigured(): boolean {
  return vapidKeys() !== null
}

/** Öffentlicher Schlüssel für pushManager.subscribe (applicationServerKey). */
export function vapidPublicKey(): string | null {
  return vapidKeys()?.publicKey ?? null
}

/** VAPID-Header für einen Push-Dienst (aud = dessen Origin), 12 Stunden gültig. */
function vapidAuthorization(endpoint: string, keys: VapidKeys): string {
  const publicKey = Buffer.from(keys.publicKey, 'base64url')
  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC', crv: 'P-256',
      // Auf 32 Byte auffüllen, falls ein Schlüssel ohne führende Null gespeichert wurde.
      d: Buffer.concat([Buffer.alloc(Math.max(32 - Buffer.from(keys.privateKey, 'base64url').length, 0)), Buffer.from(keys.privateKey, 'base64url')]).toString('base64url'),
      x: publicKey.subarray(1, 33).toString('base64url'),
      y: publicKey.subarray(33, 65).toString('base64url')
    }
  })
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: keys.subject
  })).toString('base64url')
  // ES256 im JWT braucht die rohe Signatur r||s, nicht das DER-Format.
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `vapid t=${header}.${claims}.${signature}, k=${keys.publicKey}`
}

/**
 * Verschlüsselt eine Nachricht für ein Abo nach RFC 8291 (ein einziger Datensatz):
 * ECDH mit einem Einmal-Schlüsselpaar, daraus mit dem auth-Geheimnis des Browsers Schlüssel
 * und Nonce für AES-128-GCM. Kopf: salt (16) | Datensatzgröße (4) | Länge (1) | unser öffentlicher Schlüssel (65).
 */
export function encryptPayload(plaintext: Buffer, subscription: { p256dh: string; auth: string }): Buffer {
  const uaPublic = Buffer.from(subscription.p256dh, 'base64url')
  const authSecret = Buffer.from(subscription.auth, 'base64url')
  const ecdh = createECDH('prime256v1')
  const asPublic = ecdh.generateKeys()
  const sharedSecret = ecdh.computeSecret(uaPublic)
  const salt = randomBytes(16)

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))

  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // 0x02 = Trenner des letzten (hier einzigen) Datensatzes.
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])

  const recordSize = Buffer.alloc(4)
  recordSize.writeUInt32BE(4096)
  return Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, ciphertext])
}

/**
 * Schickt eine Mitteilung an alle Geräte eines Kontos. Abos, die der Push-Dienst als
 * erloschen meldet (404/410), werden gelöscht. Fehler werden geschluckt - eine Mitteilung
 * darf nie den eigentlichen Vorgang (z.B. das Schließen einer Abstimmung) stören.
 */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<number> {
  const keys = vapidKeys()
  if (!keys) return 0
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
  let delivered = 0
  for (const subscription of subscriptions) {
    try {
      const response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          TTL: String(24 * 60 * 60),
          Urgency: 'normal',
          Authorization: vapidAuthorization(subscription.endpoint, keys)
        },
        body: new Uint8Array(encryptPayload(Buffer.from(JSON.stringify(message)), subscription)),
        signal: AbortSignal.timeout(5000)
      })
      if (response.status === 404 || response.status === 410) {
        await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } })
      } else if (response.ok) {
        delivered++
      }
    } catch {
      // Push-Dienst nicht erreichbar - best-effort, siehe oben.
    }
  }
  return delivered
}
