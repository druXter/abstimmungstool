import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge, ButtonLink, Main, Tabs } from '../../ui/kit'

const PHASE_LABELS = { LOBBY: 'Lobby', QUESTION: 'läuft', REVEAL: 'läuft', LEADERBOARD: 'läuft', FINISHED: 'beendet' } as const

type FrameSession = {
  id: string
  title: string
  phase: keyof typeof PHASE_LABELS
  owner: { email: string; name: string | null }
}

/**
 * Rahmen der Verwaltung einer Live-Runde (docs/KONZEPT-OBERFLAECHE.md), aufgebaut wie der einer Abstimmung: Kopf mit
 * Titel, Stand und lila Themenmarke, rechts "Leinwand öffnen", darunter die Reiter Übersicht und - solange noch
 * niemand geantwortet hat - Fragen.
 */
export default function LiveFrame({ session, isOwner, editable, children }: { session: FrameSession; isOwner: boolean; editable: boolean; children: ReactNode }) {
  return (
    <Main>
      <div className="mb-4">
        <Link href="/meine-abstimmungen" className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">← Alle Abstimmungen</Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 break-words">{session.title}</h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={session.phase === 'FINISHED' ? 'gray' : 'purple'}>Live · {PHASE_LABELS[session.phase]}</Badge>
              {!isOwner && <Badge tone="teal">freigegeben von {session.owner.name || session.owner.email}</Badge>}
            </div>
            {!isOwner && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Du moderierst diese Live-Runde von {session.owner.name || session.owner.email}: Präsentieren, Bearbeiten, Neu starten und
                Exportieren sind erlaubt, Löschen und Teilen nicht.
              </p>
            )}
          </div>
          {session.phase !== 'FINISHED' && (
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/live/${session.id}/praesentieren`} variant="primary">Leinwand öffnen</ButtonLink>
            </div>
          )}
        </div>
      </div>
      <Tabs label="Bereiche der Live-Runde" items={[
        { href: `/live/${session.id}/verwalten`, label: 'Übersicht', exact: true },
        ...(editable ? [{ href: `/live/${session.id}/bearbeiten`, label: 'Fragen', exact: true }] : [])
      ]} />
      {children}
    </Main>
  )
}
