// app/page.tsx
import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-xl text-center space-y-6">
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 tracking-tight">
          Abstimmungstool
        </h1>
        <p className="text-lg text-gray-600">
          Einfache, anonyme Abstimmungen für die Gruppe - z.B. um gemeinsam ein Restaurant
          für den nächsten Termin auszuwählen. Kein Konto nötig, weder zum Anlegen noch zum Abstimmen.
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
          Schon eine Abstimmung gestartet? Nutze den Link, den du beim Erstellen bekommen hast.
        </p>
      </div>
    </main>
  )
}
