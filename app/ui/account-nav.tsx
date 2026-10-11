// app/ui/account-nav.tsx
import Link from 'next/link'
import { getCurrentUser } from '../lib/auth'
import { logoutUser } from '../auth-actions'
import NavLink from './nav-link'
import AccountMenu from './account-menu'

const ROLE_LABELS = { ADMIN: 'Administrator', CREATOR: 'Creator', MODERATOR: 'Moderator' } as const

/**
 * Kopfzeile aller Seiten (docs/KONZEPT-OBERFLAECHE.md), aufgebaut wie die Verwaltung von rsvp-app: Marke, für
 * angemeldete Konten die Navigation (Abstimmungen, bei Creator/Admin Konten) und das Konto-Menü (Mein Konto,
 * Abmelden), sonst nur "Anmelden". Beim Drucken ausgeblendet.
 *
 * Nur Anzeige: Sie entscheidet nichts über Zugriffe (das tun die Seiten und Server Actions selbst, siehe
 * app/lib/permissions.ts) - ein Layout wird bei der Navigation nicht neu geprüft und darf deshalb keine
 * Schutzfunktion haben.
 */
export default async function AccountNav() {
  const user = await getCurrentUser()
  const menuItem = 'block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 print:hidden">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
        <Link href={user ? '/meine-abstimmungen' : '/'} className="mr-2 flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-sm text-white">A</span>
          <span className="hidden sm:inline">Abstimmungstool</span>
        </Link>
        {user ? (
          <>
            <nav className="flex items-center gap-1" aria-label="Hauptnavigation">
              <NavLink href="/meine-abstimmungen" match={['/meine-abstimmungen', '/erstellen', '/live/neu']}>Abstimmungen</NavLink>
              {user.role !== 'MODERATOR' && <NavLink href="/nutzer">Konten</NavLink>}
            </nav>
            <AccountMenu
              summary={<>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-200">{(user.name || user.email).slice(0, 1)}</span>
                <span className="hidden max-w-48 truncate md:inline">{user.name || user.email}</span>
                <span aria-hidden className="text-gray-400">▾</span>
              </>}
            >
              <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{user.email}<br />{ROLE_LABELS[user.role]}</p>
              <Link href="/konto" className={menuItem}>Mein Konto</Link>
              <form action={logoutUser} className="border-t border-gray-100 pt-1 dark:border-gray-700">
                <button type="submit" className={menuItem}>Abmelden</button>
              </form>
            </AccountMenu>
          </>
        ) : (
          <Link href="/anmelden" className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">Anmelden</Link>
        )}
      </div>
    </header>
  )
}
