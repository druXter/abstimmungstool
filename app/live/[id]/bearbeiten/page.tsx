import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { canManageLive } from '../../../lib/live'
import { updateLive } from '../../../live-actions'
import SubmitButton from '../../../ui/submit-button'
import Notice from '../../../ui/notice'
import QuestionsEditor from '../../questions-editor'

export const dynamic = 'force-dynamic'

export default async function EditLivePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fehler?: string }> }) {
  const { id } = await params
  const { fehler } = await searchParams
  const session = await prisma.liveSession.findUnique({
    where: { id },
    include: { questions: { orderBy: { position: 'asc' }, include: { answers: { orderBy: { position: 'asc' } } } } }
  })
  if (!session) notFound()

  const user = await getCurrentUser()
  if (!canManageLive(user, session)) {
    if (!user) redirect(`/anmelden?next=${encodeURIComponent(`/live/${id}/bearbeiten`)}`)
    notFound()
  }
  // Nach den ersten Antworten passten Punkte und Verteilung nicht mehr zu geänderten Fragen.
  if (await prisma.liveResponse.count({ where: { question: { sessionId: id } } })) redirect(`/live/${id}/verwalten?fehler=gespielt`)

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow space-y-6 text-gray-900">
        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Live-Runde bearbeiten</h1>
          <Link href={`/live/${id}/verwalten`} className="text-gray-500 hover:text-gray-800 transition">Abbrechen</Link>
        </div>
        {fehler === 'leer' && <Notice tone="error">Bitte gib einen Titel und mindestens eine Frage mit zwei Antworten ein.</Notice>}

        <form action={updateLive} className="space-y-4">
          <input type="hidden" name="sessionId" value={id} />
          <div>
            <label htmlFor="live-title" className="block text-sm font-medium mb-1">Titel</label>
            <input id="live-title" name="title" required maxLength={200} defaultValue={session.title} className="w-full border border-gray-300 p-2 rounded" />
          </div>
          <QuestionsEditor
            initial={session.questions.map(q => ({
              text: q.text,
              timeLimit: q.timeLimit ?? 0,
              answers: q.answers.map(a => ({ label: a.label, correct: a.isCorrect }))
            }))}
          />
          <SubmitButton>Speichern</SubmitButton>
        </form>
      </div>
    </main>
  )
}
