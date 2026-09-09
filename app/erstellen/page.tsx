// app/erstellen/page.tsx
import Link from 'next/link'
import { isCreateAllowed } from '../lib/create-pin'
import { createPoll, verifyCreatePin } from '../actions'
import SubmitButton from '../ui/submit-button'
import OptionsFieldList from './options-field-list'

export const dynamic = 'force-dynamic'

export default async function ErstellenPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const allowed = await isCreateAllowed()

  if (!allowed) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-white p-8 rounded-lg shadow space-y-4 text-gray-900">
          <h1 className="text-xl font-bold">Zugangscode</h1>
          <p className="text-sm text-gray-600">
            Zum Anlegen einer neuen Abstimmung brauchst du den gemeinsamen Zugangscode.
          </p>
          {error && <p className="text-sm text-red-600">Falscher Code, bitte erneut versuchen.</p>}
          <form action={verifyCreatePin} className="space-y-3">
            <input
              type="password"
              name="pin"
              required
              autoFocus
              className="w-full border border-gray-300 p-2 rounded"
              placeholder="Zugangscode"
            />
            <SubmitButton>Weiter</SubmitButton>
          </form>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow space-y-6 text-gray-900">
        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">Neue Abstimmung</h1>
          <Link href="/" className="text-gray-500 hover:text-gray-800 transition">
            Abbrechen
          </Link>
        </div>

        <form action={createPoll} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Frage / Titel</label>
            <input
              type="text"
              name="title"
              required
              maxLength={200}
              className="w-full border border-gray-300 p-2 rounded"
              placeholder="z.B. Wohin gehen wir am Mittwoch?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Beschreibung (optional)</label>
            <textarea
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

          <div>
            <label className="block text-sm font-medium mb-1">Automatisch schließen am (optional)</label>
            <input type="datetime-local" name="closesAt" className="w-full border border-gray-300 p-2 rounded" />
          </div>

          <SubmitButton>Abstimmung erstellen</SubmitButton>
        </form>
      </div>
    </main>
  )
}
