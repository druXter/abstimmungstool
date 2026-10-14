import Link from 'next/link'
import { prisma } from '../../lib/prisma'
import { getVoterToken } from '../../lib/voter'
import { answerField, isSurveyOpen, MAX_LONG_TEXT, MAX_SHORT_TEXT, scaleRange, surveyVoterKey } from '../../lib/survey'
import { submitSurvey } from '../../survey-actions'
import Notice from '../../ui/notice'
import SubmitButton from '../../ui/submit-button'
import { Card, inputClass } from '../../ui/kit'
import MultiChoice from './multi-choice'
import { CookieGate } from './embed-helpers'

// Rückmeldungen von submitSurvey (?hinweis=...). Nur feste Texte - ein unbekannter Wert zeigt nichts an. Kommt eine
// Abgabe nach dem Ende (?hinweis=geschlossen), zeigt die Seite ohnehin "beendet".
const NOTICES: Record<string, { tone: 'warning' | 'error'; text: string }> = {
  pflicht: { tone: 'error', text: 'Bitte beantworte alle Pflichtfragen - deine Antworten wurden nicht gespeichert.' },
  auswahl: { tone: 'error', text: 'Bei einer Frage passt die Auswahl nicht (z.B. zu viele Kreuze) - deine Antworten wurden nicht gespeichert.' },
  leer: { tone: 'error', text: 'Bitte beantworte mindestens eine Frage.' },
  gedrosselt: { tone: 'warning', text: 'Von deinem Netzwerk aus kamen in der letzten Stunde sehr viele Antworten. Bitte versuche es später noch einmal.' }
}

export type SurveySearch = { hinweis?: string; danke?: string }

/** Lädt einen Fragebogen samt Fragen zum Ausfüllen, null wenn es ihn nicht gibt. */
export async function loadSurveyForView(id: string) {
  return prisma.survey.findUnique({
    where: { id },
    include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' }, select: { id: true, label: true } } } } }
  })
}

type ViewSurvey = NonNullable<Awaited<ReturnType<typeof loadSurveyForView>>>

/**
 * Fragebogen zum Ausfüllen - dieselbe Ansicht auf /fragebogen/<id> und eingebettet
 * (/fragebogen/<id>/einbetten, `embed`). Ohne JavaScript bedienbar: Pflichtfragen über die
 * eingebaute Formularprüfung, Mehrfachauswahl zusätzlich im Browser (multi-choice.tsx), und
 * submitSurvey prüft alles noch einmal. Im Modus COOKIE mit den bisherigen Antworten vorausgefüllt.
 */
export default async function SurveyView({ survey, search, embed }: { survey: ViewSurvey; search: SurveySearch; embed: boolean }) {
  const open = isSurveyOpen(survey)
  const notice = search.hinweis && Object.hasOwn(NOTICES, search.hinweis) ? NOTICES[search.hinweis] : null
  const base = `/fragebogen/${survey.id}${embed ? '/einbetten' : ''}`

  const token = survey.identity === 'COOKIE' ? await getVoterToken() : null
  const mine = token
    ? await prisma.surveyResponse.findUnique({
        where: { surveyId_voterKey: { surveyId: survey.id, voterKey: surveyVoterKey(token) } },
        select: { answers: { select: { questionId: true, optionId: true, text: true, number: true } } }
      })
    : null
  const given = (questionId: string) => mine?.answers.filter(a => a.questionId === questionId) ?? []

  const header = (
    <div className="space-y-2">
      <h1 className={`${embed ? 'text-xl' : 'text-2xl'} font-semibold break-words`}>{survey.title}</h1>
      {survey.description && <p className="whitespace-pre-line text-sm text-gray-600 dark:text-gray-400">{survey.description}</p>}
    </div>
  )

  if (search.danke === '1') {
    return (
      <Card className="space-y-3" >
        {header}
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
          <p className="font-medium">Danke!</p>
          <p className="mt-1 whitespace-pre-line text-sm">{survey.thanksText || 'Deine Antworten sind angekommen.'}</p>
        </div>
        {survey.identity === 'COOKIE' && open && (
          <Link href={base} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">Antworten ansehen oder ändern</Link>
        )}
      </Card>
    )
  }

  if (!open) {
    return (
      <Card className="space-y-3">
        {header}
        <Notice tone="info">Dieser Fragebogen ist beendet - Antworten sind nicht mehr möglich.</Notice>
      </Card>
    )
  }

  const form = (
    <form action={submitSurvey} className="space-y-4">
      <input type="hidden" name="surveyId" value={survey.id} />
      {embed && <input type="hidden" name="embed" value="1" />}
      {survey.questions.map((q, i) => {
        const name = answerField(q.id)
        const mineHere = given(q.id)
        const legend = (
          <legend className="font-medium">
            {i + 1}. {q.text}
            {q.required && <span className="ml-1 text-red-700 dark:text-red-300" title="Pflichtfrage">*</span>}
          </legend>
        )
        const hint = q.hint || (q.kind === 'MULTI' ? (q.maxChoices ? `Höchstens ${q.maxChoices} ankreuzen.` : 'Mehrere Antworten möglich.') : null)
        return (
          // Trennlinie am umgebenden div: Ein Rahmen am fieldset würde neben der Frage (legend) verlaufen.
          <div key={q.id} className="border-t border-gray-100 pt-4 first-of-type:border-0 first-of-type:pt-0 dark:border-gray-700">
          <fieldset className="space-y-2" data-testid="survey-field">
            {legend}
            {hint && <p className="-mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}

            {q.kind === 'SINGLE' && (
              <div className="space-y-1.5">
                {q.options.map(o => (
                  <label key={o.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <input type="radio" name={name} value={o.id} required={q.required} defaultChecked={mineHere.some(a => a.optionId === o.id)} className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="text-sm">{o.label}</span>
                  </label>
                ))}
              </div>
            )}

            {q.kind === 'MULTI' && (
              <MultiChoice name={name} options={q.options} required={q.required} max={q.maxChoices} initial={mineHere.flatMap(a => (a.optionId ? [a.optionId] : []))} />
            )}

            {q.kind === 'TEXT' && (q.multiline
              ? <textarea name={name} aria-label={q.text} required={q.required} maxLength={MAX_LONG_TEXT} rows={4} defaultValue={mineHere[0]?.text ?? ''} className={inputClass} />
              : <input name={name} aria-label={q.text} required={q.required} maxLength={MAX_SHORT_TEXT} defaultValue={mineHere[0]?.text ?? ''} className={inputClass} />
            )}

            {q.kind === 'SCALE' && <ScaleInput name={name} question={q} required={q.required} value={mineHere[0]?.number ?? null} />}
          </fieldset>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {survey.questions.some(q => q.required) && <><span className="text-red-700 dark:text-red-300">*</span> Pflichtfrage · </>}
          {survey.identity === 'ANONYMOUS' ? 'Anonym, ohne Konto.' : 'Ohne Konto, eine Antwort pro Gerät.'}{' '}
          <a href="/datenschutz" target="_blank" rel="noopener" className="underline">Datenschutz</a>
        </p>
        <SubmitButton inline>{mine ? 'Änderungen speichern' : 'Absenden'}</SubmitButton>
      </div>
    </form>
  )

  return (
    <Card className="space-y-5">
      {header}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {mine && <Notice tone="info">Du hast schon geantwortet. Du kannst deine Antworten ändern, solange der Fragebogen läuft.</Notice>}
      {embed && survey.identity === 'COOKIE' ? <CookieGate href={`/fragebogen/${survey.id}`}>{form}</CookieGate> : form}
    </Card>
  )
}

/** Lineare Skala als Reihe von Knöpfen (Radiobuttons darunter, mit Tastatur bedienbar), Beschriftung der Enden darunter. */
function ScaleInput({ name, question, required, value }: {
  name: string
  question: { text: string; scaleMin: number | null; scaleMax: number | null; minLabel: string | null; maxLabel: string | null }
  required: boolean
  value: number | null
}) {
  const { min, max } = scaleRange(question)
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return (
    <div className="space-y-1">
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
        {values.map(v => (
          <label key={v} className="cursor-pointer">
            <input type="radio" name={name} value={v} required={required} defaultChecked={value === v} aria-label={`${v}${v === min && question.minLabel ? ` (${question.minLabel})` : ''}${v === max && question.maxLabel ? ` (${question.maxLabel})` : ''}`} className="peer sr-only" />
            <span className="flex h-10 items-center justify-center rounded-lg border border-gray-300 text-sm font-medium tabular-nums transition hover:bg-gray-50 peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300 dark:border-gray-600 dark:hover:bg-gray-700 dark:peer-checked:bg-blue-600">
              {v}
            </span>
          </label>
        ))}
      </div>
      {(question.minLabel || question.maxLabel) && (
        <div className="flex justify-between gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span>{question.minLabel}</span>
          <span className="text-right">{question.maxLabel}</span>
        </div>
      )}
    </div>
  )
}
