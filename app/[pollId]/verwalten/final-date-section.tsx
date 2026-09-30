// app/[pollId]/verwalten/final-date-section.tsx
import type { OptionKind } from '@prisma/client'
import { confirmPollDate, retryRsvpTransfer } from '../../actions'
import { finalDateLabel, needsDecision, reachableCount, voterContacts } from '../../lib/final-date'
import { parseTransfer, rsvpDateStatus } from '../../lib/rsvp-date'
import type { PollResult } from '../../lib/results'
import Notice from '../../ui/notice'
import SubmitButton from '../../ui/submit-button'

type Poll = {
  id: string
  ownerId: string | null
  optionKind: OptionKind
  voterIdentity: string
  confirmDate: boolean
  closedAt: Date | null
  finalizedAt: Date | null
  finalStartsAt: Date | null
  rsvpTransfer: string | null
  owner: { email: string; name: string | null } | null
}

/**
 * "Termin festlegen" auf der Verwaltungsseite (Terminabstimmung, app/lib/final-date.ts):
 * vor dem Ende ein Hinweis, danach Bestätigen bzw. Entscheiden samt Vorschau, was mit rsvp-app
 * passiert und wer benachrichtigt wird, zuletzt das Ergebnis der Festlegung.
 */
export default async function FinalDateSection({ poll, result, legacyToken, error }: { poll: Poll; result: PollResult; legacyToken: string; error?: string }) {
  if (!poll.confirmDate || poll.optionKind === 'TEXT') return null
  const hidden = (
    <>
      <input type="hidden" name="pollId" value={poll.id} />
      {legacyToken && <input type="hidden" name="creatorToken" value={legacyToken} />}
    </>
  )

  if (poll.finalizedAt && poll.finalStartsAt) {
    const transfer = parseTransfer(poll.rsvpTransfer)
    return (
      <div className="bg-white p-6 rounded-lg shadow space-y-3">
        <h2 className="font-bold text-gray-900">Termin festgelegt</h2>
        <p className="text-sm text-gray-800">📅 <strong>{finalDateLabel(poll.finalStartsAt)}</strong></p>
        {transfer?.error === 'unreachable' && (
          <div className="space-y-2">
            <Notice tone="warning">rsvp-app war nicht erreichbar - der Termin wurde dort noch nicht übernommen.</Notice>
            <form action={retryRsvpTransfer}>
              {hidden}
              <button type="submit" className="text-sm bg-gray-100 text-gray-800 hover:bg-gray-200 px-3 py-1.5 rounded transition">Erneut an rsvp-app übertragen</button>
            </form>
          </div>
        )}
        {transfer && !transfer.error && (
          <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
            {transfer.updated?.map(e => <li key={e.id}>In rsvp-app übernommen: <a href={e.url} className="underline">{e.title}</a></li>)}
            {transfer.created && (
              <li>
                In rsvp-app neu angelegt: <a href={transfer.created.url} className="underline">{transfer.created.title}</a> (
                <a href={transfer.created.adminUrl} className="underline">dort bearbeiten</a> - Ort, Beschreibung, Fragen)
              </li>
            )}
            {transfer.unchanged?.map(e => <li key={e.id}>Nicht geändert (dort schon festes Datum): {e.title}</li>)}
            {!transfer.updated?.length && !transfer.created && !transfer.unchanged?.length && <li>In rsvp-app gab es kein passendes Event.</li>}
          </ul>
        )}
      </div>
    )
  }

  if (!poll.closedAt) {
    return (
      <div className="bg-white p-6 rounded-lg shadow text-sm text-gray-600 space-y-1">
        <h2 className="font-bold text-gray-900">Termin festlegen</h2>
        <p>Nach dem Ende der Abstimmung bestätigst du hier den Termin (bei Gleichstand entscheidest du). Erst dann werden die Abstimmenden benachrichtigt und rsvp-app informiert.</p>
      </div>
    )
  }

  if (!needsDecision(poll, result)) {
    return (
      <div className="bg-white p-6 rounded-lg shadow text-sm text-gray-600 space-y-1">
        <h2 className="font-bold text-gray-900">Termin festlegen</h2>
        <p>{result.quorumMet ? 'Es wurde nicht abgestimmt - es gibt keinen Termin festzulegen.' : 'Die Mindestbeteiligung wurde verfehlt - es gibt keinen Termin festzulegen.'}</p>
      </div>
    )
  }

  const tie = result.winners.length > 1
  const [status, contacts] = await Promise.all([rsvpDateStatus(poll), voterContacts(poll.id)])
  const reachable = reachableCount(contacts)

  return (
    <form action={confirmPollDate} className="bg-white p-6 rounded-lg shadow space-y-4 border-2 border-blue-200">
      {hidden}
      <h2 className="font-bold text-gray-900">{tie ? 'Termin entscheiden' : 'Termin bestätigen'}</h2>
      {error === 'uhrzeit' && <Notice tone="error">Bitte gib eine Uhrzeit an.</Notice>}

      {tie ? (
        <fieldset className="space-y-2">
          <legend className="text-sm text-gray-700 mb-1">Gleichstand - wähle einen der gleichauf liegenden Termine:</legend>
          {result.winners.map((w, i) => (
            <label key={w.id} className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="radio" name="optionId" value={w.id} required defaultChecked={i === 0} className="w-4 h-4" />
              {w.label}
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="text-sm text-gray-800">
          Eindeutiges Ergebnis: <strong>{result.winners[0].label}</strong>
          <input type="hidden" name="optionId" value={result.winners[0].id} />
        </p>
      )}

      {poll.optionKind === 'DATE' && (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="final-time">Uhrzeit</label>
          <input id="final-time" type="time" name="time" required defaultValue="18:00" className="border border-gray-300 p-1.5 rounded" />
        </div>
      )}

      <div className="text-sm text-gray-600 space-y-1">
        {status.state === 'unreachable' && <p>rsvp-app ist gerade nicht erreichbar. Du kannst trotzdem festlegen und die Übergabe danach wiederholen.</p>}
        {status.state === 'ok' && status.events.length > 0 && (
          <ul className="list-disc list-inside">
            {status.events.map(e => (
              <li key={e.id}>
                rsvp-app-Event &quot;{e.title}&quot;: {e.datePending ? 'übernimmt den Termin, seine Zusagenden werden benachrichtigt.' : 'hat schon ein festes Datum und bleibt unverändert.'}
              </li>
            ))}
          </ul>
        )}
        {status.state === 'ok' && status.events.length === 0 && status.canCreate && (
          <label className="flex items-center gap-2 cursor-pointer text-gray-800">
            <input type="checkbox" name="createRsvpEvent" defaultChecked className="w-4 h-4" />
            In rsvp-app ein neues Event anlegen (gehört dort {poll.owner?.name || poll.owner?.email || 'dem Konto dieser Abstimmung'})
          </label>
        )}
        {status.state === 'ok' && status.events.length === 0 && !status.canCreate && (
          <p>In rsvp-app zeigt kein Event auf diese Abstimmung. Ein neues kann nur entstehen, wenn das Konto dieser Abstimmung mit einem rsvp-app-Konto verknüpft ist (Mein Konto → verknüpfen).</p>
        )}
        <p>
          {poll.voterIdentity === 'COOKIE'
            ? 'Benachrichtigt wird niemand: Bei "Offen für alle" ist anonym abgestimmt worden.'
            : `Benachrichtigt werden ${reachable} erreichbare Abstimmende (Push bei Konten mit Mitteilungen, sonst Mail).`}
        </p>
      </div>

      <SubmitButton>{tie ? 'Diesen Termin festlegen' : 'Termin bestätigen'}</SubmitButton>
    </form>
  )
}
