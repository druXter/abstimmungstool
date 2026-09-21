// app/page.tsx
import Link from 'next/link'
import InstallHint from './ui/install-hint'

export default function Home() {
  return (
    <main className="min-h-[70vh] bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-xl text-center space-y-6">
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 tracking-tight">
          Abstimmungstool
        </h1>
        <p className="text-lg text-gray-600">
          Einfache, anonyme Abstimmungen für die Gruppe - z.B. um gemeinsam ein Restaurant
          für den nächsten Termin auszuwählen. Zum Abstimmen brauchst du kein Konto, nur zum
          Anlegen und Verwalten eigener Abstimmungen.
        </p>
        <div className="pt-4">
          <Link
            href="/erstellen"
            className="inline-block bg-blue-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-blue-700 transition shadow-lg"
          >
            Neue Abstimmung erstellen
          </Link>
        </div>
        <p className="text-sm text-gray-400">
          Zu einer Abstimmung eingeladen? Nutze einfach den Link, den du bekommen hast.
        </p>
        <InstallHint />
      </div>
    </main>
  )
}
