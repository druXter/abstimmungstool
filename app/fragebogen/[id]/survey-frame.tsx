import Link from 'next/link'
import type { ReactNode } from 'react'
import type { SurveyIdentity } from '@prisma/client'
import { closeSurvey, reopenSurvey } from '../../survey-actions'
import { IDENTITY_LABELS, isSurveyOpen } from '../../lib/survey'
import { Badge, ButtonLink, buttonClass, formatShortDate, Main } from '../../ui/kit'
import NavLink from '../../ui/nav-link'

type FrameSurvey = {
  id: string
  title: string
  identity: SurveyIdentity
  closedAt: Date | null
  closesAt: Date | null
  owner: { email: string; name: string | null }
}

/**
 * Rahmen der Verwaltung eines Fragebogens (docs/KONZEPT-FRAGEBOGEN.md), aufgebaut wie der einer Live-Runde: Kopf
 * mit Titel, Stand und indigo Themenmarke, rechts "Fragebogen öffnen" und Schließen/Wieder öffnen, darunter die
 * Reiter Übersicht und Bearbeiten.
 */
export default function SurveyFrame({ survey, isOwner, children }: { survey: FrameSurvey; isOwner: boolean; children: ReactNode }) {
  const open = isSurveyOpen(survey)
  const hidden = <input type="hidden" name="surveyId" value={survey.id} />
  return (
    <Main>
      <div className="mb-4">
        <Link href="/meine-abstimmungen" className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">← Alle Abstimmungen</Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 break-words">{survey.title}</h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={open ? 'indigo' : 'gray'}>Fragebogen · {open ? 'offen' : 'beendet'}</Badge>
              <Badge>{IDENTITY_LABELS[survey.identity].short}</Badge>
              {open && survey.closesAt && <Badge>endet {formatShortDate(survey.closesAt)}</Badge>}
              {!isOwner && <Badge tone="teal">freigegeben von {survey.owner.name || survey.owner.email}</Badge>}
            </div>
            {!isOwner && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Du verwaltest diesen Fragebogen von {survey.owner.name || survey.owner.email} mit: Bearbeiten, Schließen und Exportieren
                sind erlaubt, Antworten löschen, Löschen und Teilen nicht.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/fragebogen/${survey.id}`} external>Fragebogen öffnen ↗</ButtonLink>
            <form action={open ? closeSurvey : reopenSurvey}>
              {hidden}
              <button type="submit" className={buttonClass(open ? 'secondary' : 'primary')}>{open ? 'Jetzt schließen' : 'Wieder öffnen'}</button>
            </form>
          </div>
        </div>
      </div>
      <nav className="-mx-4 mb-6 flex overflow-x-auto border-b border-gray-200 px-4 dark:border-gray-700" aria-label="Bereiche des Fragebogens">
        <NavLink href={`/fragebogen/${survey.id}/verwalten`} exact variant="tab">Übersicht</NavLink>
        <NavLink href={`/fragebogen/${survey.id}/bearbeiten`} exact variant="tab">Bearbeiten</NavLink>
      </nav>
      {children}
    </Main>
  )
}
