import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCurrentUser } from '../../lib/auth'
import { getSurveyLevel } from '../../lib/survey'
import { ButtonLink } from '../../ui/kit'
import { surveyLang } from '../../lib/survey-i18n'
import SurveyView, { loadSurveyForView, type SurveySearch } from './survey-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const survey = await loadSurveyForView((await params).id)
  return survey ? { title: survey.title } : {}
}

/** Fragebogen zum Ausfüllen (ohne Konto), mit Kopfzeile. Eingebettet: ./einbetten. */
export default async function SurveyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SurveySearch> }) {
  const survey = await loadSurveyForView((await params).id)
  if (!survey) notFound()
  // Nur ein Komfort-Link für Verwaltende - die Verwaltungsseite prüft selbst.
  const user = await getCurrentUser()
  const manageable = !!user && !!(await getSurveyLevel(user, survey))
  const search = await searchParams

  return (
    <main className="px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        {manageable && (
          <div className="flex justify-end">
            <ButtonLink href={`/fragebogen/${survey.id}/verwalten`} size="sm">Verwalten</ButtonLink>
          </div>
        )}
        <SurveyView survey={survey} search={search} embed={false} lang={surveyLang(search.lang)} />
      </div>
    </main>
  )
}
