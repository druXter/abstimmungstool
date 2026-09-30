// app/[pollId]/verwalten/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '../../lib/prisma'
import { getCurrentUser } from '../../lib/auth'
import { canCreatePolls, getPollLevel } from '../../lib/permissions'
import { claimPoll, closePoll, duplicatePoll, reviewSuggestion, sharePoll, unsharePoll } from '../../actions'
import { baseUrl } from '../../lib/base-url'
import PollResults from '../poll-results'
import CopyableField from '../../ui/copyable-field'
import Notice from '../../ui/notice'
import SubmitButton from '../../ui/submit-button'
import DeletePollButton from './delete-poll-button'
import VoterLinksPanel from './voter-links-panel'
import QrCode from '../../ui/qr-code'
import { isMailConfigured } from '../../lib/mail'

export const dynamic = 'force-dynamic'

const SHARE_ERRORS: Record<string, string> = {
  notfound: 'Zu dieser E-Mail-Adresse gibt es kein Konto. Lade die Person zuerst ein (Nutzer) oder bitte sie, sich einmal anzumelden.',
  owner: 'Diese Person besitzt die Abstimmung bereits.'
}

export default async function VerwaltenPage({
  params,
  searchParams
}: {
  params: Promise<{ pollId: string }>
  searchParams: Promise<{ token?: string; created?: string; saved?: string; shared?: string; claimed?: string; duplicated?: string; shareError?: string }>
}) {
  const { pollId } = await params
  const { token, created, saved, shared, claimed, duplicated, shareError } = await searchParams

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      options: {
        orderBy: { position: 'asc' },
        where: { approved: true },
        include: {
          _count: { select: { votes: true } },
          votes: { select: { voterName: true } }
        }
      },
      votes: { select: { voterKey: true, voterName: true } },
      access: { select: { id: true, user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } },
      owner: { select: { email: true, name: true } },
      _count: { select: { options: { where: { approved: false } } } },
      voterLinks: { select: { id: true, label: true, email: true, hasVoted: true }, orderBy: { createdAt: 'asc' } }
    }
  })
  if (!poll) notFound()

  // Berechtigung: Konto (Owner/Admin/Freigabe) oder - nur bei Alt-Abstimmungen ohne
  // Besitzer - der creatorToken. Siehe app/lib/permissions.ts.
  const user = await getCurrentUser()
  const level = await getPollLevel(poll, { user, token })
  if (!level) {
    // Nicht eingeloggt bei einer Abstimmung MIT Konto: zur Anmeldung, danach zurück hierher.
    if (!user && poll.ownerId) redirect(`/anmelden?next=${encodeURIComponent(`/${pollId}/verwalten`)}`)
    notFound()
  }

  const isOwner = level === 'owner'
  const legacy = !poll.ownerId // Alt-Abstimmung aus der Zeit ohne Konten
  const tokenQuery = legacy && token ? `?token=${encodeURIComponent(token)}` : ''

  // Siehe app/[pollId]/page.tsx für die Begründung, warum die Prozent-Basis in
  // PollResults die Anzahl abstimmender Personen ist, nicht die Summe der Stimmen.
  const distinctVoters = new Set(poll.votes.map(v => v.voterKey)).size
  // Wer verwaltet, sieht Namen immer (sofern die Art der Stimmabgabe welche liefert) -
  // öffentlich nur mit showVoterNames.
  const hasVoterNames = poll.votes.some(v => v.voterName)
  const isClosed = !!poll.closedAt
  // Für die Ergebnis-Anzeige zählt auch ein abgelaufenes Schließdatum, das der Cron noch nicht
  // verarbeitet hat (der Schließen-Knopf bleibt dann bewusst da - er löst die Meldungen aus).
  const ended = isClosed || (poll.closesAt !== null && poll.closesAt < new Date())
  const publicLink = `${baseUrl()}/${poll.id}`

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {created === '1' && <Notice tone="success">🎉 Abstimmung erstellt! Teile den Link unten mit der Gruppe.</Notice>}
        {saved === '1' && <Notice tone="success">✅ Änderungen gespeichert.</Notice>}
        {claimed === '1' && <Notice tone="success">Die Abstimmung gehört jetzt zu deinem Konto. Alte Verwaltungs-Links sind ungültig.</Notice>}
        {shared === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}
        {duplicated === '1' && <Notice tone="success">Kopie angelegt - ohne Stimmen und ohne Schließdatum. Passe sie unter &quot;Bearbeiten&quot; an.</Notice>}

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">{poll.title}</h1>
          {!isOwner && (
            <p className="text-xs text-gray-500">
              Du moderierst diese Abstimmung{poll.owner ? ` von ${poll.owner.name || poll.owner.email}` : ''}: Bearbeiten und Schließen sind erlaubt, Löschen und Teilen nicht.
            </p>
          )}

          <CopyableField label="Link zum Teilen (zum Abstimmen)" value={publicLink} />
          <details className="text-xs text-gray-600">
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
            <CopyableField
              label="Verwaltungs-Link (nur für dich - nicht teilen!)"
              value={`${baseUrl()}/${poll.id}/verwalten?token=${token}`}
            />
          )}

          <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100">
            <Link
              href={`/${poll.id}/verwalten/bearbeiten${tokenQuery}`}
              className="text-sm bg-blue-100 text-blue-800 hover:bg-blue-200 px-3 py-1.5 rounded transition"
            >
              ✏️ Bearbeiten
            </Link>
            {!isClosed ? (
              <form action={closePoll}>
                <input type="hidden" name="pollId" value={poll.id} />
                {legacy && token && <input type="hidden" name="creatorToken" value={token} />}
                <button
                  type="submit"
                  className="text-sm bg-amber-100 text-amber-800 hover:bg-amber-200 px-3 py-1.5 rounded transition"
                >
                  🔒 Abstimmung jetzt schließen
                </button>
              </form>
            ) : (
              <span className="text-sm text-gray-500 px-1 py-1.5">Abstimmung ist geschlossen.</span>
            )}
            <a
              href={`/${poll.id}/verwalten/export${tokenQuery}`}
              className="text-sm bg-gray-100 text-gray-800 hover:bg-gray-200 px-3 py-1.5 rounded transition"
            >
              ⬇️ CSV-Export
            </a>
            {user && canCreatePolls(user) && (
              <form action={duplicatePoll}>
                <input type="hidden" name="pollId" value={poll.id} />
                {legacy && token && <input type="hidden" name="creatorToken" value={token} />}
                <button type="submit" className="text-sm bg-gray-100 text-gray-800 hover:bg-gray-200 px-3 py-1.5 rounded transition">
                  📋 Duplizieren
                </button>
              </form>
            )}
            {isOwner && <DeletePollButton pollId={poll.id} creatorToken={legacy ? token : undefined} />}
          </div>
        </div>

        {poll._count.options > 0 && <PendingSuggestions pollId={poll.id} legacyToken={legacy && token ? token : ''} />}

        {poll.voterIdentity === 'LINK' && (
          <VoterLinksPanel
            pollId={poll.id}
            legacyToken={legacy && token ? token : ''}
            links={poll.voterLinks}
            secretBallot={poll.secretBallot}
            mailConfigured={isMailConfigured()}
          />
        )}

        {legacy && user && canCreatePolls(user) && token && (
          <div className="bg-white p-6 rounded-lg shadow space-y-3">
            <h2 className="font-bold text-gray-900">Deinem Konto zuordnen</h2>
            <p className="text-sm text-gray-600">
              Diese Abstimmung wurde noch ohne Konto angelegt und ist nur über den Verwaltungs-Link erreichbar. Ordne sie
              deinem Konto zu, um sie unter &quot;Meine Abstimmungen&quot; zu finden und mit anderen zu teilen. Der alte
              Verwaltungs-Link wird dabei ungültig.
            </p>
            <form action={claimPoll}>
              <input type="hidden" name="pollId" value={poll.id} />
              <input type="hidden" name="creatorToken" value={token} />
              <SubmitButton>Meinem Konto zuordnen</SubmitButton>
            </form>
          </div>
        )}

        {legacy && !user && (
          <Notice tone="info">
            Mit einem Konto (<Link href={`/anmelden?next=${encodeURIComponent(`/${poll.id}/verwalten${tokenQuery}`)}`} className="underline">anmelden</Link>)
            kannst du diese Abstimmung dauerhaft deinem Konto zuordnen, statt dich auf den Verwaltungs-Link zu verlassen.
          </Notice>
        )}

        {isOwner && !legacy && (
          <div className="bg-white p-6 rounded-lg shadow space-y-3">
            <h2 className="font-bold text-gray-900">Gemeinsam moderieren</h2>
            <p className="text-sm text-gray-600">
              Personen mit Freigabe können die Abstimmung bearbeiten und schließen - nicht löschen oder weiter teilen.
            </p>
            {shareError && SHARE_ERRORS[shareError] && <Notice tone="error">{SHARE_ERRORS[shareError]}</Notice>}

            {poll.access.length > 0 && (
              <ul className="divide-y text-sm border rounded">
                {poll.access.map(entry => (
                  <li key={entry.id} className="flex items-center justify-between gap-2 p-2">
                    <span className="truncate">{entry.user.name ? `${entry.user.name} · ` : ''}{entry.user.email}</span>
                    <form action={unsharePoll}>
                      <input type="hidden" name="accessId" value={entry.id} />
                      <button type="submit" className="text-red-700 hover:underline text-xs">Entziehen</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <form action={sharePoll} className="flex gap-2">
              <input type="hidden" name="pollId" value={poll.id} />
              <label htmlFor="share-email" className="sr-only">E-Mail des Kontos</label>
              <input
                id="share-email" type="email" name="email" required maxLength={254}
                placeholder="E-Mail-Adresse eines bestehenden Kontos"
                className="flex-1 border border-gray-300 p-2 rounded text-sm"
              />
              <button type="submit" className="bg-blue-600 text-white text-sm font-bold px-4 rounded hover:bg-blue-700 transition">
                Freigeben
              </button>
            </form>
          </div>
        )}

        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="font-bold text-gray-900 mb-4">
            Ergebnis ({distinctVoters} Person{distinctVoters === 1 ? '' : 'en'}{poll.maxVoters !== null ? ` von höchstens ${poll.maxVoters}` : ''})
          </h2>
          <PollResults
            options={poll.options}
            distinctVoters={distinctVoters}
            showVoterNames
            quorum={poll.quorum}
            closed={ended}
          />
          {hasVoterNames && !poll.showVoterNames && (
            <p className="text-xs text-gray-400 mt-3">
              Die Namen oben siehst nur du (und wer die Abstimmung verwalten darf). Auf der öffentlichen Seite sind sie
              aktuell verborgen - &quot;Abstimmende namentlich anzeigen&quot; ist aus (siehe Bearbeiten).
            </p>
          )}
        </div>

        <p className="text-center text-xs text-gray-400">
          <Link href={`/${poll.id}`} className="hover:underline">Zur öffentlichen Abstimmungsseite</Link>
          {' · '}
          <Link href="/meine-abstimmungen" className="hover:underline">Meine Abstimmungen</Link>
        </p>
      </div>
    </main>
  )
}

/** Offene Options-Vorschläge von Teilnehmenden (Poll.allowVoterOptions) zum Freigeben oder Ablehnen. */
async function PendingSuggestions({ pollId, legacyToken }: { pollId: string; legacyToken: string }) {
  const pending = await prisma.pollOption.findMany({ where: { pollId, approved: false }, orderBy: { position: 'asc' }, select: { id: true, label: true } })
  return (
    <div className="bg-white p-6 rounded-lg shadow space-y-3">
      <h2 className="font-bold text-gray-900">Vorschläge von Teilnehmenden ({pending.length})</h2>
      <ul className="divide-y text-sm border rounded">
        {pending.map(option => (
          <li key={option.id} className="flex items-center justify-between gap-2 p-2">
            <span className="truncate">{option.label}</span>
            <form action={reviewSuggestion} className="flex gap-3 text-xs">
              <input type="hidden" name="pollId" value={pollId} />
              <input type="hidden" name="optionId" value={option.id} />
              {legacyToken && <input type="hidden" name="creatorToken" value={legacyToken} />}
              <button type="submit" name="intent" value="approve" className="text-green-700 hover:underline" aria-label={`${option.label} freigeben`}>Freigeben</button>
              <button type="submit" name="intent" value="reject" className="text-red-700 hover:underline" aria-label={`${option.label} ablehnen`}>Ablehnen</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  )
}
