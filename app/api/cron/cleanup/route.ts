// app/api/cron/cleanup/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { safeEqual } from '../../../lib/permissions'

// Bewusst dieselben Fristen wie in rsvp-app (dort app/api/cron/cleanup/route.ts), damit die
// Tools der Suite einheitlich mit Daten umgehen und die Datenschutzerklärungen dieselben
// Zeiträume nennen können.
const POLL_RETENTION_MONTHS = 18
const ACCOUNT_INACTIVITY_YEARS = 2

/**
 * Automatischer Cron-Endpoint für Uptime Kuma (Speicherbegrenzung, Art. 5 Abs. 1 lit. e
 * DSGVO - siehe Datenschutzerklärung Punkt 11), gleiches Muster wie rsvp-apps
 * /api/cron/cleanup. Läuft idempotent, einmal täglich reicht völlig.
 *
 * 1. Löscht Abstimmungen samt Optionen, Stimmen und Freigaben, die vor mehr als
 *    POLL_RETENTION_MONTHS zu Ende gegangen sind. "Zu Ende" ist der Schließzeitpunkt
 *    (manuell geschlossen, sonst das automatische Schließdatum); eine nie geschlossene
 *    Abstimmung ohne Frist zählt ab ihrer Anlage - sonst bliebe sie ewig liegen.
 * 2. Löscht Konten, die seit ACCOUNT_INACTIVITY_YEARS nicht mehr eingeloggt waren -
 *    bewusst NICHT Admin-Konten (wie in rsvp-app: sie sind eine fortlaufende Identität und
 *    sollen nicht automatisiert verschwinden). Ein Konto, das noch Abstimmungen besitzt,
 *    bleibt bestehen: Dass sie die Frist aus Punkt 1 überlebt haben, heißt, dass sie noch
 *    "leben" - ihre Stimmen anderer Leute sollen nicht stillschweigend ohne Besitzer enden.
 * 3. Räumt Technisches auf: abgelaufene Sitzungen, abgelaufene Einladungs-/Reset-Links,
 *    veraltete Drossel-Zähler.
 */
export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret')
  const expected = process.env.CRON_SECRET

  // Ein leeres/fehlendes CRON_SECRET darf den Endpunkt NICHT freischalten (siehe close-expired-polls).
  if (!expected || !secret || !safeEqual(secret, expected)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const now = new Date()
  const pollCutoff = new Date(now)
  pollCutoff.setMonth(pollCutoff.getMonth() - POLL_RETENTION_MONTHS)

  // Ende = closedAt, sonst closesAt, sonst createdAt. Prisma kennt kein COALESCE im where,
  // daher die drei Fälle einzeln - jeder Fall schließt die höher priorisierten aus.
  const oldPolls = await prisma.poll.findMany({
    where: {
      OR: [
        { closedAt: { lt: pollCutoff } },
        { closedAt: null, closesAt: { lt: pollCutoff } },
        { closedAt: null, closesAt: null, createdAt: { lt: pollCutoff } }
      ]
    },
    select: { id: true }
  })
  const pollIds = oldPolls.map(p => p.id)

  await prisma.$transaction([
    prisma.vote.deleteMany({ where: { pollId: { in: pollIds } } }),
    prisma.pollOption.deleteMany({ where: { pollId: { in: pollIds } } }),
    prisma.pollAccess.deleteMany({ where: { pollId: { in: pollIds } } }),
    prisma.poll.deleteMany({ where: { id: { in: pollIds } } })
  ])

  const inactivityCutoff = new Date(now)
  inactivityCutoff.setFullYear(inactivityCutoff.getFullYear() - ACCOUNT_INACTIVITY_YEARS)

  const inactiveUsers = await prisma.user.findMany({
    where: { role: { not: 'ADMIN' }, lastLoginAt: { lt: inactivityCutoff }, ownedPolls: { none: {} } },
    select: { id: true }
  })
  // Sitzungen, Verknüpfungen und Freigaben verschwinden per Cascade mit dem Konto.
  await prisma.user.deleteMany({ where: { id: { in: inactiveUsers.map(u => u.id) } } })

  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } })
  await prisma.user.updateMany({
    where: { resetTokenExpiresAt: { lt: now } },
    data: { resetTokenHash: null, resetTokenExpiresAt: null }
  })
  await prisma.loginThrottle.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } })

  return NextResponse.json({
    success: true,
    deletedPolls: pollIds.length,
    deletedInactiveUsers: inactiveUsers.length
  })
}
