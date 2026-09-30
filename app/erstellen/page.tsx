// app/erstellen/page.tsx
import Link from 'next/link'
import { requireUser } from '../lib/auth'
import { canCreatePolls } from '../lib/permissions'
import { createPoll } from '../actions'
import SubmitButton from '../ui/submit-button'
import Notice from '../ui/notice'
import OptionsFieldList from './options-field-list'
import PollSettingsFields from './poll-settings-fields'

export const dynamic = 'force-dynamic'

export default async function ErstellenPage() {
  // Anlegen erfordert ein Konto: nicht eingeloggt -> Anmeldung, danach zurück hierher.
  // Die eigentliche Berechtigung prüft createPoll erneut auf dem Server.
  const user = await requireUser('/erstellen')

  if (!canCreatePolls(user)) {
    return (
      <main className="bg-gray-50 flex items-center justify-center px-4 py-12">
        <div className="max-w-sm w-full bg-white p-8 rounded-lg shadow space-y-4 text-gray-900">
          <h1 className="text-xl font-bold">Anlegen nicht möglich</h1>
          <Notice tone="warning">
            Dein Konto hat die Rolle &quot;Moderator&quot; und kann keine eigenen Abstimmungen anlegen - nur
            Abstimmungen moderieren, die dir freigegeben wurden.
          </Notice>
          <Link href="/meine-abstimmungen" className="text-sm text-blue-700 hover:underline">Zu meinen Abstimmungen</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow space-y-6 text-gray-900">
        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Neue Abstimmung</h1>
          <Link href="/" className="text-gray-500 hover:text-gray-800 transition">
            Abbrechen
          </Link>
        </div>

        <form action={createPoll} className="space-y-4">
          <div>
            <label htmlFor="poll-title" className="block text-sm font-medium mb-1">Frage / Titel</label>
            <input
              id="poll-title"
              type="text"
              name="title"
              required
              maxLength={200}
              className="w-full border border-gray-300 p-2 rounded"
              placeholder="z.B. Wohin gehen wir am Mittwoch?"
            />
          </div>

          <div>
            <label htmlFor="poll-description" className="block text-sm font-medium mb-1">Beschreibung (optional)</label>
            <textarea
              id="poll-description"
              name="description"
              rows={2}
              maxLength={200}
              className="w-full border border-gray-300 p-2 rounded"
              placeholder="Zusätzliche Infos für alle Teilnehmenden"
            ></textarea>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Optionen</label>
            <OptionsFieldList />
          </div>

          <PollSettingsFields />

          <SubmitButton>Abstimmung erstellen</SubmitButton>
        </form>
      </div>
    </main>
  )
}
