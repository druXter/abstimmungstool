import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { getLiveLevel } from '../../../lib/live'
import { updateLive } from '../../../live-actions'
import SubmitButton from '../../../ui/submit-button'
import Notice from '../../../ui/notice'
import QuestionsEditor from '../../questions-editor'
import { ButtonLink, inputClass, labelClass } from '../../../ui/kit'
import LiveFrame from '../live-frame'

export const dynamic = 'force-dynamic'

export default async function EditLivePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fehler?: string }> }) {
  const { id } = await params
  const { fehler } = await searchParams
  const session = await prisma.liveSession.findUnique({
    where: { id },
    include: {
      owner: { select: { email: true, name: true } },
      questions: { orderBy: { position: 'asc' }, include: { answers: { orderBy: { position: 'asc' } } } }
    }
  })
  if (!session) notFound()

  const user = await getCurrentUser()
  const level = await getLiveLevel(user, session)
  if (!level) {
    if (!user) redirect(`/anmelden?next=${encodeURIComponent(`/live/${id}/bearbeiten`)}`)
    notFound()
  }
  // Nach den ersten Antworten passten Punkte und Verteilung nicht mehr zu geänderten Fragen.
  if (await prisma.liveResponse.count({ where: { question: { sessionId: id } } })) redirect(`/live/${id}/verwalten?fehler=gespielt`)

  return (
    <LiveFrame session={session} isOwner={level === 'owner'} editable>
      <div className="space-y-6">
        {fehler === 'leer' && <Notice tone="error">Bitte gib einen Titel und mindestens eine Frage mit zwei Antworten ein.</Notice>}

        <form action={updateLive} className="space-y-4">
          <input type="hidden" name="sessionId" value={id} />
          <div>
            <label htmlFor="live-title" className={labelClass}>Titel</label>
            <input id="live-title" name="title" required maxLength={200} defaultValue={session.title} className={inputClass} />
          </div>
          <QuestionsEditor
            initial={session.questions.map(q => ({
              text: q.text,
              kind: q.kind,
              timeLimit: q.timeLimit ?? 0,
              answers: q.answers.length > 0
                ? q.answers.map(a => ({ label: a.label, correct: a.isCorrect }))
                : Array.from({ length: 4 }, () => ({ label: '', correct: false })),
              target: q.target !== null ? String(q.target).replace('.', ',') : '',
              tolerance: q.tolerance !== null ? String(q.tolerance).replace('.', ',') : '',
              unit: q.unit ?? '',
              imageId: q.imageId,
              imageReveal: q.imageReveal
            }))}
          />
          <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-end gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border dark:border-gray-700 dark:bg-gray-900/95">
            <ButtonLink href={`/live/${id}/verwalten`} variant="ghost">Abbrechen</ButtonLink>
            <SubmitButton inline>Speichern</SubmitButton>
          </div>
        </form>
      </div>
    </LiveFrame>
  )
}
