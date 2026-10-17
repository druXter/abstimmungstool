import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import {
  countSince, csvColumns, formatDecimal, getSurveyLevel, responseSignature, gridKey, IDENTITY_LABELS, isGrid, isQuestion, isSurveyOpen, KIND_LABELS, loadSurveyResults, questionNumbers, scaleCenter,
  scaleRange, scaleRowLabel, type ScaleStats
} from '../../../lib/survey'
import { clearSurveyResponses, deleteSurvey, deleteSurveyResponses, shareSurvey, unshareSurvey } from '../../../survey-actions'
import QrCode from '../../../ui/qr-code'
import { buttonClass, Card, formatShortDate, inputClass, Stat, CopyableField, ConfirmForm, Notice } from '../../../ui/kit'
import SurveyFrame from '../survey-frame'
import { HEIGHT_MESSAGE } from '../../../lib/survey-embed'

export const dynamic = 'force-dynamic'

const SHARE_ERRORS: Record<string, string> = {
  unbekannt: 'Zu dieser E-Mail-Adresse gibt es kein Konto. Lade die Person zuerst unter "Konten" ein.',
  owner: 'Diese Person besitzt den Fragebogen bereits.'
}

/** HTML zum Einbetten: iFrame plus ein paar Zeilen, die seine Höhe an den Inhalt anpassen (Nachricht aus embed-helpers.tsx). */
function embedSnippet(origin: string, id: string, title: string): string {
  const safeTitle = title.replace(/[<>"&]/g, '')
  return [
    `<iframe id="fragebogen-${id}" src="${origin}/fragebogen/${id}/einbetten" title="${safeTitle}"`,
    `  style="width:100%;height:640px;border:0" loading="lazy"></iframe>`,
    `<script>`,
    `  window.addEventListener('message', function (e) {`,
    `    if (e.origin !== '${origin}' || !e.data || e.data.type !== '${HEIGHT_MESSAGE}') return;`,
    `    var frame = document.getElementById('fragebogen-' + e.data.id);`,
    `    if (frame) frame.style.height = e.data.height + 'px';`,
    `  });`,
    `</script>`
  ].join('\n')
}

/**
 * Übersicht eines Fragebogens (docs/KONZEPT-FRAGEBOGEN.md): Kennzahlen, Link und QR-Code, Code zum Einbetten,
 * Auswertung je Frage mit CSV-Export, darunter gemeinsam verwalten, Antworten löschen und Löschen. Antworten löschen,
 * Löschen und Teilen nur Owner und Admins (getSurveyLevel).
 */
export default async function ManageSurveyPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ angelegt?: string; geleert?: string; entfernt?: string; fehler?: string; geteilt?: string; teilenFehler?: string }>
}) {
  const { id } = await params
  const { angelegt, geleert, entfernt, fehler, geteilt, teilenFehler } = await searchParams
  const survey = await prisma.survey.findUnique({
    where: { id },
    include: {
      owner: { select: { email: true, name: true } },
      access: { select: { id: true, user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } }
    }
  })
  if (!survey) notFound()

  const user = await getCurrentUser()
  const level = await getSurveyLevel(user, survey)
  if (!level) {
    if (!user) redirect(`/anmelden?next=${encodeURIComponent(`/fragebogen/${id}/verwalten`)}`)
    notFound()
  }
  const isOwner = level === 'owner'

  const { questions, responses } = await loadSurveyResults(id)
  const open = isSurveyOpen(survey)
  const origin = new URL(baseUrl()).origin
  const link = `${origin}/fragebogen/${id}`
  const last = responses.reduce<Date | null>((latest, r) => (!latest || r.updatedAt > latest ? r.updatedAt : latest), null)
  const hidden = <input type="hidden" name="surveyId" value={id} />
  // Fragen mit ausgeblendetem Titel zeigen hier die Nummer ihrer Gruppe (z.B. beide UEQ-S-Skalen unter "4.").
  const { shown, group } = questionNumbers(questions, survey.numbered)
  const numberOf = (id: string) => shown.get(id) ?? group.get(id)

  return (
    <SurveyFrame survey={survey} isOwner={isOwner}>
      <div className="space-y-6">
        {angelegt === '1' && <Notice tone="success">Fragebogen angelegt. Teile den Link oder bette ihn in eine App ein.</Notice>}
        {geleert === '1' && <Notice tone="success">Alle Antworten gelöscht. Die Fragen lassen sich wieder ändern.</Notice>}
        {entfernt && /^\d+$/.test(entfernt) && <Notice tone="success">{entfernt === '1' ? '1 Antwort' : `${entfernt} Antworten`} gelöscht.</Notice>}
        {geteilt === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}
        {teilenFehler && Object.hasOwn(SHARE_ERRORS, teilenFehler) && <Notice tone="error">{SHARE_ERRORS[teilenFehler]}</Notice>}
        {survey.throttledCount > 0 && (
          <Notice tone="warning">
            Die Drosselung hat bisher {survey.throttledCount === 1 ? '1 Abgabe' : `${survey.throttledCount} Abgaben`} abgelehnt (mehr als{' '}
            {survey.submitLimit} pro Stunde aus einem Netzwerk). Waren das echte Teilnehmende, z.B. viele im selben WLAN, die Grenze unter{' '}
            <a href={`/fragebogen/${id}/bearbeiten`} className="underline">Bearbeiten</a> hochsetzen; sonst war es vermutlich ein Skript -
            dann unten bei den einzelnen Antworten aufräumen.
          </Notice>
        )}
        {fehler === 'beantwortet' && <Notice tone="warning">Es wurde schon geantwortet - die Fragen lassen sich nicht mehr ändern.</Notice>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Antworten" value={responses.length} testId="stat-responses" hint={last ? `zuletzt ${formatShortDate(last)}` : undefined} />
          <Stat label="Fragen" value={questions.length} hint={`${questions.filter(q => q.required).length} Pflicht`} />
          <Stat label="Wer antwortet" value={<span className="text-base">{IDENTITY_LABELS[survey.identity].title}</span>} />
          <Stat
            label="Stand" value={<span className="text-base">{open ? 'offen' : 'beendet'}</span>} tone={open ? 'green' : undefined}
            hint={open ? (survey.closesAt ? `endet ${formatShortDate(survey.closesAt)}` : 'ohne Enddatum') : survey.closedAt ? `seit ${formatShortDate(survey.closedAt)}` : undefined}
          />
        </div>

        <Card className="space-y-4">
          <h2 className="font-semibold">Zum Ausfüllen</h2>
          <CopyableField label="Link zum Fragebogen" value={link} />
          {survey.identity === 'RSVP' ? (
            <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="rsvp-survey-hint">
              Diesen Link in rsvp-app beim Termin eintragen (Einstellungen → Verknüpfungen → Feedback-Fragebogen). rsvp-app
              schickt ihn nach dem Event an die Gäste und zeigt ihn auf der Event-Seite, jeweils mit einem persönlichen
              Nachweis. Wer den Link nur so öffnet, kann nicht antworten.
            </p>
          ) : (<>
          <details className="text-sm text-gray-600 dark:text-gray-400">
            <summary className="cursor-pointer">QR-Code</summary>
            <div className="mt-2"><QrCode value={link} label="QR-Code zum Fragebogen" /></div>
          </details>
          <details className="text-sm text-gray-600 dark:text-gray-400" data-testid="embed-details">
            <summary className="cursor-pointer">In eine App oder Website einbetten</summary>
            <div className="mt-3 space-y-3">
              <CopyableField label="HTML zum Einbetten" value={embedSnippet(origin, id, survey.title)} rows={10} />
              <ul className="list-disc space-y-1 pl-5 text-xs">
                <li>
                  Die Seite muss dafür freigegeben sein (<code>EMBED_ALLOWED_ORIGINS</code> in der <code>.env</code> dieses Tools) und
                  in ihrer eigenen Content-Security-Policy <code>frame-src {origin}</code> erlauben.
                </li>
                <li>
                  Das Skript passt die Höhe des iFrames an den Inhalt an. In React o.ä. denselben Listener z.B. in einem{' '}
                  <code>useEffect</code> anmelden; ohne ihn bleibt das iFrame 640 px hoch und scrollt selbst.
                </li>
                {survey.identity === 'COOKIE' && (
                  <li>
                    &quot;Einmal pro Gerät&quot; braucht ein Cookie. In Apps unter einer anderen Domain blockieren Browser es - dort
                    erscheint statt des Formulars ein Knopf, der den Fragebogen in einem neuen Tab öffnet. Für solche Apps
                    &quot;Anonym&quot; wählen.
                  </li>
                )}
              </ul>
            </div>
          </details>
          </>)}
        </Card>

        <Card className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{responses.length > 0 ? 'Auswertung' : 'Fragen'}</h2>
            {responses.length > 0 && <a href={`/fragebogen/${id}/verwalten/export`} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">CSV-Export ↓</a>}
          </div>
          {questions.map(q => !isQuestion(q.kind) ? (
            // Überschrift/Text-Block: nur zur Orientierung, keine Auswertung.
            <div key={q.id} className="border-t border-gray-100 pt-4 dark:border-gray-700" data-testid="survey-result-info">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{numberOf(q.id) && `${numberOf(q.id)}. `}{q.text || 'Text'}</p>
              {!q.text && q.hint && <p className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{q.hint}</p>}
            </div>
          ) : (
            <section key={q.id} className="space-y-2" data-testid="survey-result">
              <h3 className="font-medium">
                {numberOf(q.id) && `${numberOf(q.id)}. `}{q.text}
                <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                  {KIND_LABELS[q.kind]}{q.required ? ' · Pflicht' : ''}{q.hideTitle ? ' · Titel ausgeblendet' : ''}{responses.length > 0 ? ` · ${q.answered} Antwort${q.answered === 1 ? '' : 'en'}` : ''}
                </span>
              </h3>

              {q.kind === 'SCALE_GRID' && <ScaleGridResult question={q} answered={responses.length > 0} />}

              {(q.kind === 'SINGLE' || q.kind === 'MULTI') && (
                <ul className="space-y-1.5">
                  {q.columns.map(o => {
                    const count = q.counts.get(o.id) ?? 0
                    const pct = q.answered > 0 ? Math.round((count / q.answered) * 100) : 0
                    return (
                      <li key={o.id}>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="grow">{o.label}{o.allowText && <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">(mit Textfeld)</span>}</span>
                          {responses.length > 0 && <span className="tabular-nums text-gray-500 dark:text-gray-400">{count} · {pct}%</span>}
                        </div>
                        {responses.length > 0 && (
                          <div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
                            <div className="h-1.5 bg-indigo-500" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        {/* Eingetippte Texte zu dieser Antwort ("Sonstiges: ___"), neueste zuerst. */}
                        {(q.optionTexts.get(o.id)?.length ?? 0) > 0 && (
                          <details className="mt-1 text-sm" data-testid="option-texts">
                            <summary className="cursor-pointer text-xs text-gray-600 dark:text-gray-400">{q.optionTexts.get(o.id)!.length} eingetippte Antwort{q.optionTexts.get(o.id)!.length === 1 ? '' : 'en'}</summary>
                            <ul className="mt-1 max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                              {q.optionTexts.get(o.id)!.map((text, j) => <li key={j} className="whitespace-pre-line px-3 py-1.5">{text}</li>)}
                            </ul>
                          </details>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {isGrid(q.kind) && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-max border-collapse text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 dark:text-gray-400">
                        <th className="py-1.5 pr-3 text-left font-medium">{q.kind === 'GRID_MULTI' ? 'mehrere pro Zeile' : ''}</th>
                        {q.columns.map(c => <th key={c.id} className="px-2 py-1.5 text-center font-medium">{c.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {q.rows.map(row => {
                        const answered = q.rowAnswered.get(row.id) ?? 0
                        return (
                          <tr key={row.id} className="border-t border-gray-100 dark:border-gray-700">
                            <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                              {row.label}
                              {responses.length > 0 && <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">({answered})</span>}
                            </th>
                            {q.columns.map(c => {
                              const count = q.counts.get(gridKey(row.id, c.id)) ?? 0
                              const pct = answered > 0 ? Math.round((count / answered) * 100) : 0
                              return (
                                <td key={c.id} className="px-1 py-1 text-center tabular-nums">
                                  {/* Anteil der Antwortenden dieser Zeile, je dunkler, desto mehr. */}
                                  <span
                                    className={`block rounded px-2 py-1 ${pct >= 50 ? 'text-white' : ''}`}
                                    style={{ backgroundColor: count ? `rgb(99 102 241 / ${0.12 + (pct / 100) * 0.8})` : undefined }}
                                    title={`${row.label} - ${c.label}: ${count} (${pct} %)`}
                                  >
                                    {responses.length > 0 ? <>{count}<span className="text-[10px] opacity-75"> · {pct}%</span></> : '–'}
                                  </span>
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {q.kind === 'SCALE' && (
                q.scale ? (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      Durchschnitt <strong>{formatDecimal(q.scale.mean)}</strong> · Median {formatDecimal(q.scale.median)}
                      <span className="text-gray-500 dark:text-gray-400"> (Skala {q.scaleMin}–{q.scaleMax}{q.minLabel || q.maxLabel ? `: ${q.minLabel ?? ''} … ${q.maxLabel ?? ''}` : ''})</span>
                    </p>
                    <div className="flex h-24 items-end gap-1" role="img" aria-label={`Verteilung: ${q.scale.distribution.map(d => `${d.value}: ${d.count}`).join(', ')}`}>
                      {q.scale.distribution.map(d => {
                        const top = Math.max(...q.scale!.distribution.map(x => x.count))
                        return (
                          <div key={d.value} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                            <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{d.count || ''}</span>
                            <div className="w-full rounded-t bg-indigo-500" style={{ height: `${top > 0 ? (d.count / top) * 70 : 0}%`, minHeight: d.count ? 2 : 0 }} />
                            <span className="text-xs tabular-nums">{d.value}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Skala {q.scaleMin}–{q.scaleMax}{q.minLabel || q.maxLabel ? ` (${q.minLabel ?? ''} … ${q.maxLabel ?? ''})` : ''}{responses.length > 0 ? ' · noch keine Antwort' : ''}
                  </p>
                )
              )}

              {q.kind === 'TEXT' && (
                q.texts.length > 0 ? (
                  <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-700">
                    {q.texts.map((t, j) => (
                      <li key={j} className="whitespace-pre-line px-3 py-2">{t.text}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{q.multiline ? 'Mehrzeiliger' : 'Einzeiliger'} Freitext{responses.length > 0 ? ' · noch keine Antwort' : ''}</p>
                )
              )}
            </section>
          ))}
        </Card>

        {responses.length > 0 && <ResponsesCard surveyId={id} questions={questions} responses={responses} canDelete={isOwner} />}

        {isOwner && (
          <Card className="space-y-3">
            <h2 className="font-semibold">Gemeinsam verwalten</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Andere Konten dürfen dann bearbeiten, schließen und exportieren - nicht Antworten löschen, den Fragebogen löschen oder weiter teilen.
            </p>
            {survey.access.length > 0 && (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" aria-label="Freigaben">
                {survey.access.map(a => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="truncate">{a.user.name ? `${a.user.name} (${a.user.email})` : a.user.email}</span>
                    <form action={unshareSurvey}>
                      <input type="hidden" name="accessId" value={a.id} />
                      <button type="submit" className="text-sm font-medium text-red-700 dark:text-red-300 hover:underline">Entfernen</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={shareSurvey} className="flex gap-2">
              {hidden}
              <label htmlFor="survey-share-email" className="sr-only">E-Mail-Adresse des Kontos</label>
              <input id="survey-share-email" type="email" name="email" required placeholder="E-Mail-Adresse eines Kontos" className={inputClass.replace('w-full', 'min-w-0 grow')} />
              <button type="submit" className={buttonClass('primary')}>Teilen</button>
            </form>
          </Card>
        )}

        {isOwner && (
          <Card className="space-y-3">
            <h2 className="font-semibold">Weitere Aktionen</h2>
            <div className="flex flex-wrap gap-3">
              {responses.length > 0 && (
                <ConfirmForm action={clearSurveyResponses} message={`Alle ${responses.length} Antworten unwiderruflich löschen? Die Fragen bleiben.`}>
                  {hidden}
                  <button type="submit" className={buttonClass('secondary')}>Alle Antworten löschen</button>
                </ConfirmForm>
              )}
              <ConfirmForm action={deleteSurvey} message="Fragebogen inklusive aller Antworten unwiderruflich löschen?">
                {hidden}
                <button type="submit" className={buttonClass('danger')}>Löschen</button>
              </ConfirmForm>
            </div>
            {responses.length > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Nach dem Löschen aller Antworten lassen sich die Fragen wieder ändern (z.B. nach einem Probedurchlauf).
              </p>
            )}
          </Card>
        )}
      </div>
    </SurveyFrame>
  )
}

/** Wert einer Skala auf die Mitte bezogen, mit Vorzeichen (bei 1-7: -3 bis +3, wie in der UEQ-Auswertung). */
function centered(mean: number, range: { min: number; max: number }): string {
  const value = mean - scaleCenter(range)
  return `${value > 0 ? '+' : value < 0 ? '−' : '±'}${formatDecimal(Math.abs(value))}`
}

/** Mittelwert als Punkt auf einer Linie von min bis max - so lassen sich viele Zeilen auf einen Blick vergleichen. */
function MeanMarker({ stats, range }: { stats: ScaleStats; range: { min: number; max: number } }) {
  const position = range.max > range.min ? ((stats.mean - range.min) / (range.max - range.min)) * 100 : 50
  return (
    <div className="relative h-4 w-full min-w-24" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-gray-400 dark:bg-gray-500" style={{ left: '50%' }} />
      <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500" style={{ left: `${position}%` }} />
    </div>
  )
}

/**
 * Auswertung eines Skalen-Rasters: je Zeile Anzahl (n = echte Skalenwerte, die Ausweich-Antwort in eigener Spalte),
 * Mittelwert, zentrierter Wert und die Lage auf der Skala, darüber
 * der Mittelwert über alle Zeilen (beim UEQ-S der Skalenwert, z.B. "pragmatische Qualität").
 */
function ScaleGridResult({ question, answered }: { question: Awaited<ReturnType<typeof loadSurveyResults>>['questions'][number]; answered: boolean }) {
  const range = scaleRange(question)
  const odd = (range.max - range.min) % 2 === 0
  return (
    <div className="space-y-2">
      {question.scale && (
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Gesamt: Durchschnitt <strong>{formatDecimal(question.scale.mean)}</strong>
          {odd && <> · zentriert <strong>{centered(question.scale.mean, range)}</strong></>}
          <span className="text-gray-500 dark:text-gray-400"> (Skala {range.min}–{range.max}{odd ? `, Mitte ${scaleCenter(range)}` : ''}{question.optOutLabel ? `; „${question.optOutLabel}“ zählt nicht mit` : ''})</span>
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="text-xs text-gray-500 dark:text-gray-400">
              <th className="py-1.5 pr-3 text-left font-medium">Zeile</th>
              <th className="px-2 py-1.5 text-right font-medium">n</th>
              {question.optOutLabel && <th className="px-2 py-1.5 text-right font-medium">{question.optOutLabel}</th>}
              <th className="px-2 py-1.5 text-right font-medium">Ø</th>
              {odd && <th className="px-2 py-1.5 text-right font-medium">zentriert</th>}
              <th className="px-2 py-1.5 text-left font-medium">Lage ({range.min}–{range.max})</th>
            </tr>
          </thead>
          <tbody>
            {question.rows.map(row => {
              const stats = question.rowScale.get(row.id) ?? null
              return (
                <tr key={row.id} className="border-t border-gray-100 dark:border-gray-700">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">{scaleRowLabel(row)}</th>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">{stats?.count ?? 0}</td>
                  {question.optOutLabel && <td className="px-2 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">{question.rowOptOut.get(row.id) ?? 0}</td>}
                  <td className="px-2 py-1.5 text-right tabular-nums">{stats ? formatDecimal(stats.mean) : '–'}</td>
                  {odd && <td className="px-2 py-1.5 text-right tabular-nums">{stats ? centered(stats.mean, range) : '–'}</td>}
                  <td className="w-1/3 px-2 py-1.5">{stats ? <MeanMarker stats={stats} range={range} /> : answered ? <span className="text-xs text-gray-400">noch keine Antwort</span> : null}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type Results = Awaited<ReturnType<typeof loadSurveyResults>>
const SHOWN_RESPONSES = 300

/**
 * Einzelne Abgaben (neueste zuerst) mit Kurzfassung und Löschen - und darüber Gruppen identischer Abgaben, die ein
 * Skript verraten (z.B. 40-mal dieselben Antworten in einer Stunde) und sich gemeinsam löschen lassen. Löschen nur
 * Owner und Admins (deleteSurveyResponses prüft selbst); Konten mit Freigabe sehen die Liste nur.
 */
function ResponsesCard({ surveyId, questions, responses, canDelete }: { surveyId: string; questions: Results['questions']; responses: Results['responses']; canDelete: boolean }) {
  const columns = questions.flatMap(q => csvColumns(q))
  const summary = (r: Results['responses'][number]) => {
    const text = columns.map(c => c.value(r.answers)).filter(Boolean).join(' · ')
    return text.length > 160 ? `${text.slice(0, 159)}…` : text || '(nur leere Antworten)'
  }
  const groups = new Map<string, Results['responses']>()
  for (const r of responses) {
    const key = responseSignature(r.answers)
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const groupOf = (r: Results['responses'][number]) => groups.get(responseSignature(r.answers))!
  const identical = [...groups.values()].filter(g => g.length > 1).sort((a, b) => b.length - a.length)
  const newest = [...responses].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const lastHour = countSince(responses, 60 * 60 * 1000)
  const ids = (list: Results['responses']) => list.map(r => <input key={r.id} type="hidden" name="responseId" value={r.id} />)

  return (
    <Card className="space-y-4">
      <div id="antworten" className="scroll-mt-20 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Einzelne Antworten</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">{lastHour} in der letzten Stunde</span>
      </div>
      {identical.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200" data-testid="identical-groups">
          <p>
            Identische Abgaben - bei kurzen Fragebögen normal, viele gleiche in kurzer Zeit deuten aber auf ein Skript hin.
          </p>
          <ul className="space-y-2">
            {identical.slice(0, 10).map(group => (
              <li key={group[0].id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <strong>{group.length}×</strong> {summary(group[0])}
                  <span className="block text-xs opacity-80">
                    {formatShortDate(group.reduce((a, r) => (r.createdAt < a ? r.createdAt : a), group[0].createdAt))} bis {formatShortDate(group.reduce((a, r) => (r.createdAt > a ? r.createdAt : a), group[0].createdAt))}
                  </span>
                </span>
                {canDelete && (
                  <ConfirmForm action={deleteSurveyResponses} message={`Alle ${group.length} identischen Abgaben löschen?`}>
                    <input type="hidden" name="surveyId" value={surveyId} />
                    {ids(group)}
                    <button type="submit" className={buttonClass('danger', 'sm')}>alle {group.length} löschen</button>
                  </ConfirmForm>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-sm" data-testid="response-list">
        <summary className="cursor-pointer text-gray-600 dark:text-gray-400">
          Alle {responses.length} Abgaben ansehen{responses.length > SHOWN_RESPONSES ? ` (die neuesten ${SHOWN_RESPONSES}, alle im CSV)` : ''}
        </summary>
        <ul className="mt-2 max-h-[32rem] divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {newest.slice(0, SHOWN_RESPONSES).map(r => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {formatShortDate(r.createdAt)}{groupOf(r).length > 1 && ` · ${groupOf(r).length}× identisch`}
                </span>
                <span className="break-words">{summary(r)}</span>
              </span>
              {canDelete && (
                <ConfirmForm action={deleteSurveyResponses} message="Diese Abgabe löschen?">
                  <input type="hidden" name="surveyId" value={surveyId} />
                  {ids([r])}
                  <button type="submit" className="shrink-0 text-xs font-medium text-red-700 hover:underline dark:text-red-300">löschen</button>
                </ConfirmForm>
              )}
            </li>
          ))}
        </ul>
      </details>
    </Card>
  )
}
