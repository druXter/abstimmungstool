import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import { ensurePin, getLiveLevel, loadView, settleQuestion } from '../../../lib/live'
import Presenter from './presenter'

export const dynamic = 'force-dynamic'

/** Leinwand einer Live-Runde - für das besitzende Konto, Admins und Konten, mit denen sie geteilt ist. */
export default async function PresentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await prisma.liveSession.findUnique({ where: { id } })
  if (!session) notFound()

  const user = await getCurrentUser()
  if (!(await getLiveLevel(user, session))) {
    if (!user) redirect(`/anmelden?next=${encodeURIComponent(`/live/${id}/praesentieren`)}`)
    notFound()
  }

  // Eine vom Cleanup freigegebene PIN wird beim Öffnen der Leinwand neu vergeben.
  await ensurePin(session)
  await settleQuestion(id)
  const view = await loadView(id, null)
  if (!view) notFound()

  return <Presenter sessionId={id} initial={view} joinUrl={`${baseUrl()}/live`} />
}
