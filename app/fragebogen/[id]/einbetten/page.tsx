import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import SurveyView, { loadSurveyForView, type SurveySearch } from '../survey-view'
import { EmbedRoot } from '../embed-helpers'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const survey = await loadSurveyForView((await params).id)
  return survey ? { title: survey.title, robots: { index: false } } : {}
}

/**
 * Fragebogen zum Einbetten per iFrame (docs/KONZEPT-FRAGEBOGEN.md): ohne Kopf- und Fußzeile (globals.css,
 * [data-embed]), meldet seine Höhe an die einbettende Seite. Die EINZIGE Seite, die in fremden Seiten
 * erscheinen darf - frame-ancestors setzt proxy.ts aus EMBED_ALLOWED_ORIGINS.
 */
export default async function EmbeddedSurveyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SurveySearch> }) {
  const survey = await loadSurveyForView((await params).id)
  if (!survey) notFound()
  return (
    <EmbedRoot surveyId={survey.id}>
      <SurveyView survey={survey} search={await searchParams} embed />
    </EmbedRoot>
  )
}
