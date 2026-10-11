// app/anmelden/weiter/page.tsx
import HardRedirect from './hard-redirect'

export const dynamic = 'force-dynamic'

/**
 * Zwischenstation nach einem Login, der mit einem Föderations-Ablauf weitergehen soll
 * (siehe loginUser in app/auth-actions.ts). Erlaubt ausschließlich das Fortsetzen des
 * Anbieter-Endpunkts dieses Tools - jedes andere Ziel fällt auf die Startseite zurück,
 * damit diese Seite kein Weg für Weiterleitungen an beliebige Adressen wird.
 */
export default async function WeiterPage({
  searchParams
}: {
  searchParams: Promise<{ to?: string }>
}) {
  const { to } = await searchParams
  const target = to && to.startsWith('/api/suite/authorize?') && !to.startsWith('//') ? to : '/meine-abstimmungen'

  return (
    <main className="bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm text-gray-900 dark:text-gray-100">
        <HardRedirect to={target} />
      </div>
    </main>
  )
}
