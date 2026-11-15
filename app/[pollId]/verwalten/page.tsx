// app/[pollId]/verwalten/page.tsx
import Link from 'next/link'
import { prisma } from '../../lib/prisma'
import { claimPoll, confirmRsvpEvent, dismissRsvpEvent, reviewSuggestion, unlinkRsvpEvent } from '../../actions'
import { baseUrl } from '../../lib/base-url'
import PollResults from '../poll-results'
import { loadResult, loadVoterNames, tallySealed } from '../../lib/results'
import { canCreatePolls } from '../../lib/permissions'
import { manageUrl } from '../../lib/manage'
import { pollStatus } from '../../lib/poll-status'
import QrCode from '../../ui/qr-code'
import { ButtonLink, Card, ConfirmForm, Stat, CopyableField, Notice, SubmitButton, buttonClass } from '../../ui/kit'
import FinalDateSection from './final-date-section'
import PollFrame, { loadManagedPoll } from './poll-frame'

export const dynamic = 'force-dynamic'

/**
 * Übersicht einer Abstimmung (docs/KONZEPT-OBERFLAECHE.md): Kennzahlen, was zu tun ist (Termin festlegen,
 * Vorschläge freigeben), Ergebnis mit Namen und CSV, Link zum Teilen mit QR-Code und Zugangscode.
 */
export default async function VerwaltenPage({
  params,
  searchParams
}: {
  params: Promise<{ pollId: string }>
  searchParams: Promise<{ token?: string; created?: string; claimed?: string; duplicated?: string; festgelegt?: string; terminFehler?: string; geloest?: string; verknuepft?: string }>
}) {
  const { pollId } = await params
  const { token, created, claimed, duplicated, festgelegt, terminFehler, geloest, verknuepft } = await searchParams
  const loaded = await loadManagedPoll(pollId, token, '')
  const { poll, user, legacy, legacyToken, isOwner } = loaded

  const [loadedResult, voterNames, pendingCount, links, rsvpCandidates] = await Promise.all([
    loadResult(poll.id),
    // Wer verwaltet, sieht Namen immer (sofern die Art der Stimmabgabe welche liefert) - öffentlich nur mit showVoterNames.
    loadVoterNames(poll.id),
    prisma.pollOption.count({ where: { pollId: poll.id, approved: false } }),
    poll.voterIdentity === 'LINK' ? prisma.voterLink.findMany({ where: { pollId: poll.id }, select: { hasVoted: true } }) : Promise.resolve(null),
    // Termine aus rsvp-app, die auf die Abstimmung zeigen und auf Bestätigung warten (app/lib/rsvp-binding.ts)
    poll.voterIdentity === 'RSVP' && !poll.rsvpEventId && !poll.assemblyId
      ? prisma.rsvpEventCandidate.findMany({ where: { pollId: poll.id }, orderBy: { createdAt: 'asc' }, select: { eventId: true, eventTitle: true } })
      : Promise.resolve([])
  ])
  // Siehe app/[pollId]/page.tsx für die Begründung, warum die Prozent-Basis in PollResults die Anzahl
  // abstimmender Personen ist, nicht die Summe der Stimmen.
  const result = loadedResult!
  const { voters } = result
  const hasVoterNames = Object.keys(voterNames).length > 0
  const status = pollStatus(poll)
  // Für die Ergebnis-Anzeige zählt auch ein abgelaufenes Schließdatum, das der Cron noch nicht verarbeitet hat.
  const ended = status.state !== 'open'
  const publicLink = `${baseUrl()}/${poll.id}`
  const tokenQuery = legacyToken ? `?token=${encodeURIComponent(legacyToken)}` : ''
  // Geheime Wahl: bis zum Ende kein Zwischenstand, auch hier nicht (app/lib/results.ts tallySealed, V-11)
  const sealed = tallySealed(poll, ended)
  const leader = !sealed && voters > 0 && result.winners.length > 0 ? result.winners : null
  const votedLinks = links ? links.filter(l => l.hasVoted).length : 0

  return (
    <PollFrame loaded={loaded}>
      <div className="space-y-6">
        {created === '1' && (
          <Notice tone="success">
            Abstimmung erstellt! Teile den Link unten mit der Gruppe. Wer abstimmen darf, Ergebnis, Zugangscode und mehr
            stellst du unter <Link href={manageUrl(poll.id, legacyToken, undefined, 'bearbeiten')} className="font-medium underline">Einstellungen</Link> ein.
          </Notice>
        )}
        {claimed === '1' && <Notice tone="success">Die Abstimmung gehört jetzt zu deinem Konto. Alte Verwaltungs-Links sind ungültig.</Notice>}
        {festgelegt === '1' && <Notice tone="success">Termin festgelegt. Die erreichbaren Abstimmenden wurden benachrichtigt.</Notice>}
        {geloest === '1' && <Notice tone="info">Die Verknüpfung ist gelöst. Abgestimmt werden kann erst wieder über einen Termin, den du bestätigst.</Notice>}
        {verknuepft === '1' && poll.rsvpEventId && <Notice tone="success">Der Termin ist bestätigt. Über ihn kann jetzt abgestimmt werden.</Notice>}
        {duplicated === '1' && <Notice tone="success">Kopie angelegt - ohne Stimmen und ohne Schließdatum. Passe sie unter &quot;Einstellungen&quot; an.</Notice>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Teilnehmende" value={voters} testId="stat-voters"
            progress={poll.maxVoters !== null ? { value: voters, max: poll.maxVoters } : null}
            hint={poll.maxVoters !== null ? `von höchstens ${poll.maxVoters}` : poll.quorum !== null ? `mindestens ${poll.quorum} nötig` : undefined}
          />
          {links ? (
            <Stat
              label="Stimmlinks" value={`${votedLinks} / ${links.length}`} testId="stat-links" hint="haben abgestimmt"
              progress={links.length > 0 ? { value: votedLinks, max: links.length } : null}
            />
          ) : (
            <Stat label="Optionen" value={result.options.length} hint={pendingCount > 0 ? `+ ${pendingCount} Vorschlag${pendingCount === 1 ? '' : 'e'} offen` : undefined} />
          )}
          <Stat
            label={ended ? 'Ergebnis' : 'Vorne'} testId="stat-leader"
            value={<span className="block truncate text-lg" title={leader?.map(w => w.label).join(', ')}>{leader ? (leader.length > 1 ? `${leader.length} gleichauf` : leader[0].label) : '–'}</span>}
            tone={ended && !result.quorumMet ? 'red' : undefined}
            hint={sealed ? 'geheime Wahl - erst nach dem Ende' : ended && !result.quorumMet ? 'nicht beschlussfähig' : leader && leader.length > 1 ? leader.map(w => w.label).join(', ') : undefined}
          />
          <Stat label="Stand" value={<span className="text-lg">{status.badge}</span>} hint={status.text} testId="stat-status" />
        </div>

        <FinalDateSection poll={poll} result={result} legacyToken={legacyToken} error={terminFehler} />

        {(poll.voterIdentity === 'RSVP' || poll.rsvpEventId) && (
          <Card className="space-y-2">
            <h2 className="font-semibold">Termin in rsvp-app</h2>
            {poll.rsvpEventId ? (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="rsvp-link">
                  Verknüpft mit dem Termin {poll.rsvpEventTitle && <strong>{poll.rsvpEventTitle}</strong>}{' '}
                  <code className="text-xs">{poll.rsvpEventId}</code>. Nur über diesen Termin kann abgestimmt werden, und
                  nur er bekommt das Ergebnis gemeldet.
                </p>
                {isOwner && (
                  <ConfirmForm action={unlinkRsvpEvent} message="Verknüpfung lösen? Abgestimmt werden kann danach erst wieder über einen Termin, den du bestätigst.">
                    <input type="hidden" name="pollId" value={poll.id} />
                    {legacyToken && <input type="hidden" name="creatorToken" value={legacyToken} />}
                    {!ended && voters > 0 && (
                      <label className="mb-2 flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" name="deleteVotes" className="h-4 w-4" />
                        Stimmen über diesen Termin entfernen (falls es der falsche Termin war)
                      </label>
                    )}
                    <button type="submit" className={buttonClass('secondary', 'sm')}>Verknüpfung lösen</button>
                  </ConfirmForm>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Noch mit keinem Termin verknüpft - abstimmen kann noch niemand. Trag den Link dieser Abstimmung in
                  rsvp-app bei deinem Termin ein und bestätige ihn hier. Gehört der Termin deinem dort verknüpften Konto,
                  gilt er ohne Rückfrage.
                </p>
                {rsvpCandidates.length > 0 && (
                  <ul className="space-y-2" data-testid="rsvp-candidates">
                    {rsvpCandidates.map(c => (
                      <li key={c.eventId} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                        <p>
                          Termin {c.eventTitle ? <strong>{c.eventTitle}</strong> : 'ohne Titel'} <code className="text-xs">{c.eventId}</code> zeigt
                          auf diese Abstimmung.
                        </p>
                        {isOwner ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <ConfirmForm action={confirmRsvpEvent} message="Diesen Termin bestätigen? Nur seine Gäste können dann abstimmen, und er bekommt das Ergebnis gemeldet.">
                              <input type="hidden" name="pollId" value={poll.id} />
                              <input type="hidden" name="eventId" value={c.eventId} />
                              {legacyToken && <input type="hidden" name="creatorToken" value={legacyToken} />}
                              <button type="submit" className={buttonClass('primary', 'sm')}>Das ist unser Termin</button>
                            </ConfirmForm>
                            <form action={dismissRsvpEvent}>
                              <input type="hidden" name="pollId" value={poll.id} />
                              <input type="hidden" name="eventId" value={c.eventId} />
                              {legacyToken && <input type="hidden" name="creatorToken" value={legacyToken} />}
                              <button type="submit" className={buttonClass('secondary', 'sm')}>Verwerfen</button>
                            </form>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {rsvpCandidates.length > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    In rsvp-app kann jede Verwaltung eines Termins den Link dieser Abstimmung eintragen, auch mit demselben
                    Titel. Die Kennung steht dort in der Adresse der Termin-Verwaltung. Bestätige nur deinen eigenen.
                  </p>
                )}
              </>
            )}
          </Card>
        )}

        {pendingCount > 0 && <PendingSuggestions pollId={poll.id} legacyToken={legacyToken} />}

        {legacy && user && canCreatePolls(user) && token && (
          <Card className="space-y-3">
            <h2 className="font-semibold">Deinem Konto zuordnen</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Diese Abstimmung wurde noch ohne Konto angelegt und ist nur über den Verwaltungs-Link erreichbar. Ordne sie
              deinem Konto zu, um sie unter &quot;Abstimmungen&quot; zu finden und mit anderen zu teilen. Der alte
              Verwaltungs-Link wird dabei ungültig.
            </p>
            <form action={claimPoll}>
              <input type="hidden" name="pollId" value={poll.id} />
              <input type="hidden" name="creatorToken" value={token} />
              <SubmitButton inline>Meinem Konto zuordnen</SubmitButton>
            </form>
          </Card>
        )}

        {legacy && !user && (
          <Notice tone="info">
            Mit einem Konto (<Link href={`/anmelden?next=${encodeURIComponent(`/${poll.id}/verwalten${tokenQuery}`)}`} className="underline">anmelden</Link>)
            kannst du diese Abstimmung dauerhaft deinem Konto zuordnen, statt dich auf den Verwaltungs-Link zu verlassen.
          </Notice>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                Ergebnis ({voters} Person{voters === 1 ? '' : 'en'}{poll.maxVoters !== null ? ` von höchstens ${poll.maxVoters}` : ''})
              </h2>
              {!sealed && <a href={`/${poll.id}/verwalten/export${tokenQuery}`} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">CSV-Export ↓</a>}
            </div>
            {sealed ? (
              <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="sealed-result">
                Geheime Wahl: Den Zwischenstand sieht bis zum Ende niemand, auch die Verwaltung nicht - sonst ließe sich
                neben der Beteiligung je Stimmlink ablesen, wer wofür gestimmt hat. Bisher {voters === 1 ? 'hat 1 Person' : `haben ${voters} Personen`} abgestimmt.
              </p>
            ) : (
              <PollResults result={result} names={voterNames} showVoterNames closed={ended} />
            )}
            {hasVoterNames && !poll.showVoterNames && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                Die Namen oben siehst nur du (und wer die Abstimmung verwaltet). Auf der öffentlichen Seite sind sie
                verborgen - &quot;Abstimmende namentlich anzeigen&quot; ist aus (Einstellungen → Ergebnis).
              </p>
            )}
          </Card>

          <Card className="space-y-4 lg:col-span-2">
            <h2 className="font-semibold">Zum Abstimmen</h2>
            {poll.voterIdentity === 'LINK' && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Abgestimmt wird mit persönlichen Links - der allgemeine Link zeigt nur die Abstimmung.
              </p>
            )}
            <CopyableField label="Link zum Teilen (zum Abstimmen)" value={publicLink} />
            <details className="text-sm text-gray-600 dark:text-gray-400">
              <summary className="cursor-pointer">QR-Code zum Link</summary>
              <div className="mt-2"><QrCode value={publicLink} label="QR-Code zum Abstimmungslink" /></div>
            </details>
            {poll.accessCode && (
              <>
                <CopyableField label="Zugangscode (getrennt vom Link weitergeben)" value={poll.accessCode} />
                <CopyableField
                  label="Oder: Link inkl. Zugangscode (füllt das Code-Feld vor - wer ihn hat, kommt hinein)"
                  value={`${publicLink}?code=${encodeURIComponent(poll.accessCode)}`}
                />
              </>
            )}
            {legacy && token && (
              <CopyableField label="Verwaltungs-Link (nur für dich - nicht teilen!)" value={`${baseUrl()}/${poll.id}/verwalten?token=${token}`} />
            )}
            {poll.voterIdentity === 'LINK' && (
              <ButtonLink href={manageUrl(poll.id, legacyToken, undefined, 'stimmlinks')} variant="primary">Stimmlinks ausstellen</ButtonLink>
            )}
          </Card>
        </div>
      </div>
    </PollFrame>
  )
}

/** Offene Options-Vorschläge von Teilnehmenden (Poll.allowVoterOptions) zum Freigeben oder Ablehnen. */
async function PendingSuggestions({ pollId, legacyToken }: { pollId: string; legacyToken: string }) {
  const pending = await prisma.pollOption.findMany({ where: { pollId, approved: false }, orderBy: { position: 'asc' }, select: { id: true, label: true } })
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-amber-500" />Vorschläge von Teilnehmenden ({pending.length})</h2>
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-700">
        {pending.map(option => (
          <li key={option.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="truncate">{option.label}</span>
            <form action={reviewSuggestion} className="flex gap-3 text-sm">
              <input type="hidden" name="pollId" value={pollId} />
              <input type="hidden" name="optionId" value={option.id} />
              {legacyToken && <input type="hidden" name="creatorToken" value={legacyToken} />}
              <button type="submit" name="intent" value="approve" className="font-medium text-green-700 dark:text-green-300 hover:underline" aria-label={`${option.label} freigeben`}>Freigeben</button>
              <button type="submit" name="intent" value="reject" className="font-medium text-red-700 dark:text-red-300 hover:underline" aria-label={`${option.label} ablehnen`}>Ablehnen</button>
            </form>
          </li>
        ))}
      </ul>
    </Card>
  )
}
