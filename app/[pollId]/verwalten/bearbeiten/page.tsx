// app/[pollId]/verwalten/bearbeiten/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '../../../lib/prisma'
import { getCurrentUser } from '../../../lib/auth'
import { getPollLevel } from '../../../lib/permissions'
import { updatePoll } from '../../../actions'
import SubmitButton from '../../../ui/submit-button'
import OptionsFieldList from '../../../erstellen/options-field-list'

export const dynamic = 'force-dynamic'

const MAX_OPTIONS = 25 // Muss mit MAX_OPTIONS in app/actions.ts übereinstimmen

export default async function BearbeitenPage({
  params,
  searchParams
}: {
  params: Promise<{ pollId: string }>
  searchParams: Promise<{ token?: string }>
}) {
  const { pollId } = await params
  const { token } = await searchParams

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      options: {
        orderBy: { position: 'asc' },
        include: { _count: { select: { votes: true } } }
      }
    }
  })
  if (!poll) notFound()

  // Berechtigung: Konto (Owner/Admin/Freigabe) oder - nur bei Alt-Abstimmungen ohne
  // Besitzer - der creatorToken. Siehe app/lib/permissions.ts. Moderator:innen dürfen
  // bearbeiten, daher genügt jede Stufe.
  const user = await getCurrentUser()
  const level = await getPollLevel(poll, { user, token })
  if (!level) {
    if (!user && poll.ownerId) redirect(`/anmelden?next=${encodeURIComponent(`/${pollId}/verwalten/bearbeiten`)}`)
    notFound()
  }

  // Nur Alt-Abstimmungen tragen den Token weiter (bei Abstimmungen mit Konto käme er nie aus der URL).
  const legacyToken = !poll.ownerId && token ? token : ''
  const backHref = `/${poll.id}/verwalten${legacyToken ? `?token=${encodeURIComponent(legacyToken)}` : ''}`

  const d = poll.closesAt ? new Date(poll.closesAt) : null
  const pad = (n: number) => n.toString().padStart(2, '0')
  const formattedClosesAt = d
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    : ''

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow space-y-6 text-gray-900">
        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Abstimmung bearbeiten</h1>
          <Link href={backHref} className="text-gray-500 hover:text-gray-800 transition">
            Abbrechen
          </Link>
        </div>

        <form action={updatePoll} className="space-y-4">
          <input type="hidden" name="pollId" value={poll.id} />
          {legacyToken && <input type="hidden" name="creatorToken" value={legacyToken} />}

          <div>
            <label className="block text-sm font-medium mb-1">Frage / Titel</label>
            <input
              type="text"
              name="title"
              defaultValue={poll.title}
              required
              maxLength={200}
              className="w-full border border-gray-300 p-2 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Beschreibung (optional)</label>
            <textarea
              name="description"
              defaultValue={poll.description || ''}
              rows={2}
              maxLength={200}
              className="w-full border border-gray-300 p-2 rounded"
            ></textarea>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Bestehende Optionen</label>
            <div className="space-y-2">
              {poll.options.map(option => {
                const hasVotes = option._count.votes > 0
                return (
                  <div key={option.id} className="flex items-center gap-2">
                    <input type="hidden" name="existingOptionId" value={option.id} />
                    <input
                      type="text"
                      name="existingOptionLabel"
                      defaultValue={option.label}
                      maxLength={200}
                      required
                      className="flex-1 border border-gray-300 p-2 rounded"
                    />
                    {hasVotes ? (
                      <span className="text-xs text-gray-400 whitespace-nowrap" title="Optionen mit bereits abgegebenen Stimmen können nicht gelöscht werden">
                        {option._count.votes} Stimme{option._count.votes === 1 ? '' : 'n'} · gesperrt
                      </span>
                    ) : (
                      <label className="flex items-center gap-1 text-xs text-red-700 whitespace-nowrap cursor-pointer">
                        <input type="checkbox" name="deleteOptionId" value={option.id} className="w-4 h-4" />
                        entfernen
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Optionen mit bereits abgegebenen Stimmen können umbenannt, aber nicht gelöscht werden.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Weitere Optionen hinzufügen</label>
            <OptionsFieldList name="newOption" max={Math.max(MAX_OPTIONS - poll.options.length, 0)} startCount={0} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Automatisch schließen am (optional)</label>
            <input type="datetime-local" name="closesAt" defaultValue={formattedClosesAt} className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="allowMultipleChoices" defaultChecked={poll.allowMultipleChoices} className="w-4 h-4" />
            <span className="text-sm font-medium">Mehrfachauswahl erlauben (mehrere Optionen gleichzeitig wählbar)</span>
          </label>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="requireRsvpVerification" defaultChecked={poll.requireRsvpVerification} className="w-4 h-4" />
              <span className="text-sm font-medium text-amber-900">
                Nur über rsvp-app abstimmbar (max. 1 Stimme pro Person)
              </span>
            </label>
            <p className="text-xs text-amber-700">
              Ersetzt die anonyme Cookie-Identität durch eine über rsvp-app verifizierte E-Mail - dafür
              muss diese Abstimmung über einen entsprechend eingerichteten Link/Button in rsvp-app
              aufgerufen werden. Direkter, anonymer Zugriff auf diese Seite kann dann nicht abstimmen.
            </p>
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input type="checkbox" name="showVoterNames" defaultChecked={poll.showVoterNames} className="w-4 h-4" />
              <span className="text-sm font-medium text-amber-900">
                Abstimmende namentlich anzeigen (auf der öffentlichen Ergebnisseite)
              </span>
            </label>
            <p className="text-xs text-amber-700">
              Zeigt bei jeder Option zusätzlich die E-Mails der Personen, die dafür gestimmt haben -
              nur mit &quot;Nur über rsvp-app abstimmbar&quot; oben nutzbar.
            </p>
          </div>

          <SubmitButton>Änderungen speichern</SubmitButton>
        </form>
      </div>
    </main>
  )
}
