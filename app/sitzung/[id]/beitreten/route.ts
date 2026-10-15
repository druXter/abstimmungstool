// app/sitzung/[id]/beitreten/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { baseUrl } from '../../../lib/base-url'
import { verifyAssemblyAccess } from '../../../lib/assembly-coupling'
import { joinAssembly } from '../../../lib/assembly'

/**
 * Beitritt zu einer Sitzung über den Link aus rsvp-app (docs/KONZEPT-SITZUNG.md): prüft den Nachweis
 * (`assembly-access`), verknüpft eine noch freie Sitzung mit dem Termin, legt das Mitglied an und setzt das Cookie.
 * Danach weiter auf die Sitzungsseite ohne Nachweis in der Adresse. Ein Nachweis eines anderen Termins als des
 * verknüpften wird abgewiesen.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const to = (query = '') => {
    const response = NextResponse.redirect(new URL(`/sitzung/${id}${query}`, baseUrl()), 303)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  }

  const assembly = await prisma.assembly.findUnique({ where: { id }, select: { id: true, rsvpEventId: true } })
  const access = assembly ? verifyAssemblyAccess(new URL(request.url).searchParams.get('verify'), assembly.id) : null
  if (!assembly || !access) return to('?hinweis=beitritt-ungueltig')

  if (!assembly.rsvpEventId) {
    // Erste Meldung verknüpft (bedingt, falls gleichzeitig ein anderer Termin verknüpft)
    await prisma.assembly.updateMany({ where: { id: assembly.id, rsvpEventId: null }, data: { rsvpEventId: access.eventId } })
  }
  const linked = await prisma.assembly.findUnique({ where: { id: assembly.id }, select: { rsvpEventId: true } })
  if (linked?.rsvpEventId !== access.eventId) return to('?hinweis=anderer-termin')

  await joinAssembly(assembly.id, access.sub, access.name)
  return to()
}
