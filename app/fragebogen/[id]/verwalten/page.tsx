import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import { formatDecimal, getSurveyLevel, IDENTITY_LABELS, isSurveyOpen, KIND_LABELS, loadSurveyResults } from '../../../lib/survey'
import { clearSurveyResponses, deleteSurvey, shareSurvey, unshareSurvey } from '../../../survey-actions'
import CopyableField from '../../../ui/copyable-field'
import ConfirmForm from '../../../ui/confirm-form'
import Notice from '../../../ui/notice'
import QrCode from '../../../ui/qr-code'
import { buttonClass, Card, formatShortDate, inputClass, Stat } from '../../../ui/kit'
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
  searchParams: Promise<{ angelegt?: string; geleert?: string; fehler?: string; geteilt?: string; teilenFehler?: string }>
}) {
  const { id } = await params
  const { angelegt, geleert, fehler, geteilt, teilenFehler } = await searchParams
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

  return (
    <SurveyFrame survey={survey} isOwner={isOwner}>
      <div className="space-y-6">
        {angelegt === '1' && <Notice tone="success">Fragebogen angelegt. Teile den Link oder bette ihn in eine App ein.</Notice>}
        {geleert === '1' && <Notice tone="success">Alle Antworten gelöscht. Die Fragen lassen sich wieder ändern.</Notice>}
        {geteilt === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}
        {teilenFehler && Object.hasOwn(SHARE_ERRORS, teilenFehler) && <Notice tone="error">{SHARE_ERRORS[teilenFehler]}</Notice>}
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
        </Card>

        <Card className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{responses.length > 0 ? 'Auswertung' : 'Fragen'}</h2>
            {responses.length > 0 && <a href={`/fragebogen/${id}/verwalten/export`} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">CSV-Export ↓</a>}
          </div>
          {questions.map((q, i) => (
            <section key={q.id} className="space-y-2" data-testid="survey-result">
              <h3 className="font-medium">
                {i + 1}. {q.text}
                <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                  {KIND_LABELS[q.kind]}{q.required ? ' · Pflicht' : ''}{responses.length > 0 ? ` · ${q.answered} Antwort${q.answered === 1 ? '' : 'en'}` : ''}
                </span>
              </h3>

              {(q.kind === 'SINGLE' || q.kind === 'MULTI') && (
                <ul className="space-y-1.5">
                  {q.options.map(o => {
                    const count = q.counts.get(o.id) ?? 0
                    const pct = q.answered > 0 ? Math.round((count / q.answered) * 100) : 0
                    return (
                      <li key={o.id}>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="grow">{o.label}</span>
                          {responses.length > 0 && <span className="tabular-nums text-gray-500 dark:text-gray-400">{count} · {pct}%</span>}
                        </div>
                        {responses.length > 0 && (
                          <div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
                            <div className="h-1.5 bg-indigo-500" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
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
