// app/ui/account-nav.tsx
import Link from 'next/link'
import { getCurrentUser } from '../lib/auth'
import { logoutUser } from '../auth-actions'
import { AppHeader, menuItemClass, menuSeparatorClass } from './kit'

const ROLE_LABELS = { ADMIN: 'Administrator*in', CREATOR: 'Creator', MODERATOR: 'Moderator*in' } as const

/**
 * Kopfzeile aller Seiten (AppHeader aus suite-kit/ui, wie in allen Tools der Suite): Marke, für
 * angemeldete Konten die Navigation (Abstimmungen, bei Creator/Admin Konten) und das Konto-Menü (Mein Konto,
 * Abmelden), sonst nur "Anmelden". Beim Drucken ausgeblendet.
 *
 * Nur Anzeige: Sie entscheidet nichts über Zugriffe (das tun die Seiten und Server Actions selbst, siehe
 * app/lib/permissions.ts) - ein Layout wird bei der Navigation nicht neu geprüft und darf deshalb keine
 * Schutzfunktion haben.
 */
export default async function AccountNav() {
  const user = await getCurrentUser()
  return (
    <AppHeader
      brand={{ letter: 'A', name: 'Abstimmungstool', href: user ? '/meine-abstimmungen' : '/' }}
      nav={user ? [
        { href: '/meine-abstimmungen', label: 'Abstimmungen', match: ['/meine-abstimmungen', '/erstellen', '/live/neu', '/fragebogen/neu'] },
        ...(user.role !== 'MODERATOR' ? [{ href: '/nutzer', label: 'Konten' }] : [])
      ] : []}
      account={user && {
        name: user.name || user.email,
        detail: <>{user.email}<br />{ROLE_LABELS[user.role]}</>,
        menu: <>
          <Link href="/konto" className={menuItemClass}>Mein Konto</Link>
          <form action={logoutUser} className={menuSeparatorClass}>
            <button type="submit" className={menuItemClass}>Abmelden</button>
          </form>
        </>
      }}
      login={{ href: '/anmelden' }}
    />
  )
}
