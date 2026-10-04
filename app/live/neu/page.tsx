import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '../../lib/auth'
import { canCreatePolls } from '../../lib/permissions'
import { createLive } from '../../live-actions'
import SubmitButton from '../../ui/submit-button'
import Notice from '../../ui/notice'
import QuestionsEditor from '../questions-editor'

export const dynamic = 'force-dynamic'

export default async function NewLivePage({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  const user = await requireUser('/live/neu')
  // Moderator-Konten legen nichts an (wie bei Abstimmungen) - dort steht die Erklärung.
  if (!canCreatePolls(user)) redirect('/erstellen')
  const { fehler } = await searchParams

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow space-y-6 text-gray-900">
        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Neue Live-Runde</h1>
          <Link href="/meine-abstimmungen" className="text-gray-500 hover:text-gray-800 transition">Abbrechen</Link>
        </div>
        <p className="text-sm text-gray-600">
          Wie bei Kahoot: Du zeigst die Fragen nacheinander auf einer Leinwand, alle antworten gleichzeitig auf dem Handy -
          ohne Konto, nur mit PIN und Spitzname. Mit markierter richtiger Antwort wird daraus ein Quiz mit Punkten und Rangliste.
        </p>
        {fehler === 'leer' && <Notice tone="error">Bitte gib einen Titel und mindestens eine Frage mit zwei Antworten ein.</Notice>}

        <form action={createLive} className="space-y-4">
          <div>
            <label htmlFor="live-title" className="block text-sm font-medium mb-1">Titel</label>
            <input
              id="live-title" name="title" required maxLength={200} placeholder="z.B. Vereinsquiz Sommerfest"
              className="w-full border border-gray-300 p-2 rounded"
            />
          </div>
          <QuestionsEditor />
          <SubmitButton>Live-Runde anlegen</SubmitButton>
        </form>
      </div>
    </main>
  )
}
