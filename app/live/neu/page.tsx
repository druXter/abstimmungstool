import { redirect } from 'next/navigation'
import { requireUser } from '../../lib/auth'
import { canCreatePolls } from '../../lib/permissions'
import { createLive } from '../../live-actions'
import SubmitButton from '../../ui/submit-button'
import Notice from '../../ui/notice'
import QuestionsEditor from '../questions-editor'
import { Card, inputClass, labelClass, Main, PageHeader } from '../../ui/kit'

export const dynamic = 'force-dynamic'

export default async function NewLivePage({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  const user = await requireUser('/live/neu')
  // Moderator-Konten legen nichts an (wie bei Abstimmungen) - dort steht die Erklärung.
  if (!canCreatePolls(user)) redirect('/erstellen')
  const { fehler } = await searchParams

  return (
    <Main width="narrow">
      <PageHeader
        title="Neue Live-Runde"
        back={{ href: '/meine-abstimmungen', label: 'Alle Abstimmungen' }}
        subtitle={<>Wie bei Kahoot: Du zeigst die Fragen nacheinander auf einer Leinwand, alle antworten gleichzeitig auf dem Handy -
          ohne Konto, nur mit PIN und Spitzname. Mit markierter richtiger Antwort wird daraus ein Quiz mit Punkten und Rangliste.</>}
      />
      <div className="space-y-6">
        {fehler === 'leer' && <Notice tone="error">Bitte gib einen Titel und mindestens eine Frage mit zwei Antworten ein.</Notice>}

        <form action={createLive} className="space-y-4">
          <Card>
            <label htmlFor="live-title" className={labelClass}>Titel</label>
            <input id="live-title" name="title" required maxLength={200} placeholder="z.B. Vereinsquiz Sommerfest" className={inputClass} />
          </Card>
          <QuestionsEditor />
          <div className="flex justify-end">
            <SubmitButton inline>Live-Runde anlegen</SubmitButton>
          </div>
        </form>
      </div>
    </Main>
  )
}
