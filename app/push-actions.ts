// app/push-actions.ts
'use server'

import { prisma } from './lib/prisma'
import { getCurrentSessionId, getCurrentUser } from './lib/auth'
import { isPushConfigured } from './lib/push'

type SubscriptionInput = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }

/**
 * Push-Dienste der Browser-Hersteller (Chrome/Edge-Chromium/Android, Firefox, Safari, altes
 * Edge). Der Server schickt später Anfragen an den gespeicherten Endpoint - ohne diese Liste
 * könnte ein Konto eine beliebige Adresse (z.B. im internen Netz) eintragen (SSRF).
 */
const PUSH_SERVICE_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com']

function isKnownPushService(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !url.port &&
      PUSH_SERVICE_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

/** Nur Endpoints bekannter Push-Dienste, keine überlangen Werte - der Rest kommt ungeprüft aus dem Browser. */
function validSubscription(input: SubscriptionInput): { endpoint: string; p256dh: string; auth: string } | null {
  const { endpoint, keys } = input ?? {}
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !isKnownPushService(endpoint)) return null
  if (typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') return null
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(keys.auth)) return null
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth }
}

/**
 * Speichert das Push-Abo dieses Geräts für das eingeloggte Konto, gebunden an die aktuelle
 * Sitzung (siehe PushSubscription in schema.prisma). Aufgerufen von app/konto/push-toggle.tsx.
 */
export async function savePushSubscription(input: SubscriptionInput): Promise<boolean> {
  if (!isPushConfigured()) return false
  const [user, sessionId] = await Promise.all([getCurrentUser(), getCurrentSessionId()])
  const subscription = validSubscription(input)
  if (!user || !sessionId || !subscription) return false

  // Ein Endpoint gehört genau einem Gerät - meldet sich dort jemand anderes an, zieht das Abo um.
  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: { userId: user.id, sessionId, p256dh: subscription.p256dh, auth: subscription.auth },
    create: { userId: user.id, sessionId, ...subscription }
  })
  return true
}

/** Mitteilungen auf diesem Gerät ausschalten. Nur eigene Abos. */
export async function deletePushSubscription(endpoint: unknown): Promise<void> {
  const user = await getCurrentUser()
  if (!user || typeof endpoint !== 'string') return
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } })
}
