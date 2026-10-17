// app/konto/page.tsx
import { prisma } from '../lib/prisma'
import { requireUser } from '../lib/auth'
import { MIN_PASSWORD_LENGTH } from '../lib/password'
import { getIdps, idpLabel } from '../lib/suite'
import { changePassword, unlinkIdentity } from '../auth-actions'
import { Main, PageHeader, SubmitButton, Notice, ConfirmForm } from '../ui/kit'
import { vapidPublicKey } from '../lib/push'
import PushToggle from './push-toggle'

export const dynamic = 'force-dynamic'

const ROLE_LABELS = { ADMIN: 'Administrator', CREATOR: 'Creator', MODERATOR: 'Moderator' } as const

const ERRORS: Record<string, string> = {
  wrongpassword: 'Das aktuelle Passwort ist falsch.',
  mismatch: 'Die beiden neuen Passwörter stimmen nicht überein.',
  weak: `Das neue Passwort ist zu schwach: mindestens ${MIN_PASSWORD_LENGTH} Zeichen, nicht zu naheliegend und nicht deine E-Mail-Adresse.`,
  locked: 'Zu viele Fehlversuche. Bitte warte etwa 15 Minuten.',
  nopassword: 'Für dieses Konto ist kein Passwort hinterlegt - die Anmeldung läuft über ein anderes Tool.',
  lastlogin: 'Das ist deine einzige Anmeldemöglichkeit. Lege erst ein Passwort fest, bevor du sie entfernst.',
  nochain: 'Dieses Konto wird über ein anderes Tool angemeldet und kann hier keine Anmeldung für weitere Tools bestätigen.',
  // Vom Verknüpfen mit einem anderen Tool (app/api/suite/login und callback im Modus link).
  'linked-other': 'Dieses Konto des anderen Tools ist bereits mit einem anderen Konto hier verknüpft.',
  'idp-unreachable': 'Das andere Tool ist gerade nicht erreichbar. Bitte versuche es später erneut.',
  sso: 'Die Verknüpfung mit dem anderen Tool ist fehlgeschlagen. Bitte versuche es erneut.'
}
// Unbekannte Codes: allgemeine Meldung, nie der Code selbst (sonst ließe sich per Link Text einschleusen).
const FALLBACK_ERROR = 'Das hat nicht geklappt. Bitte versuche es erneut.'

export default async function KontoPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; passwordChanged?: string; linked?: string; unlinked?: string }>
}) {
  const user = await requireUser('/konto')
  const { error, passwordChanged, linked, unlinked } = await searchParams

  const identities = await prisma.externalIdentity.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' }
  })
  const linkable = getIdps().filter(idp => !identities.some(i => i.issuer === idp.issuer))
  const pushKey = vapidPublicKey()

  return (
    <Main width="narrow">
      <PageHeader title="Mein Konto" />
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-3">
          {passwordChanged === '1' && <Notice tone="success">Passwort geändert. Andere Geräte wurden abgemeldet.</Notice>}
          {linked === '1' && <Notice tone="success">Konto verknüpft.</Notice>}
          {unlinked === '1' && <Notice tone="success">Verknüpfung entfernt.</Notice>}
          {error && <Notice tone="error">{Object.hasOwn(ERRORS, error) ? ERRORS[error] : FALLBACK_ERROR}</Notice>}

          <dl className="text-sm grid grid-cols-[8rem_1fr] gap-y-1">
            <dt className="text-gray-500 dark:text-gray-400">E-Mail</dt>
            <dd>{user.email}</dd>
            {user.name && (<><dt className="text-gray-500 dark:text-gray-400">Name</dt><dd>{user.name}</dd></>)}
            <dt className="text-gray-500 dark:text-gray-400">Rolle</dt>
            <dd>{ROLE_LABELS[user.role]}</dd>
          </dl>
        </div>

        {user.hasPassword && (
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-3">
            <h2 className="font-semibold">Passwort ändern</h2>
            <form action={changePassword} className="space-y-3">
              <div>
                <label htmlFor="currentPassword" className="block text-sm font-medium mb-1">Aktuelles Passwort</label>
                <input
                  id="currentPassword" type="password" name="currentPassword" required autoComplete="current-password"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900"
                />
              </div>
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium mb-1">Neues Passwort</label>
                <input
                  id="newPassword" type="password" name="newPassword" required minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password" className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900"
                />
              </div>
              <div>
                <label htmlFor="newPasswordConfirm" className="block text-sm font-medium mb-1">Neues Passwort wiederholen</label>
                <input
                  id="newPasswordConfirm" type="password" name="newPasswordConfirm" required minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password" className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900"
                />
              </div>
              <SubmitButton inline>Passwort ändern</SubmitButton>
            </form>
          </div>
        )}

        {(identities.length > 0 || linkable.length > 0) && (
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-3">
            <h2 className="font-semibold">Verknüpfte Konten anderer Tools</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Damit meldest du dich hier ohne separates Passwort an. Dein Passwort dort erfährt dieses Tool nie.
            </p>

            {identities.map(identity => (
              <div key={identity.id} className="flex items-center justify-between gap-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                <span>{new URL(identity.issuer).host}</span>
                <ConfirmForm action={unlinkIdentity} message="Verknüpfung wirklich entfernen?">
                  <input type="hidden" name="identityId" value={identity.id} />
                  <button type="submit" className="text-red-700 dark:text-red-300 hover:underline">Entfernen</button>
                </ConfirmForm>
              </div>
            ))}

            {linkable.map(idp => (
              <a
                key={idp.issuer}
                href={`/api/suite/login?mode=link&idp=${encodeURIComponent(idp.issuer)}&next=${encodeURIComponent('/konto')}`}
                className="block rounded-lg border border-gray-300 bg-white py-2 text-center text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
              >
                Mit {idpLabel(idp)} verknüpfen
              </a>
            ))}
          </div>
        )}

        {pushKey && (
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-3">
            <h2 className="font-semibold">Mitteilungen</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Push-Mitteilung auf diesem Gerät, wenn eine deiner Abstimmungen endet (bei &quot;Ergebnis beim Schließen
              mitteilen&quot;). Gilt nur, solange du hier angemeldet bist.
            </p>
            <PushToggle publicKey={pushKey} />
          </div>
        )}
      </div>
    </Main>
  )
}
