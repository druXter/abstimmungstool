// app/api/cron/cleanup/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { safeEqual } from '../../../lib/permissions'
import { voterKey } from '../../../lib/voter-identity'

// Bewusst dieselben Fristen wie in rsvp-app (dort app/api/cron/cleanup/route.ts), damit die
// Tools der Suite einheitlich mit Daten umgehen und die Datenschutzerklärungen dieselben
// Zeiträume nennen können.
const POLL_RETENTION_MONTHS = 18
const ACCOUNT_INACTIVITY_YEARS = 2
const LIVE_PIN_IDLE_HOURS = 24

/**
 * Automatischer Cron-Endpoint für Uptime Kuma (Speicherbegrenzung, Art. 5 Abs. 1 lit. e
 * DSGVO - siehe Datenschutzerklärung Punkt 11), gleiches Muster wie rsvp-apps
 * /api/cron/cleanup. Läuft idempotent, einmal täglich reicht völlig.
 *
 * 1. Löscht Abstimmungen samt Optionen, Stimmen, Stimmlinks, bestätigten Adressen und Freigaben, die vor mehr als
 *    POLL_RETENTION_MONTHS zu Ende gegangen sind. "Zu Ende" ist der Schließzeitpunkt
 *    (manuell geschlossen, sonst das automatische Schließdatum); eine nie geschlossene
 *    Abstimmung ohne Frist zählt ab ihrer Anlage - sonst bliebe sie ewig liegen.
 * 2. Löscht Konten, die seit ACCOUNT_INACTIVITY_YEARS nicht mehr eingeloggt waren -
 *    bewusst NICHT Konten mit Admin-Rolle (anders als in rsvp-app, wo alle Verwaltungskonten ausgenommen sind: sie sind eine fortlaufende Identität und
 *    sollen nicht automatisiert verschwinden). Ein Konto, das noch Abstimmungen besitzt,
 *    bleibt bestehen: Dass sie die Frist aus Punkt 1 überlebt haben, heißt, dass sie noch
 *    "leben" - ihre Stimmen anderer Leute sollen nicht stillschweigend ohne Besitzer enden.
 * 3. Räumt Technisches auf: abgelaufene Sitzungen, abgelaufene Einladungs-/Reset-Links,
 *    veraltete Drossel-Zähler, nie bestätigte E-Mail-Anfragen.
 * 4. Live-Runden (samt Teilnehmenden und Antworten) mit derselben Frist wie Abstimmungen - "zu Ende"
 *    ist dort das Beenden, sonst die letzte Änderung. PINs von Runden, an denen sich seit
 *    LIVE_PIN_IDLE_HOURS nichts getan hat, werden freigegeben (beim Öffnen der Leinwand gibt es eine neue).
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
    prisma.voterLink.deleteMany({ where: { pollId: { in: pollIds } } }),
    prisma.emailVoter.deleteMany({ where: { pollId: { in: pollIds } } }),
    prisma.poll.deleteMany({ where: { id: { in: pollIds } } })
  ])

  // Teilnehmende, Fragen und Antworten verschwinden per Cascade mit der Runde.
  const { count: deletedLiveSessions } = await prisma.liveSession.deleteMany({
    where: {
      OR: [
        { finishedAt: { lt: pollCutoff } },
        { finishedAt: null, updatedAt: { lt: pollCutoff } }
      ]
    }
  })
  await prisma.liveSession.updateMany({
    where: { pin: { not: null }, updatedAt: { lt: new Date(now.getTime() - LIVE_PIN_IDLE_HOURS * 60 * 60 * 1000) } },
    data: { pin: null }
  })

  const inactivityCutoff = new Date(now)
  inactivityCutoff.setFullYear(inactivityCutoff.getFullYear() - ACCOUNT_INACTIVITY_YEARS)

  const inactiveUsers = await prisma.user.findMany({
    where: { role: { not: 'ADMIN' }, lastLoginAt: { lt: inactivityCutoff }, ownedPolls: { none: {} }, liveSessions: { none: {} } },
    select: { id: true }
  })
  // Sitzungen, Verknüpfungen und Freigaben verschwinden per Cascade mit dem Konto. Stimmen im
  // Modus ACCOUNT bleiben gezählt, verlieren aber den Namen (wie bei deleteUser).
  await prisma.vote.updateMany({
    where: { voterKey: { in: inactiveUsers.map(u => voterKey('ACCOUNT', u.id)) } },
    data: { voterName: null }
  })
  await prisma.user.deleteMany({ where: { id: { in: inactiveUsers.map(u => u.id) } } })

  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } })
  await prisma.user.updateMany({
    where: { resetTokenExpiresAt: { lt: now } },
    data: { resetTokenHash: null, resetTokenExpiresAt: null }
  })
  await prisma.loginThrottle.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } })
  // Nie bestätigte E-Mail-Anfragen (Modus EMAIL) nach Ablauf ihres Links - sie tragen nur eine
  // Adresse, zu der es keine Stimme gibt.
  await prisma.emailVoter.deleteMany({ where: { confirmedAt: null, tokenExpiresAt: { lt: now } } })

  return NextResponse.json({
    success: true,
    deletedPolls: pollIds.length,
    deletedLiveSessions,
    deletedInactiveUsers: inactiveUsers.length
  })
}
