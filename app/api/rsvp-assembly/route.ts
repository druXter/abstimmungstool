// app/api/rsvp-assembly/route.ts
import { NextResponse } from 'next/server'
import { readLimitedText } from 'suite-kit/web'
import { prisma } from '../../lib/prisma'
import { verifyAssemblyLink, forgetRoster } from '../../lib/assembly-coupling'

/**
 * Verknüpfung einer Sitzung mit einem Termin in rsvp-app (docs/KONZEPT-SITZUNG.md, Nachricht `assembly-link`): rsvp-app
 * meldet sich beim Speichern des Links. Eine freie Sitzung übernimmt den Termin, eine schon mit genau diesem Termin
 * verknüpfte aktualisiert den Titel, jede andere antwortet mit 409 - rsvp-app zeigt das im Formular.
 */
/** Größere Meldungen verschickt rsvp-app nie; alles darüber wird gar nicht erst gelesen. */
const MAX_BODY = 10_000

export async function POST(request: Request) {
  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return NextResponse.json({ ok: false, error: 'too large' }, { status: 413 })
  const message = verifyAssemblyLink(body)
  if (!message) return NextResponse.json({ ok: false, error: 'invalid' }, { status: 401 })

  const assembly = await prisma.assembly.findUnique({ where: { id: message.assemblyId }, select: { id: true, title: true, rsvpEventId: true } })
  if (!assembly) return NextResponse.json({ ok: false, error: 'unknown' }, { status: 404 })

  const linked = await prisma.assembly.updateMany({
    where: { id: assembly.id, OR: [{ rsvpEventId: null }, { rsvpEventId: message.eventId }] },
    data: { rsvpEventId: message.eventId, rsvpEventTitle: message.eventTitle || null }
  })
  if (linked.count !== 1) return NextResponse.json({ ok: false, error: 'conflict' }, { status: 409 })
  forgetRoster(assembly.id)
  return NextResponse.json({ ok: true, title: assembly.title })
}
