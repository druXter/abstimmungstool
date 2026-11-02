import { formatShortDate, Notice } from '../../../ui/kit'
import { summarizeSurveyQuestion } from '../../../survey-actions'
import { parseStoredThemes, SUMMARY_MAX_ANSWERS, SUMMARY_MIN_ANSWERS } from '../../../lib/survey-summary'
import SummaryButton from './summary-button'

// Rückmeldungen von summarizeSurveyQuestion (?ki=…&frage=<id>), angezeigt an der Frage.
const RESULTS: Record<string, { tone: 'success' | 'warning' | 'error'; text: string }> = {
  fertig: { tone: 'success', text: 'Zusammenfassung erstellt.' },
  fehler: { tone: 'error', text: 'Die KI hat nicht oder nicht brauchbar geantwortet. Bitte später noch einmal versuchen.' },
  gedrosselt: { tone: 'warning', text: 'Zu viele Zusammenfassungen in kurzer Zeit - bitte später noch einmal versuchen.' },
  wenig: { tone: 'warning', text: `Dafür braucht es mindestens ${SUMMARY_MIN_ANSWERS} Antworten seit dem Einschalten.` },
  aus: { tone: 'warning', text: 'Die KI-Zusammenfassung ist für diesen Fragebogen aus.' }
}

type Text = { id: string; text: string }
type StoredSummary = { overview: string; themes: string; answerCount: number; createdAt: Date }

/**
 * KI-Zusammenfassung unter einer Freitext-Frage (app/lib/survey-summary.ts): Überblick und Themen mit der Zahl der
 * zugeordneten Antworten, die Antworten selbst wörtlich aus der Datenbank (nicht aus dem Text der KI). Darunter der
 * Knopf zum Erstellen bzw. Erneuern - nur, wenn die Funktion an ist und es genug Antworten seit dem Einschalten gibt.
 */
export default function SummaryPanel({ surveyId, questionId, texts, eligible, enabled, summary, result }: {
  surveyId: string
  questionId: string
  /** Alle Antworten auf die Frage. */
  texts: Text[]
  /** Wie viele davon an die KI dürfen (seit dem Einschalten). */
  eligible: number
  enabled: boolean
  summary: StoredSummary | null
  result?: string
}) {
  const notice = result && Object.hasOwn(RESULTS, result) ? RESULTS[result] : null
  const byId = new Map(texts.map(text => [text.id, text.text]))
  const themes = summary
    ? parseStoredThemes(summary.themes)
        .map(theme => ({ ...theme, quotes: theme.answerIds.flatMap(id => (byId.has(id) ? [byId.get(id)!] : [])) }))
        .filter(theme => theme.quotes.length > 0)
    : []
  const canRun = enabled && eligible >= SUMMARY_MIN_ANSWERS
  if (!summary && !canRun && !notice) {
    return enabled && texts.length > 0 ? (
      <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="summary-hint">
        KI-Zusammenfassung ab {SUMMARY_MIN_ANSWERS} Antworten seit dem Einschalten (bisher {eligible}).
      </p>
    ) : null
  }

  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900 dark:bg-indigo-950/40" data-testid="survey-summary">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {summary && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">KI-Zusammenfassung</h4>
          {summary.overview && <p className="text-sm">{summary.overview}</p>}
          {themes.length > 0 && (
            <ul className="space-y-2">
              {themes.map(theme => (
                <li key={theme.title} data-testid="summary-theme">
                  <details className="text-sm">
                    <summary className="cursor-pointer">
                      <span className="font-medium">{theme.title}</span>
                      <span className="ml-2 text-xs tabular-nums text-gray-600 dark:text-gray-400">{theme.quotes.length} Antwort{theme.quotes.length === 1 ? '' : 'en'}</span>
                      {theme.description && <span className="block text-gray-700 dark:text-gray-300">{theme.description}</span>}
                    </summary>
                    <ul className="mt-1 max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900">
                      {theme.quotes.map((quote, index) => <li key={index} className="whitespace-pre-line px-3 py-1.5">{quote}</li>)}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Am {formatShortDate(summary.createdAt)} aus {summary.answerCount} Antwort{summary.answerCount === 1 ? '' : 'en'}
            {summary.answerCount >= SUMMARY_MAX_ANSWERS ? ' (den neuesten)' : ''} von einer KI (OpenAI) erstellt - kann Themen
            übersehen oder falsch zuordnen. Die Zahlen nennen die Antworten, die die KI dem Thema zugeordnet hat.
            {Math.min(eligible, SUMMARY_MAX_ANSWERS) !== summary.answerCount && ` Inzwischen ${eligible} Antworten für die Zusammenfassung.`}
          </p>
        </div>
      )}
      {canRun && (
        <form action={summarizeSurveyQuestion} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="surveyId" value={surveyId} />
          <input type="hidden" name="questionId" value={questionId} />
          <SummaryButton label={summary ? 'Neu zusammenfassen' : 'Mit KI zusammenfassen'} />
          {!summary && (
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {eligible === texts.length ? `${eligible} Antworten` : `${eligible} von ${texts.length} Antworten (nur die seit dem Einschalten)`} gehen an OpenAI.
            </span>
          )}
        </form>
      )}
    </div>
  )
}
