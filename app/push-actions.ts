// app/push-actions.ts
'use server'

import { type PushSubscriptionInput, validPushSubscription } from 'suite-kit/web'
import { prisma } from './lib/prisma'
import { getCurrentSessionId, getCurrentUser } from './lib/auth'
import { isPushConfigured } from './lib/push'

/**
 * Speichert das Push-Abo dieses Geräts für das eingeloggte Konto, gebunden an die aktuelle
 * Sitzung (siehe PushSubscription in schema.prisma). Aufgerufen von app/konto/push-toggle.tsx.
 */
export async function savePushSubscription(input: PushSubscriptionInput): Promise<boolean> {
  if (!isPushConfigured()) return false
  const [user, sessionId] = await Promise.all([getCurrentUser(), getCurrentSessionId()])
  const subscription = validPushSubscription(input)
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
