import { prisma } from '../../../../lib/prisma'
import { getCurrentUser } from '../../../../lib/auth'
import { getLiveLevel, imageVisibleToPlayers } from '../../../../lib/live'
import { currentPlayer } from '../../../../lib/live-player'

export const dynamic = 'force-dynamic'

/**
 * Bild zu einer Frage (schema.prisma LiveImage). Sehen dürfen es nur, wer die Runde verwaltet und
 * wer ihr beigetreten ist - die Fragen einer Runde sind nicht öffentlich. Der Typ stammt aus der
 * Prüfung beim Hochladen (app/lib/live-images.ts); eine strenge CSP und nosniff sorgen dafür, dass
 * der Browser es nur als Bild behandelt. Ein Bild zum Aufdecken (LiveQuestion.imageReveal) bekommen
 * Teilnehmende erst ab der Auflösung - sonst ließe es sich über diese Adresse vorab ganz ansehen.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params
  const image = await prisma.liveImage.findUnique({
    where: { id: imageId },
    include: {
      session: { select: { id: true, ownerId: true, phase: true, currentIndex: true } },
      questions: { select: { position: true, imageReveal: true } }
    }
  })
  if (!image) return new Response('Not found', { status: 404 })

  const manager = await getLiveLevel(await getCurrentUser(), image.session)
  const player = !manager && (await currentPlayer(image.sessionId))
  const allowed = manager || (player && image.questions.every(q => imageVisibleToPlayers(q, image.session)))
  if (!allowed) return new Response('Not found', { status: 404 })

  return new Response(image.data, {
    headers: {
      'Content-Type': image.type,
      // Bilder ändern sich nie (neues Bild = neue ID) - privat, weil sie nicht öffentlich sind.
      'Cache-Control': 'private, max-age=86400, immutable',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff'
    }
  })
}
