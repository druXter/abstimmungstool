// app/ui/account-nav.tsx
import Link from 'next/link'
import { getCurrentUser } from '../lib/auth'
import { logoutUser } from '../auth-actions'

/**
 * Konto-Leiste im Seitenkopf. Nur Anzeige: Sie entscheidet nichts über Zugriffe (das
 * tun die Seiten und Server Actions selbst, siehe app/lib/permissions.ts) - ein Layout
 * wird bei der Navigation nicht neu geprüft und darf deshalb keine Schutzfunktion haben.
 */
export default async function AccountNav() {
  const user = await getCurrentUser()

  return (
    <nav className="max-w-4xl mx-auto flex items-center justify-end gap-4 px-4 py-3 text-sm text-gray-600">
      {user ? (
        <>
          <Link href="/meine-abstimmungen" className="hover:text-gray-900">Meine Abstimmungen</Link>
          {user.role !== 'MODERATOR' && <Link href="/nutzer" className="hover:text-gray-900">Nutzer</Link>}
          <Link href="/konto" className="hover:text-gray-900">{user.name || user.email}</Link>
          <form action={logoutUser}>
            <button type="submit" className="text-gray-500 hover:text-gray-900">Abmelden</button>
          </form>
        </>
      ) : (
        <Link href="/anmelden" className="hover:text-gray-900">Anmelden</Link>
      )}
    </nav>
  )
}
