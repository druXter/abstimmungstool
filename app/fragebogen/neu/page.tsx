import { redirect } from 'next/navigation'
import { requireUser } from '../../lib/auth'
import { canCreatePolls } from '../../lib/permissions'
import { createSurvey } from '../../survey-actions'
import SubmitButton from '../../ui/submit-button'
import Notice from '../../ui/notice'
import QuestionsEditor from '../questions-editor'
import IdentityFields from '../identity-fields'
import { Card, hintClass, inputClass, labelClass, Main, PageHeader } from '../../ui/kit'

export const dynamic = 'force-dynamic'

export default async function NewSurveyPage({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  const user = await requireUser('/fragebogen/neu')
  // Moderator-Konten legen nichts an (wie bei Abstimmungen) - dort steht die Erklärung.
  if (!canCreatePolls(user)) redirect('/erstellen')
  const { fehler } = await searchParams

  return (
    <Main width="narrow">
      <PageHeader
        title="Neuer Fragebogen"
        back={{ href: '/meine-abstimmungen', label: 'Alle Abstimmungen' }}
        subtitle={<>Mehrere Fragen zum Ausfüllen ohne Konto - mit Einfach- und Mehrfachauswahl, Freitext und linearer Skala,
          z.B. als Feedback nach einem Event. Lässt sich per Link teilen oder in eine andere App einbetten.</>}
      />
      <div className="space-y-6">
        {fehler === 'leer' && <Notice tone="error">Bitte gib einen Titel und mindestens eine Frage ein (Auswahlfragen mit zwei Optionen).</Notice>}

        <form action={createSurvey} className="space-y-4">
          <Card className="space-y-4">
            <div>
              <label htmlFor="survey-title" className={labelClass}>Titel</label>
              <input id="survey-title" name="title" required maxLength={200} placeholder="z.B. Feedback zur Erstiwoche" className={inputClass} />
            </div>
            <div>
              <label htmlFor="survey-description" className={labelClass}>Beschreibung (optional)</label>
              <textarea id="survey-description" name="description" maxLength={2000} rows={3} className={inputClass} />
              <p className={hintClass}>Steht über den Fragen, z.B. wozu das Feedback dient und wie lange das Ausfüllen dauert.</p>
            </div>
            <IdentityFields value="ANONYMOUS" />
          </Card>
          <QuestionsEditor />
          <div className="flex justify-end">
            <SubmitButton inline>Fragebogen anlegen</SubmitButton>
          </div>
        </form>
      </div>
    </Main>
  )
}
