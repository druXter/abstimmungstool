// app/[pollId]/verwalten/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '../../lib/prisma'
import { getCurrentUser } from '../../lib/auth'
import { canCreatePolls, getPollLevel } from '../../lib/permissions'
import { claimPoll, closePoll, sharePoll, unsharePoll } from '../../actions'
import { baseUrl } from '../../lib/base-url'
import PollResults from '../poll-results'
import CopyableField from '../../ui/copyable-field'
import Notice from '../../ui/notice'
import SubmitButton from '../../ui/submit-button'
import DeletePollButton from './delete-poll-button'

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
  searchParams: Promise<{ token?: string; created?: string; saved?: string; shared?: string; claimed?: string; shareError?: string }>
}) {
  const { pollId } = await params
  const { token, created, saved, shared, claimed, shareError } = await searchParams

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      options: {
        orderBy: { position: 'asc' },
        include: {
          _count: { select: { votes: true } },
          votes: { select: { verifiedEmail: true } }
        }
      },
      votes: { select: { voterToken: true, verifiedEmail: true } },
      access: { select: { id: true, user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } },
      owner: { select: { email: true, name: true } }
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
  const distinctVoters = new Set(poll.votes.map(v => v.voterToken ?? v.verifiedEmail)).size
  const isClosed = !!poll.closedAt
  const publicLink = `${baseUrl()}/${poll.id}`

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {created === '1' && <Notice tone="success">🎉 Abstimmung erstellt! Teile den Link unten mit der Gruppe.</Notice>}
        {saved === '1' && <Notice tone="success">✅ Änderungen gespeichert.</Notice>}
        {claimed === '1' && <Notice tone="success">Die Abstimmung gehört jetzt zu deinem Konto. Alte Verwaltungs-Links sind ungültig.</Notice>}
        {shared === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}

        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">{poll.title}</h1>
          {!isOwner && (
            <p className="text-xs text-gray-500">
              Du moderierst diese Abstimmung{poll.owner ? ` von ${poll.owner.name || poll.owner.email}` : ''}: Bearbeiten und Schließen sind erlaubt, Löschen und Teilen nicht.
            </p>
          )}

          <CopyableField label="Link zum Teilen (zum Abstimmen)" value={publicLink} />
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
            {isOwner && <DeletePollButton pollId={poll.id} creatorToken={legacy ? token : undefined} />}
          </div>
        </div>

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
            Ergebnis ({distinctVoters} Person{distinctVoters === 1 ? '' : 'en'})
          </h2>
          <PollResults
            options={poll.options}
            distinctVoters={distinctVoters}
            showVoterNames={poll.requireRsvpVerification}
          />
          {poll.requireRsvpVerification && !poll.showVoterNames && (
            <p className="text-xs text-gray-400 mt-3">
              Die E-Mails oben siehst nur du (und wer die Abstimmung verwalten darf). Auf der öffentlichen Seite sind sie
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
