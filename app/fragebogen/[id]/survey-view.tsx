import Link from 'next/link'
import { prisma } from '../../lib/prisma'
import { getVoterToken } from '../../lib/voter'
import { answerField, isGrid, isSurveyOpen, OPT_OUT_VALUE, otherTextField, questionNumbers, scaleRowLabel, splitOptions, MAX_LONG_TEXT, MAX_SHORT_TEXT, scaleRange, surveyVoterKey } from '../../lib/survey'
import { surveyTexts, withLang, type SurveyLang } from '../../lib/survey-i18n'
import { HONEYPOT_FIELD, issueFormToken } from '../../lib/survey-token'
import { submitSurvey } from '../../survey-actions'
import Notice from '../../ui/notice'
import SubmitButton from '../../ui/submit-button'
import { Card, inputClass } from '../../ui/kit'
import MultiChoice from './multi-choice'
import GridInput from './grid-input'
import { CookieGate, OtherText } from './embed-helpers'

// Rückmeldungen von submitSurvey (?hinweis=...), Texte in app/lib/survey-i18n.ts. Ein unbekannter Wert zeigt nichts
// an. Kommt eine Abgabe nach dem Ende (?hinweis=geschlossen), zeigt die Seite ohnehin "beendet".
const NOTICE_TONES: Record<string, 'warning' | 'error'> = { pflicht: 'error', auswahl: 'error', leer: 'error', gedrosselt: 'warning', ungueltig: 'warning', 'zu-schnell': 'warning' }

export type SurveySearch = { hinweis?: string; danke?: string; lang?: string }

/** Lädt einen Fragebogen samt Fragen zum Ausfüllen, null wenn es ihn nicht gibt. */
export async function loadSurveyForView(id: string) {
  return prisma.survey.findUnique({
    where: { id },
    include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' }, select: { id: true, label: true, isRow: true, labelRight: true, allowText: true } } } } }
  })
}

type ViewSurvey = NonNullable<Awaited<ReturnType<typeof loadSurveyForView>>>

/**
 * Fragebogen zum Ausfüllen - dieselbe Ansicht auf /fragebogen/<id> und eingebettet
 * (/fragebogen/<id>/einbetten, `embed`). Ohne JavaScript bedienbar: Pflichtfragen über die
 * eingebaute Formularprüfung, Mehrfachauswahl zusätzlich im Browser (multi-choice.tsx), und
 * submitSurvey prüft alles noch einmal. Im Modus COOKIE mit den bisherigen Antworten vorausgefüllt. Feste Texte
 * je nach `lang` (?lang=en) auf Deutsch oder Englisch, die Fragen selbst so, wie die Verwaltung sie geschrieben hat.
 */
export default async function SurveyView({ survey, search, embed, lang }: { survey: ViewSurvey; search: SurveySearch; embed: boolean; lang: SurveyLang }) {
  const t = surveyTexts(lang)
  const open = isSurveyOpen(survey)
  const notice = search.hinweis && Object.hasOwn(NOTICE_TONES, search.hinweis) ? { tone: NOTICE_TONES[search.hinweis], text: t.notices[search.hinweis] } : null
  const base = `/fragebogen/${survey.id}${embed ? '/einbetten' : ''}`

  const token = survey.identity === 'COOKIE' ? await getVoterToken() : null
  const mine = token
    ? await prisma.surveyResponse.findUnique({
        where: { surveyId_voterKey: { surveyId: survey.id, voterKey: surveyVoterKey(token) } },
        select: { answers: { select: { questionId: true, optionId: true, rowId: true, text: true, number: true, optOut: true } } }
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
          <p className="font-medium">{t.thanks}</p>
          <p className="mt-1 whitespace-pre-line text-sm">{survey.thanksText || t.thanksDefault}</p>
        </div>
        {survey.identity === 'COOKIE' && open && (
          <Link href={withLang(base, lang)} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">{t.viewOrChange}</Link>
        )}
      </Card>
    )
  }

  if (!open) {
    return (
      <Card className="space-y-3">
        {header}
        <Notice tone="info">{t.closed}</Notice>
      </Card>
    )
  }

  const numbers = questionNumbers(survey.questions, survey.numbered).shown
  const form = (
    <form action={submitSurvey} className="space-y-4">
      <input type="hidden" name="surveyId" value={survey.id} />
      {embed && <input type="hidden" name="embed" value="1" />}
      {lang === 'en' && <input type="hidden" name="lang" value="en" />}
      {/* Einmal-Token gegen Skripte und ein Lockfeld für Bots (app/lib/survey-token.ts): für Menschen unsichtbar, für
          Screenreader verborgen und nicht per Tab erreichbar. */}
      <input type="hidden" name="formToken" value={issueFormToken(survey.id)} />
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>{t.honeypot}<input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" /></label>
      </div>
      {survey.questions.map(q => {
        const name = answerField(q.id)
        const mineHere = given(q.id)
        const { columns, rows } = splitOptions(q.options)
        const number = numbers.get(q.id)
        // Ohne sichtbaren Titel (und ohne Hinweis) gehört die Frage optisch zum Block davor: keine Trennlinie, wenig Abstand.
        const attached = q.hideTitle && !q.hint
        // Trennlinie am umgebenden div: Ein Rahmen am fieldset würde neben der Frage (legend) verlaufen.
        const block = `${attached ? '-mt-2' : 'border-t border-gray-100 pt-4 first-of-type:border-0 first-of-type:pt-0 dark:border-gray-700'}`

        if (q.kind === 'INFO') {
          return (
            <div key={q.id} className={block} data-testid="survey-info">
              {q.text && <h2 className="font-medium">{number && `${number}. `}{q.text}</h2>}
              {q.hint && <p className={`whitespace-pre-line text-sm text-gray-600 dark:text-gray-400 ${q.text ? 'mt-1' : ''}`}>{q.hint}</p>}
            </div>
          )
        }

        const legend = (
          <legend className={q.hideTitle ? 'sr-only' : 'font-medium'}>
            {number && `${number}. `}{q.text}
            {q.required && <span className="ml-1 text-red-700 dark:text-red-300" title={t.required}>*</span>}
          </legend>
        )
        const hint = q.hint || (q.kind === 'MULTI'
          ? (q.maxChoices ? t.maxChoices(q.maxChoices) : t.multiple)
          : q.kind === 'GRID_MULTI' ? t.gridMultiple : null)
        // Ausgeblendeter Titel einer Pflichtfrage: Raster markieren jede Zeile, alle anderen bekommen einen kurzen Hinweis.
        const rowsMarked = q.hideTitle && q.required && (isGrid(q.kind) || q.kind === 'SCALE_GRID')
        return (
          <div key={q.id} className={block}>
          <fieldset className="space-y-2" data-testid="survey-field">
            {legend}
            {hint && <p className={`${q.hideTitle ? '' : '-mt-1'} text-xs text-gray-500 dark:text-gray-400`}>{hint}</p>}
            {q.hideTitle && q.required && !rowsMarked && <p className="text-xs text-gray-500 dark:text-gray-400">{t.required} <span className="text-red-700 dark:text-red-300">*</span></p>}

            {q.kind === 'SINGLE' && (
              <div className="space-y-1.5">
                {columns.map(o => (
                  <div key={o.id}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <input id={`${name}_${o.id}`} type="radio" name={name} value={o.id} required={q.required} defaultChecked={mineHere.some(a => a.optionId === o.id)} className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="text-sm">{o.label}</span>
                    </label>
                    {o.allowText && (
                      <OtherText
                        name={otherTextField(q.id, o.id)} targetId={`${name}_${o.id}`} label={t.otherLabel(o.label)} placeholder={t.otherPlaceholder}
                        defaultValue={mineHere.find(a => a.optionId === o.id)?.text ?? ''}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {q.kind === 'MULTI' && (
              <MultiChoice
                name={name} options={columns} required={q.required} max={q.maxChoices} initial={mineHere.flatMap(a => (a.optionId ? [a.optionId] : []))}
                texts={Object.fromEntries(mineHere.flatMap(a => (a.optionId && a.text ? [[a.optionId, a.text]] : [])))} otherFields={Object.fromEntries(columns.filter(o => o.allowText).map(o => [o.id, otherTextField(q.id, o.id)]))}
                lang={lang}
              />
            )}

            {q.kind === 'TEXT' && (q.multiline
              ? <textarea name={name} aria-label={q.text} required={q.required} maxLength={MAX_LONG_TEXT} rows={4} defaultValue={mineHere[0]?.text ?? ''} className={inputClass} />
              : <input name={name} aria-label={q.text} required={q.required} maxLength={MAX_SHORT_TEXT} defaultValue={mineHere[0]?.text ?? ''} className={inputClass} />
            )}

            {isGrid(q.kind) && (
              <GridInput
                questionId={q.id} rows={rows} columns={columns} multiple={q.kind === 'GRID_MULTI'} required={q.required} markRows={rowsMarked} lang={lang}
                initial={mineHere.flatMap(a => (a.rowId && a.optionId ? [`${a.rowId}:${a.optionId}`] : []))}
              />
            )}

            {q.kind === 'SCALE' && <ScaleInput name={name} question={q} required={q.required} value={mineHere[0]?.number ?? null} />}

            {q.kind === 'SCALE_GRID' && (
              <ScaleGridInput
                questionId={q.id} question={q} rows={rows} required={q.required} markRows={rowsMarked}
                values={new Map(mineHere.flatMap(a => (a.rowId && (a.number !== null || a.optOut) ? [[a.rowId, a.optOut ? OPT_OUT_VALUE : a.number!] as const] : [])))}
              />
            )}
          </fieldset>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {survey.questions.some(q => q.required) && <><span className="text-red-700 dark:text-red-300">*</span> {t.required} · </>}
          {survey.identity === 'ANONYMOUS' ? t.anonymous : t.perDevice}{' '}
          <a href="/datenschutz" target="_blank" rel="noopener" className="underline">{t.privacy}</a>
        </p>
        <SubmitButton inline>{mine ? t.saveChanges : t.submit}</SubmitButton>
      </div>
    </form>
  )

  return (
    <Card className="space-y-5">
      {header}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {mine && <Notice tone="info">{t.alreadyAnswered}</Notice>}
      {embed && survey.identity === 'COOKIE' ? <CookieGate href={withLang(`/fragebogen/${survey.id}`, lang)} lang={lang}>{form}</CookieGate> : form}
    </Card>
  )
}

/** Ein Wert einer Skala als Knopf (Radiobutton darunter, nur für Screenreader sichtbar und mit Tastatur bedienbar). */
function ScaleButton({ name, value, required, checked, label, text, wide = false }: {
  name: string; value: number | string; required: boolean; checked: boolean; label: string; text?: string; wide?: boolean
}) {
  return (
    <label className="cursor-pointer">
      <input type="radio" name={name} value={value} required={required} defaultChecked={checked} aria-label={label} className="peer sr-only" />
      <span className={`flex h-10 items-center justify-center rounded-lg border border-gray-300 text-sm ${wide ? 'whitespace-nowrap px-3 text-gray-600 dark:text-gray-300 border-dashed' : 'font-medium tabular-nums'} transition hover:bg-gray-50 peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white peer-checked:hover:bg-blue-700 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300 dark:border-gray-600 dark:hover:bg-gray-700 dark:peer-checked:bg-blue-600`}>
        {text ?? value}
      </span>
    </label>
  )
}

/**
 * Skalen-Raster: je Zeile eine Reihe Skalenknöpfe (Feld q_<Frage>_<Zeile>). Gegensatzpaare (labelRight) am Handy mit
 * beiden Begriffen über den Knöpfen, ab sm als "links | Knöpfe | rechts" - wie der Papierbogen des UEQ-S. Aussagen am
 * Handy mit der Aussage darüber und den Skalenenden darunter, ab sm als "Aussage | Knöpfe". Alle Reihen gleich breit,
 * damit die Knöpfe untereinander stehen. Pflicht über die eingebaute Formularprüfung (je Zeile eine Gruppe).
 */
function ScaleGridInput({ questionId, question, rows, required, markRows, values }: {
  questionId: string
  question: { scaleMin: number | null; scaleMax: number | null; minLabel: string | null; maxLabel: string | null; optOutLabel: string | null }
  rows: { id: string; label: string; labelRight: string | null }[]
  required: boolean
  markRows: boolean
  values: Map<string, number | string>
}) {
  const { min, max } = scaleRange(question)
  const scale = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const pairs = rows.some(r => r.labelRight)
  const ends = question.minLabel || question.maxLabel
  const optOut = question.optOutLabel
  // Ab sm eine Spalte mehr für die Ausweich-Antwort, abgesetzt rechts.
  const columns = pairs
    ? (optOut ? 'sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]' : 'sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]')
    : (optOut ? 'sm:grid-cols-[minmax(0,1fr)_auto_auto]' : 'sm:grid-cols-[minmax(0,1fr)_auto]')
  const mark = markRows && <span className="ml-1 text-red-700 dark:text-red-300" title="Pflicht">*</span>
  const buttons = (row: { id: string; label: string; labelRight: string | null }) => (
    <div
      className="grid gap-1 grid-cols-[repeat(var(--scale-n),minmax(0,1fr))] sm:grid-cols-[repeat(var(--scale-n),2.75rem)]"
      style={{ '--scale-n': scale.length } as React.CSSProperties}
    >
      {scale.map(v => (
        <ScaleButton
          key={v} name={answerField(questionId, row.id)} value={v} required={required} checked={values.get(row.id) === v}
          label={`${v}${v === min && (row.labelRight ? row.label : question.minLabel) ? ` (${row.labelRight ? row.label : question.minLabel})` : ''}${v === max && (row.labelRight || question.maxLabel) ? ` (${row.labelRight || question.maxLabel})` : ''}`}
        />
      ))}
    </div>
  )
  return (
    <div className="space-y-3 sm:space-y-1.5">
      {ends && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {question.minLabel && `${min} = ${question.minLabel}`}{question.minLabel && question.maxLabel && ' … '}{question.maxLabel && `${max} = ${question.maxLabel}`}
        </p>
      )}
      {rows.map(row => (
        <div
          key={row.id} role="radiogroup" aria-label={scaleRowLabel(row)} data-testid="scale-row"
          className={`rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:grid sm:items-center sm:gap-3 sm:rounded-none sm:border-0 sm:p-0 sm:py-1 ${columns} ${pairs ? '' : 'sm:border-b sm:border-gray-100 sm:pb-1.5 sm:last:border-b-0 sm:dark:border-gray-700/60'}`}
        >
          {row.labelRight ? (
            <div className="mb-2 flex items-end justify-between gap-3 text-sm font-medium sm:contents">
              <span className="sm:text-right sm:font-normal">{row.label}</span>
              <span className="text-right sm:order-last sm:text-left sm:font-normal">{row.labelRight}{mark}</span>
            </div>
          ) : (
            <span className={`mb-2 block text-sm font-medium sm:mb-0 sm:font-normal ${pairs ? 'sm:text-right' : ''}`}>{row.label}{mark}</span>
          )}
          {buttons(row)}
          {!row.labelRight && pairs && <span className="hidden sm:block" />}
          {!pairs && ends && (
            <div className="mt-1 flex justify-between gap-4 text-xs text-gray-500 dark:text-gray-400 sm:hidden">
              <span>{question.minLabel}</span>
              <span className="text-right">{question.maxLabel}</span>
            </div>
          )}
          {/* Am Handy abgesetzt unter der Skala über die ganze Breite, ab sm als letzte Spalte (bei Paaren nach dem rechten Begriff). */}
          {optOut && (
            <div className="mt-2 sm:order-last sm:mt-0 sm:ml-2">
              <ScaleButton
                name={answerField(questionId, row.id)} value={OPT_OUT_VALUE} required={required} checked={values.get(row.id) === OPT_OUT_VALUE}
                label={optOut} text={optOut} wide
              />
            </div>
          )}
        </div>
      ))}
    </div>
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
            <span className="flex h-10 items-center justify-center rounded-lg border border-gray-300 text-sm font-medium tabular-nums transition hover:bg-gray-50 peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white peer-checked:hover:bg-blue-700 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300 dark:border-gray-600 dark:hover:bg-gray-700 dark:peer-checked:bg-blue-600">
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
