// app/[pollId]/verwalten/bearbeiten/page.tsx
import { prisma } from '../../../lib/prisma'
import { canCreatePolls } from '../../../lib/permissions'
import { duplicatePoll, sharePoll, unsharePoll, updatePoll } from '../../../actions'
import { manageUrl } from '../../../lib/manage'
import SubmitButton from '../../../ui/submit-button'
import Notice from '../../../ui/notice'
import OptionsFieldList from '../../../erstellen/options-field-list'
import PollSettingsFields from '../../../erstellen/poll-settings-fields'
import { inputTypeFor, toInputValue } from '../../../lib/date-options'
import { buttonClass, ButtonLink, Card, formatShortDate, hintClass, inputClass, labelClass, SettingsSection } from '../../../ui/kit'
import DeletePollButton from '../delete-poll-button'
import PollFrame, { loadManagedPoll } from '../poll-frame'

export const dynamic = 'force-dynamic'

const MAX_OPTIONS = 25 // Muss mit MAX_OPTIONS in app/actions.ts übereinstimmen

const SHARE_ERRORS: Record<string, string> = {
  notfound: 'Zu dieser E-Mail-Adresse gibt es kein Konto. Lade die Person zuerst ein (Konten) oder bitte sie, sich einmal anzumelden.',
  owner: 'Diese Person besitzt die Abstimmung bereits.'
}

/**
 * Reiter "Einstellungen" (Pfad weiterhin /bearbeiten, docs/KONZEPT-OBERFLAECHE.md): ein Formular in einklappbaren
 * Abschnitten mit Kurzstand - Grunddaten, Optionen, Art, Wer darf abstimmen, Ergebnis, Zugang - und einer
 * Speichern-Leiste, die unten sichtbar bleibt. Darunter, als eigene Formulare: gemeinsam moderieren (Owner),
 * Duplizieren und Löschen (Owner). Moderator:innen mit Freigabe dürfen bearbeiten, daher genügt jede Stufe.
 */
export default async function BearbeitenPage({
  params,
  searchParams
}: {
  params: Promise<{ pollId: string }>
  searchParams: Promise<{ token?: string; saved?: string; shared?: string; shareError?: string; abschnitt?: string }>
}) {
  const { pollId } = await params
  const { token, saved, shared, shareError, abschnitt } = await searchParams
  const loaded = await loadManagedPoll(pollId, token, 'bearbeiten')
  const { poll, user, isOwner, legacy, legacyToken } = loaded

  const [options, optionCount, access] = await Promise.all([
    prisma.pollOption.findMany({
      where: { pollId: poll.id, approved: true },
      orderBy: { position: 'asc' },
      include: { _count: { select: { votes: true } } }
    }),
    // Alle Optionen inkl. offener Vorschläge zählen gegen die Höchstzahl.
    prisma.pollOption.count({ where: { pollId: poll.id } }),
    isOwner && !legacy
      ? prisma.pollAccess.findMany({ where: { pollId: poll.id }, select: { id: true, user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } })
      : Promise.resolve([])
  ])
  const locked = options.some(o => o._count.votes > 0)
  const closesAtValue = poll.closesAt ? toInputValue(poll.closesAt, 'DATETIME') : ''

  return (
    <PollFrame loaded={loaded}>
      <div className="space-y-6">
        {saved === '1' && <Notice tone="success">Gespeichert.</Notice>}
        {shared === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}
        {shareError && Object.hasOwn(SHARE_ERRORS, shareError) && <Notice tone="error">{SHARE_ERRORS[shareError]}</Notice>}

        <form action={updatePoll} className="space-y-3">
          <input type="hidden" name="pollId" value={poll.id} />
          {legacyToken && <input type="hidden" name="creatorToken" value={legacyToken} />}

          <SettingsSection id="grunddaten" title="Grunddaten" open={!abschnitt || abschnitt === 'grunddaten'} marker="blue" summary={poll.closesAt ? `endet ${formatShortDate(poll.closesAt)}` : 'ohne Enddatum'}>
            <div>
              <label htmlFor="poll-title" className={labelClass}>Frage / Titel</label>
              <input id="poll-title" type="text" name="title" defaultValue={poll.title} required maxLength={200} className={inputClass} />
            </div>
            <div>
              <label htmlFor="poll-description" className={labelClass}>Beschreibung (optional)</label>
              <textarea id="poll-description" name="description" defaultValue={poll.description || ''} rows={2} maxLength={200} className={inputClass} />
            </div>
            <div>
              <label htmlFor="poll-closes-at" className={labelClass}>Automatisch schließen am (optional)</label>
              <input id="poll-closes-at" type="datetime-local" name="closesAt" defaultValue={closesAtValue} className={inputClass.replace('w-full', 'w-full sm:w-64')} />
            </div>
          </SettingsSection>

          <SettingsSection
            id="optionen" title="Optionen" open={!abschnitt || abschnitt === 'optionen'} marker="blue"
            summary={`${options.length} Option${options.length === 1 ? '' : 'en'}${poll.optionKind !== 'TEXT' ? ` (${poll.optionKind === 'DATE' ? 'Tage' : 'Termine mit Uhrzeit'})` : ''}`}
          >
            <div className="space-y-2">
              {options.map(option => {
                const hasVotes = option._count.votes > 0
                return (
                  <div key={option.id} className="flex items-center gap-2">
                    <input type="hidden" name="existingOptionId" value={option.id} />
                    <input
                      type={inputTypeFor(poll.optionKind)}
                      name="existingOptionLabel"
                      defaultValue={option.startsAt && poll.optionKind !== 'TEXT' ? toInputValue(option.startsAt, poll.optionKind) : option.label}
                      maxLength={200}
                      required
                      aria-label={`Option ${option.label}`}
                      className={inputClass.replace('w-full', 'flex-1')}
                    />
                    {hasVotes ? (
                      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap" title="Optionen mit bereits abgegebenen Stimmen können nicht gelöscht werden">
                        {option._count.votes} Stimme{option._count.votes === 1 ? '' : 'n'} · gesperrt
                      </span>
                    ) : (
                      <label className="flex items-center gap-1 text-xs text-red-700 dark:text-red-300 whitespace-nowrap cursor-pointer">
                        <input type="checkbox" name="deleteOptionId" value={option.id} className="w-4 h-4" />
                        entfernen
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
            <p className={hintClass}>Optionen mit bereits abgegebenen Stimmen können umbenannt, aber nicht gelöscht werden.</p>
            <div>
              <p className={labelClass}>Weitere Optionen hinzufügen</p>
              <OptionsFieldList name="newOption" max={Math.max(MAX_OPTIONS - optionCount, 0)} startCount={0} inputType={inputTypeFor(poll.optionKind)} />
            </div>
          </SettingsSection>

          <PollSettingsFields poll={poll} locked={locked} open={abschnitt} />

          <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-end gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border dark:border-gray-700 dark:bg-gray-900/95">
            <ButtonLink href={manageUrl(poll.id, legacyToken)} variant="ghost">Abbrechen</ButtonLink>
            <SubmitButton inline>Änderungen speichern</SubmitButton>
          </div>
        </form>

        {isOwner && !legacy && (
          <Card className="space-y-3">
            <h2 className="font-semibold">Gemeinsam moderieren</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Personen mit Freigabe können die Abstimmung bearbeiten und schließen - nicht löschen oder weiter teilen.
            </p>
            {access.length > 0 && (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-700" aria-label="Freigaben">
                {access.map(entry => (
                  <li key={entry.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate">{entry.user.name ? `${entry.user.name} · ` : ''}{entry.user.email}</span>
                    <form action={unsharePoll}>
                      <input type="hidden" name="accessId" value={entry.id} />
                      <button type="submit" className="text-sm font-medium text-red-700 dark:text-red-300 hover:underline">Entziehen</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={sharePoll} className="flex gap-2">
              <input type="hidden" name="pollId" value={poll.id} />
              <label htmlFor="share-email" className="sr-only">E-Mail des Kontos</label>
              <input id="share-email" type="email" name="email" required maxLength={254} placeholder="E-Mail-Adresse eines bestehenden Kontos" className={inputClass.replace('w-full', 'min-w-0 flex-1')} />
              <button type="submit" className={buttonClass('primary')}>Freigeben</button>
            </form>
          </Card>
        )}

        {((user && canCreatePolls(user)) || isOwner) && (
          <Card className="space-y-3">
            <h2 className="font-semibold">Weitere Aktionen</h2>
            <div className="flex flex-wrap gap-3">
              {user && canCreatePolls(user) && (
                <form action={duplicatePoll}>
                  <input type="hidden" name="pollId" value={poll.id} />
                  {legacyToken && <input type="hidden" name="creatorToken" value={legacyToken} />}
                  <button type="submit" className={buttonClass('secondary')}>Duplizieren</button>
                </form>
              )}
              {isOwner && <DeletePollButton pollId={poll.id} creatorToken={legacy ? legacyToken : undefined} />}
            </div>
            <p className={hintClass}>
              Duplizieren legt eine Kopie mit Optionen und Einstellungen an - ohne Stimmen und Schließdatum, z.B. für die
              nächste Runde. Löschen entfernt die Abstimmung mit allen Stimmen unwiderruflich.
            </p>
          </Card>
        )}
      </div>
    </PollFrame>
  )
}
