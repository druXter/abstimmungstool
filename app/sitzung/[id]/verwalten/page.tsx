// app/sitzung/[id]/verwalten/page.tsx
import { notFound, redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import { loadResult, loadVoterNames } from '../../../lib/results'
import { fetchRoster } from '../../../lib/assembly-coupling'
import { getAssemblyLevel, quorumState, SPEAKER_KIND_LABEL, speakerOrder } from '../../../lib/assembly'
import {
  closeAssembly, closeAssemblyPoll, createAssemblyPoll, deleteAssembly, deleteAssemblyPoll, manageSpeaker, shareAssembly, unlinkAssembly,
  unshareAssembly, updateAssembly
} from '../../../assembly-actions'
import CopyableField from '../../../ui/copyable-field'
import ConfirmForm from '../../../ui/confirm-form'
import Notice from '../../../ui/notice'
import SubmitButton from '../../../ui/submit-button'
import { Badge, buttonClass, ButtonLink, Card, hintClass, inputClass, labelClass, Main, PageHeader, Stat } from '../../../ui/kit'
import AssemblySettingsFields from '../../settings-fields'
import LiveRefresh from '../../live-refresh'
import QuorumLine from '../../quorum-line'

export const dynamic = 'force-dynamic'

const NOTICES: Record<string, { tone: 'success' | 'error' | 'info'; text: string }> = {
  neu: { tone: 'success', text: 'Sitzung angelegt. Verknüpfe sie jetzt mit dem Termin in rsvp-app (Link unten), dann können Mitglieder beitreten.' },
  gespeichert: { tone: 'success', text: 'Einstellungen gespeichert.' },
  abstimmung: { tone: 'success', text: 'Abstimmung gestartet - sie erscheint sofort bei den Mitgliedern.' },
  geloest: { tone: 'info', text: 'Die Verknüpfung ist gelöst, alle Mitglieder sind entfernt. Der nächste Termin, der die Sitzung meldet, wird verknüpft.' },
  geteilt: { tone: 'success', text: 'Freigegeben.' }
}
const ERRORS: Record<string, string> = {
  titel: 'Bitte gib einen Titel für die Abstimmung ein.',
  optionen: 'Eine Wahl braucht 2 bis 25 verschiedene Optionen, eine pro Zeile.',
  unbekannt: 'Zu dieser E-Mail-Adresse gibt es kein Konto. Lade die Person zuerst unter "Konten" ein.',
  owner: 'Diese Person besitzt die Sitzung bereits.'
}

/**
 * Verwaltung einer Sitzung (docs/KONZEPT-SITZUNG.md): Verknüpfung mit rsvp-app, Anwesenheit und Beschlussfähigkeit live,
 * "Neue Abstimmung" mit wenig Klicks, offene Abstimmungen mit Schließen, Rednerliste, Ergebnisse mit CSV, Einstellungen,
 * Teilen und Löschen. Aktualisiert sich selbst.
 */
export default async function ManageAssemblyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const assembly = await prisma.assembly.findUnique({
    where: { id },
    include: {
      owner: { select: { email: true } },
      access: { select: { id: true, user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } },
      polls: { orderBy: { createdAt: 'desc' }, select: { id: true, title: true, closedAt: true, createdAt: true, secretBallot: true, assemblyPresent: true, assemblyQuorumMet: true } },
      speakers: { where: { doneAt: null }, include: { member: { select: { name: true } } } },
      _count: { select: { members: true } }
    }
  })
  if (!assembly) notFound()
  const user = await getCurrentUser()
  const level = await getAssemblyLevel(user, assembly)
  if (!level) {
    if (!user) redirect(`/anmelden?next=${encodeURIComponent(`/sitzung/${id}/verwalten`)}`)
    notFound()
  }
  const isOwner = level === 'owner'
  const hidden = <input type="hidden" name="assemblyId" value={assembly.id} />

  const roster = await fetchRoster(assembly)
  const quorum = quorumState(assembly, roster)
  const open = assembly.polls.filter(p => !p.closedAt)
  const closed = assembly.polls.filter(p => p.closedAt)
  const voterCounts = new Map((await prisma.vote.groupBy({ by: ['pollId', 'voterKey'], where: { pollId: { in: open.map(p => p.id) } } }))
    .reduce((m, v) => m.set(v.pollId, (m.get(v.pollId) ?? 0) + 1), new Map<string, number>()))
  const results = await Promise.all(closed.map(async poll => ({ poll, result: await loadResult(poll.id), names: poll.secretBallot ? {} : await loadVoterNames(poll.id) })))
  const speakers = speakerOrder(assembly.speakers)
  const link = `${baseUrl()}/sitzung/${assembly.id}`
  const flag = Object.keys(NOTICES).find(k => query[k])
  const error = ERRORS[query.fehler ?? ''] ?? ERRORS[query.teilenFehler ?? '']

  return (
    <Main>
      <LiveRefresh assemblyId={assembly.id} version={assembly.version} everySeconds={10} />
      <PageHeader
        title={assembly.title}
        back={{ href: '/meine-abstimmungen', label: 'Alle Abstimmungen' }}
        subtitle={<>Sitzung{assembly.closedAt ? ' · beendet' : ''}{level === 'moderator' ? ` · freigegeben von ${assembly.owner.email}` : ''}</>}
        actions={<ButtonLink href={`/sitzung/${assembly.id}`} external>Mitgliederansicht ↗</ButtonLink>}
      />
      <div className="space-y-6">
        {flag && <Notice tone={NOTICES[flag].tone}>{NOTICES[flag].text}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Anwesend" value={quorum.present ?? '–'} hint={quorum.members !== null ? `von ${quorum.members} Zusagen` : roster.state === 'unreachable' ? 'rsvp-app nicht erreichbar' : 'kein Termin verknüpft'} testId="stat-present" />
          <Stat label="Beschlussfähig" value={quorum.met === null ? '–' : quorum.met ? 'ja' : 'nein'} tone={quorum.met === false ? 'red' : quorum.met ? 'green' : undefined} hint={assembly.quorum !== null ? `ab ${assembly.quorum} Anwesenden` : 'nicht eingestellt'} testId="stat-quorum" />
          <Stat label="Beigetreten" value={assembly._count.members} hint="Mitglieder über rsvp-app" />
          <Stat label="Abstimmungen" value={assembly.polls.length} hint={open.length > 0 ? `${open.length} offen` : undefined} />
        </div>
        <QuorumLine state={quorum} />

        <Card className="space-y-3">
          <h2 className="font-semibold">Verknüpfung mit rsvp-app</h2>
          {assembly.rsvpEventId ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p data-testid="assembly-link">Verknüpft mit dem Termin <strong>{assembly.rsvpEventTitle || assembly.rsvpEventId}</strong>. Mitglieder treten dort über „🗳️ Zur Sitzung“ bei.</p>
              {isOwner && (
                <ConfirmForm action={unlinkAssembly} message="Verknüpfung lösen? Alle Mitglieder werden entfernt und müssen neu beitreten.">
                  {hidden}
                  <button type="submit" className={buttonClass('secondary', 'sm')}>Verknüpfung lösen</button>
                </ConfirmForm>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-700 dark:text-gray-300">Noch kein Termin verknüpft. Trag diesen Link in rsvp-app beim Termin unter „Verknüpfungen“ als Sitzung ein - Gäste mit Zusage sehen dann „🗳️ Zur Sitzung“.</p>
              <CopyableField value={link} label="Link der Sitzung" />
            </>
          )}
        </Card>

        {!assembly.closedAt && (
          <Card className="space-y-4">
            <h2 id="neue-abstimmung" className="font-semibold">Neue Abstimmung</h2>
            <form action={createAssemblyPoll} className="space-y-3">
              {hidden}
              <div>
                <label htmlFor="poll-title" className={labelClass}>Antrag bzw. Frage</label>
                <input id="poll-title" name="title" required maxLength={200} placeholder="z.B. Antrag 3: Haushalt 2027" className={inputClass} />
              </div>
              <fieldset className="space-y-2">
                <legend className={labelClass}>Art</legend>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="kind" value="yesno" defaultChecked /> Ja / Nein / Enthaltung</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="kind" value="choice" /> Wahl mit eigenen Optionen</label>
              </fieldset>
              <div>
                <label htmlFor="poll-options" className={labelClass}>Optionen der Wahl (eine pro Zeile)</label>
                <textarea id="poll-options" name="options" rows={3} placeholder={'Anna\nBen\nEnthaltung'} className={inputClass} />
                <p className={hintClass}>Nur für „Wahl“. Bei Ja / Nein / Enthaltung bleibt das Feld leer.</p>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="multiple" /> Mehrere Optionen wählbar (nur Wahl)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="secret" defaultChecked={assembly.secretDefault} /> Geheim (sonst namentlich)</label>
              <SubmitButton inline>Abstimmung starten</SubmitButton>
            </form>
          </Card>
        )}

        {open.length > 0 && (
          <Card className="space-y-3">
            <h2 className="font-semibold">Offen</h2>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700" data-testid="open-polls">
              {open.map(poll => (
                <li key={poll.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">{poll.title}</span> <Badge tone={poll.secretBallot ? 'indigo' : 'gray'}>{poll.secretBallot ? 'geheim' : 'namentlich'}</Badge>
                    <span className="block text-sm text-gray-600 dark:text-gray-400">{voterCounts.get(poll.id) ?? 0} abgestimmt{quorum.present !== null ? ` von ${quorum.present} Anwesenden` : ''}</span>
                  </span>
                  <span className="flex gap-2">
                    <form action={closeAssemblyPoll}>
                      {hidden}
                      <input type="hidden" name="pollId" value={poll.id} />
                      <button type="submit" className={buttonClass('primary', 'sm')}>Schließen</button>
                    </form>
                    <ConfirmForm action={deleteAssemblyPoll} message="Abstimmung samt Stimmen löschen?">
                      {hidden}
                      <input type="hidden" name="pollId" value={poll.id} />
                      <button type="submit" className={buttonClass('secondary', 'sm')}>Löschen</button>
                    </ConfirmForm>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {assembly.speakerList && (
          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 id="rednerliste" className="font-semibold">Rednerliste</h2>
              {speakers.length > 0 && (
                <form action={manageSpeaker}>
                  {hidden}
                  <input type="hidden" name="intent" value="clear" />
                  <button type="submit" className="text-sm text-gray-600 hover:underline dark:text-gray-400">Liste leeren</button>
                </form>
              )}
            </div>
            {speakers.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-400">Niemand auf der Liste.</p> : (
              <ol className="divide-y divide-gray-100 dark:divide-gray-700" data-testid="speaker-queue">
                {speakers.map(s => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span className={s.calledAt ? 'font-semibold text-green-700 dark:text-green-400' : ''}>
                      {s.calledAt ? '🎤 ' : ''}{s.member.name} <span className="text-xs text-gray-500 dark:text-gray-400">{SPEAKER_KIND_LABEL[s.kind]}</span>
                    </span>
                    <form action={manageSpeaker} className="flex gap-2">
                      {hidden}
                      <input type="hidden" name="speakerId" value={s.id} />
                      {!s.calledAt && <button type="submit" name="intent" value="call" className={buttonClass('primary', 'sm')}>Aufrufen</button>}
                      <button type="submit" name="intent" value="done" className={buttonClass('secondary', 'sm')}>Erledigt</button>
                    </form>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        )}

        {results.length > 0 && (
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Ergebnisse</h2>
              <a href={`/sitzung/${assembly.id}/verwalten/export`} download className={buttonClass('secondary', 'sm')}>📥 Beschlüsse als CSV</a>
            </div>
            <ul className="space-y-3" data-testid="closed-polls">
              {results.map(({ poll, result, names }) => result && (
                <li key={poll.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="font-medium">{poll.title} <Badge tone={poll.secretBallot ? 'indigo' : 'gray'}>{poll.secretBallot ? 'geheim' : 'namentlich'}</Badge></span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{poll.closedAt!.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <ul className="mt-1 text-sm">
                    {result.options.map(o => (
                      <li key={o.id}><span className="tabular-nums font-semibold">{o.votes}</span> {o.label}{names[o.id]?.length ? <span className="text-gray-500 dark:text-gray-400"> ({names[o.id].map(n => n.name).join(', ')})</span> : null}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {[`${result.voters} abgestimmt`, poll.assemblyPresent !== null ? `${poll.assemblyPresent} anwesend` : null,
                      poll.assemblyQuorumMet === true ? 'beschlussfähig' : poll.assemblyQuorumMet === false ? 'nicht beschlussfähig' : null].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="space-y-4">
          <h2 className="font-semibold">Einstellungen</h2>
          <form action={updateAssembly} className="space-y-4">
            {hidden}
            <div>
              <label htmlFor="assembly-title" className={labelClass}>Titel</label>
              <input id="assembly-title" name="title" required maxLength={200} defaultValue={assembly.title} className={inputClass} />
            </div>
            <AssemblySettingsFields value={assembly} />
            <SubmitButton inline>Speichern</SubmitButton>
          </form>
        </Card>

        {isOwner && (
          <Card className="space-y-3">
            <h2 id="teilen" className="font-semibold">Gemeinsam leiten</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">Andere Konten dürfen dann Abstimmungen starten und schließen, die Rednerliste führen und die Einstellungen ändern - nicht löschen oder weiter teilen.</p>
            {assembly.access.length > 0 && (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-700" aria-label="Freigaben">
                {assembly.access.map(a => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="truncate">{a.user.name ? `${a.user.name} (${a.user.email})` : a.user.email}</span>
                    <form action={unshareAssembly}>
                      <input type="hidden" name="accessId" value={a.id} />
                      <button type="submit" className="text-sm font-medium text-red-700 hover:underline dark:text-red-300">Entfernen</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={shareAssembly} className="flex gap-2">
              {hidden}
              <label htmlFor="assembly-share-email" className="sr-only">E-Mail-Adresse des Kontos</label>
              <input id="assembly-share-email" type="email" name="email" required placeholder="E-Mail-Adresse eines Kontos" className={inputClass.replace('w-full', 'min-w-0 grow')} />
              <button type="submit" className={buttonClass('primary')}>Teilen</button>
            </form>
          </Card>
        )}

        <Card className="space-y-3">
          <h2 className="font-semibold">Weitere Aktionen</h2>
          <div className="flex flex-wrap gap-3">
            <form action={closeAssembly}>
              {hidden}
              {assembly.closedAt
                ? <button type="submit" name="intent" value="reopen" className={buttonClass('secondary')}>Sitzung wieder öffnen</button>
                : <button type="submit" name="intent" value="close" className={buttonClass('secondary')}>Sitzung beenden</button>}
            </form>
            {isOwner && (
              <ConfirmForm action={deleteAssembly} message="Sitzung samt aller Abstimmungen und Stimmen unwiderruflich löschen?">
                {hidden}
                <button type="submit" className={buttonClass('danger')}>Löschen</button>
              </ConfirmForm>
            )}
          </div>
        </Card>
      </div>
    </Main>
  )
}
