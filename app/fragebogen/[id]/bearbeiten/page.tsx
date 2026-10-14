import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { toInputValue } from '../../../lib/date-options'
import { DEFAULT_SCALE, getSurveyLevel, KIND_LABELS, MAX_SUBMIT_LIMIT, MIN_SUBMIT_LIMIT } from '../../../lib/survey'
import { updateSurvey } from '../../../survey-actions'
import SubmitButton from '../../../ui/submit-button'
import Notice from '../../../ui/notice'
import { ButtonLink, Card, hintClass, inputClass, labelClass } from '../../../ui/kit'
import QuestionsEditor from '../../questions-editor'
import IdentityFields from '../../identity-fields'
import SurveyFrame from '../survey-frame'

export const dynamic = 'force-dynamic'

/**
 * Fragebogen bearbeiten: Grunddaten (Titel, Beschreibung, Danke-Text, Enddatum) jederzeit, Fragen und "wer darf
 * antworten" nur, solange niemand geantwortet hat (updateSurvey prüft das selbst noch einmal).
 */
export default async function EditSurveyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fehler?: string; gespeichert?: string }> }) {
  const { id } = await params
  const { fehler, gespeichert } = await searchParams
  const survey = await prisma.survey.findUnique({
    where: { id },
    include: {
      owner: { select: { email: true, name: true } },
      questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } },
      _count: { select: { responses: true } }
    }
  })
  if (!survey) notFound()

  const user = await getCurrentUser()
  const level = await getSurveyLevel(user, survey)
  if (!level) {
    if (!user) redirect(`/anmelden?next=${encodeURIComponent(`/fragebogen/${id}/bearbeiten`)}`)
    notFound()
  }
  const answered = survey._count.responses > 0

  return (
    <SurveyFrame survey={survey} isOwner={level === 'owner'}>
      <form action={updateSurvey} className="space-y-4">
        <input type="hidden" name="surveyId" value={id} />
        {!answered && <input type="hidden" name="withQuestions" value="1" />}
        {gespeichert === '1' && <Notice tone="success">Gespeichert.</Notice>}
        {fehler === 'leer' && <Notice tone="error">Bitte gib mindestens eine Frage ein (Auswahlfragen mit zwei Optionen).</Notice>}
        {fehler === 'titel' && <Notice tone="error">Bitte gib einen Titel ein.</Notice>}

        <Card className="space-y-4">
          <h2 className="font-semibold">Grunddaten</h2>
          <div>
            <label htmlFor="survey-title" className={labelClass}>Titel</label>
            <input id="survey-title" name="title" required maxLength={200} defaultValue={survey.title} className={inputClass} />
          </div>
          <div>
            <label htmlFor="survey-description" className={labelClass}>Beschreibung (optional)</label>
            <textarea id="survey-description" name="description" maxLength={2000} rows={3} defaultValue={survey.description ?? ''} className={inputClass} />
          </div>
          <div>
            <label htmlFor="survey-thanks" className={labelClass}>Text nach dem Absenden (optional)</label>
            <textarea id="survey-thanks" name="thanksText" maxLength={1000} rows={2} defaultValue={survey.thanksText ?? ''} placeholder="Deine Antworten sind angekommen." className={inputClass} />
          </div>
          <div>
            <label htmlFor="survey-closes-at" className={labelClass}>Automatisch beenden am (optional)</label>
            <input id="survey-closes-at" type="datetime-local" name="closesAt" defaultValue={survey.closesAt ? toInputValue(survey.closesAt, 'DATETIME') : ''} className={inputClass.replace('w-full', 'w-full sm:w-64')} />
            <p className={hintClass}>Danach sind keine Antworten mehr möglich. Von Hand schließen geht jederzeit oben rechts.</p>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200 cursor-pointer">
              <input type="checkbox" name="numbered" defaultChecked={survey.numbered} className="h-4 w-4" />
              Fragen nummerieren
            </label>
            <p className={hintClass}>
              Nummern zählen nur Fragen mit sichtbarem Titel. Eine Überschrift, auf die Fragen mit ausgeblendetem Titel folgen, gilt als
              deren Titel und bekommt die Nummer. Aus: keine Nummern, auch nicht in Auswertung und CSV.
            </p>
          </div>
          <IdentityFields value={survey.identity} locked={answered} />
          <div>
            <label htmlFor="survey-submit-limit" className={labelClass}>Höchstens Abgaben pro Stunde und Netzwerk</label>
            <input id="survey-submit-limit" type="number" name="submitLimit" min={MIN_SUBMIT_LIMIT} max={MAX_SUBMIT_LIMIT} defaultValue={survey.submitLimit} className={inputClass.replace('w-full', 'w-32')} />
            <p className={hintClass}>
              Schutz gegen Skripte. Ein Netzwerk ist eine IPv4-Adresse (z.B. ein ganzes Uni-WLAN hinter einem NAT) bzw. ein IPv6-Netz
              (/64); ein einzelnes Gerät mit eigener IPv6-Adresse höchstens 30. Lehnt die Drosselung Abgaben ab, steht das in der
              Übersicht - vor einer großen Veranstaltung im selben WLAN hier hochsetzen.
            </p>
          </div>
          {/* Gesperrte Radiobuttons werden nicht mitgeschickt - updateSurvey lässt die Einstellung dann unverändert. */}
        </Card>

        {answered ? (
          <Card className="space-y-3">
            <h2 className="font-semibold">Fragen</h2>
            <Notice tone="info">
              Es gibt schon {survey._count.responses} Antwort{survey._count.responses === 1 ? '' : 'en'} - die Fragen lassen sich nicht mehr
              ändern, sonst passten die Antworten nicht mehr dazu. Nach einem Probedurchlauf: unter &quot;Übersicht&quot; alle Antworten löschen.
            </Notice>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {survey.questions.map(q => (
                <li key={q.id}>{q.text || q.hint?.slice(0, 80)} <span className="text-xs text-gray-500 dark:text-gray-400">({KIND_LABELS[q.kind]}{q.required ? ', Pflicht' : ''}{q.hideTitle ? ', Titel ausgeblendet' : ''})</span></li>
              ))}
            </ol>
          </Card>
        ) : (
          <QuestionsEditor
            initial={survey.questions.map(q => ({
              text: q.text,
              hint: q.hint ?? '',
              kind: q.kind,
              required: q.required,
              hideTitle: q.hideTitle,
              options: q.options.filter(o => !o.isRow).length >= 2 ? q.options.filter(o => !o.isRow).map(o => o.label) : ['', ''],
              optionsText: q.options.filter(o => !o.isRow).length >= 2 ? q.options.filter(o => !o.isRow).map(o => o.allowText) : [false, false],
              rows: q.options.some(o => o.isRow) ? q.options.filter(o => o.isRow).map(o => o.label) : ['', ''],
              rowsRight: q.options.some(o => o.isRow) ? q.options.filter(o => o.isRow).map(o => o.labelRight ?? '') : ['', ''],
              maxChoices: q.maxChoices ?? 0,
              multiline: q.multiline,
              scaleMin: q.scaleMin ?? DEFAULT_SCALE.min,
              scaleMax: q.scaleMax ?? DEFAULT_SCALE.max,
              minLabel: q.minLabel ?? '',
              maxLabel: q.maxLabel ?? '',
              optOutLabel: q.optOutLabel ?? ''
            }))}
          />
        )}

        <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-end gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border dark:border-gray-700 dark:bg-gray-900/95">
          <ButtonLink href={`/fragebogen/${id}/verwalten`} variant="ghost">Abbrechen</ButtonLink>
          <SubmitButton inline>Speichern</SubmitButton>
        </div>
      </form>
    </SurveyFrame>
  )
}
