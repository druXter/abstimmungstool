import { getCurrentUser } from '../../../lib/auth'
import { prisma } from '../../../lib/prisma'
import { currentPlayer } from '../../../lib/live-player'
import { ANSWER_GRACE_MS, getLiveLevel, loadView, settleQuestion, waitForLive } from '../../../lib/live'

export const dynamic = 'force-dynamic'

/** So lange hält eine Anfrage höchstens offen - deutlich unter den 100 s, nach denen Cloudflare abbricht. */
const HOLD_MS = 25_000
/** Nachsehen auch ohne Signal (falls es je mehrere Prozesse gibt, siehe app/lib/live.ts). */
const POLL_FALLBACK_MS = 5_000

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Long-Polling für Leinwand (`?as=host`, nur mit Berechtigung) und Teilnehmende (Cookie der
 * Runde). `?sig=` ist der Fingerabdruck der zuletzt gesehenen Ansicht: Solange er gleich bleibt,
 * wartet die Anfrage auf ein Signal (app/lib/live.ts notifyLive), das Ende des Zeitlimits oder
 * HOLD_MS und antwortet dann. Bewusst kein WebSocket/SSE: normale, kurze HTTP-Antworten laufen
 * ohne Sonderkonfiguration durch Cloudflare und Nginx (kein Puffern, keine Upgrade-Header).
 *
 * 404 = Runde gibt es nicht (mehr) bzw. keine Berechtigung, 410 = diese Person ist nicht (mehr)
 * Teil der Runde (entfernt oder "Neu starten").
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(request.url)
  const asHost = url.searchParams.get('as') === 'host'
  const since = url.searchParams.get('sig') ?? ''

  const session = await prisma.liveSession.findUnique({ where: { id }, select: { id: true, ownerId: true } })
  if (!session) return Response.json({ error: 'not-found' }, { status: 404, headers: NO_STORE })

  let playerId: string | null = null
  if (asHost) {
    if (!(await getLiveLevel(await getCurrentUser(), session))) return Response.json({ error: 'not-found' }, { status: 404, headers: NO_STORE })
  } else {
    const player = await currentPlayer(id)
    if (!player) return Response.json({ error: 'gone' }, { status: 410, headers: NO_STORE })
    playerId = player.id
  }

  const deadline = Date.now() + HOLD_MS
  for (;;) {
    await settleQuestion(id)
    const view = await loadView(id, playerId)
    if (!view) return Response.json({ error: playerId ? 'gone' : 'not-found' }, { status: playerId ? 410 : 404, headers: NO_STORE })
    if (view.sig !== since || Date.now() >= deadline) return Response.json(view, { headers: NO_STORE })

    // Zum Ende des Zeitlimits aufwachen, damit die Auflösung pünktlich kommt.
    let wakeAt = Math.min(deadline, Date.now() + POLL_FALLBACK_MS)
    if (view.question?.endsAt) wakeAt = Math.min(wakeAt, Math.max(view.question.endsAt + ANSWER_GRACE_MS + 50, Date.now() + 100))
    await waitForLive(id, wakeAt - Date.now(), { activity: asHost, abort: request.signal })
    if (request.signal.aborted) return new Response(null, { status: 499 })
  }
}
