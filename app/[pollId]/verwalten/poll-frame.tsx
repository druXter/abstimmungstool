import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { prisma } from '../../lib/prisma'
import { getCurrentUser } from '../../lib/auth'
import { getPollLevel } from '../../lib/permissions'
import { closePoll } from '../../actions'
import { manageUrl, type ManageTab } from '../../lib/manage'
import { POLL_TYPE_LABELS } from '../../lib/poll-types'
import { IDENTITY_SHORT, pollStatus } from '../../lib/poll-status'
import { Badge, buttonClass, ButtonLink, Main, Tabs } from '../../ui/kit'

/**
 * Lädt eine Abstimmung für eine Seite der Verwaltung und prüft die Berechtigung: Konto (Owner/Admin/Freigabe)
 * oder - nur bei Alt-Abstimmungen ohne Besitzer - der creatorToken (app/lib/permissions.ts). Nicht eingeloggt bei
 * einer Abstimmung MIT Konto: zur Anmeldung, danach zurück. Sonst 404.
 */
export async function loadManagedPoll(pollId: string, token: string | undefined, tab: ManageTab) {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: { owner: { select: { email: true, name: true } } }
  })
  if (!poll) notFound()
  // Abstimmungen einer Sitzung verwaltet die Sitzung (docs/KONZEPT-SITZUNG.md)
  if (poll.assemblyId) redirect(`/sitzung/${poll.assemblyId}/verwalten`)

  const user = await getCurrentUser()
  const level = await getPollLevel(poll, { user, token })
  if (!level) {
    if (!user && poll.ownerId) redirect(`/anmelden?next=${encodeURIComponent(manageUrl(pollId, '', undefined, tab))}`)
    notFound()
  }
  // Nur Alt-Abstimmungen tragen den Token weiter (bei Abstimmungen mit Konto käme er nie aus der URL).
  const legacyToken = !poll.ownerId && token ? token : ''
  return { poll, user, level, isOwner: level === 'owner', legacy: !poll.ownerId, legacyToken }
}

type Loaded = Awaited<ReturnType<typeof loadManagedPoll>>

/**
 * Rahmen der Verwaltung einer Abstimmung (docs/KONZEPT-OBERFLAECHE.md, wie die Event-Seite in rsvp-app): Kopf mit
 * Titel, Art, Stand und Merkmalen, rechts die Abstimmungsseite und "Jetzt schließen", darunter die Reiter
 * Übersicht, Stimmlinks (nur bei persönlichen Stimmlinks) und Einstellungen.
 */
export default function PollFrame({ loaded, children }: { loaded: Loaded; children: ReactNode }) {
  const { poll, user, isOwner, legacy, legacyToken } = loaded
  const status = pollStatus(poll)
  const tabs: { tab: ManageTab; label: string }[] = [
    { tab: '', label: 'Übersicht' },
    ...(poll.voterIdentity === 'LINK' ? [{ tab: 'stimmlinks' as const, label: 'Stimmlinks' }] : []),
    { tab: 'bearbeiten', label: 'Einstellungen' }
  ]

  return (
    <Main>
      <div className="mb-4">
        {user && (
          <Link href="/meine-abstimmungen" className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">← Alle Abstimmungen</Link>
        )}
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 break-words">{poll.title}</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {POLL_TYPE_LABELS[poll.pollType].title}{poll.optionKind !== 'TEXT' ? ' über Termine' : ''} · {IDENTITY_SHORT[poll.voterIdentity]} · {status.text}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={status.tone}>{status.badge}</Badge>
              {poll.secretBallot && <Badge tone="indigo">geheime Wahl</Badge>}
              {poll.accessCode && <Badge>Zugangscode</Badge>}
              {poll.finalizedAt && <Badge tone="blue">Termin festgelegt</Badge>}
              {legacy && <Badge tone="amber">Alt-Abstimmung ohne Konto</Badge>}
              {!isOwner && poll.owner && <Badge tone="teal">freigegeben von {poll.owner.name || poll.owner.email}</Badge>}
            </div>
            {!isOwner && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Du moderierst diese Abstimmung{poll.owner ? ` von ${poll.owner.name || poll.owner.email}` : ''}: Bearbeiten und Schließen sind erlaubt, Löschen und Teilen nicht.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/${poll.id}`} external>Abstimmungsseite ↗</ButtonLink>
            {!poll.closedAt && (
              <form action={closePoll}>
                <input type="hidden" name="pollId" value={poll.id} />
                {legacyToken && <input type="hidden" name="creatorToken" value={legacyToken} />}
                <button type="submit" className={buttonClass('secondary')}>Jetzt schließen</button>
              </form>
            )}
          </div>
        </div>
      </div>
      <Tabs label="Bereiche der Abstimmung" items={tabs.map(t => ({ href: manageUrl(poll.id, legacyToken, undefined, t.tab), label: t.label, exact: true }))} />
      {children}
    </Main>
  )
}
