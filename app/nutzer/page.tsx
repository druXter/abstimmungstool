// app/nutzer/page.tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '../lib/prisma'
import { INVITE_LINK_COOKIE, requireUser } from '../lib/auth'
import { createUser, deleteUser, resendInvite, updateUserRole } from '../auth-actions'
import { isMailConfigured } from '../lib/mail'
import { Main, PageHeader, SubmitButton, Notice, ConfirmForm, CopyableField } from '../ui/kit'

export const dynamic = 'force-dynamic'

const ROLE_LABELS = { ADMIN: 'Administrator', CREATOR: 'Creator', MODERATOR: 'Moderator' } as const

const ERRORS: Record<string, string> = {
  email: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  exists: 'Zu dieser E-Mail-Adresse gibt es bereits ein Konto.'
}

export default async function NutzerPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; created?: string }>
}) {
  const actor = await requireUser('/nutzer')
  if (actor.role === 'MODERATOR') redirect('/konto')
  const { error, created } = await searchParams

  const isAdmin = actor.role === 'ADMIN'
  const inviteLink = created === 'link' ? (await cookies()).get(INVITE_LINK_COOKIE)?.value : undefined

  // Die Kontoliste sehen nur Admins. Creator legen hier höchstens Moderator-Konten an.
  const users = isAdmin
    ? await prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, email: true, name: true, role: true, passwordHash: true,
          _count: { select: { identities: true, ownedPolls: true } }
        }
      })
    : []

  return (
    <Main width="narrow">
      <PageHeader title={isAdmin ? 'Konten' : 'Moderator anlegen'} subtitle={isAdmin ? 'Verwaltungskonten dieses Tools' : undefined} />
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
          <h2 className="font-semibold">{isAdmin ? 'Konto anlegen und einladen' : 'Moderator-Konto einladen'}</h2>

          {created === 'mailed' && <Notice tone="success">Konto angelegt. Die Einladung wurde per E-Mail verschickt.</Notice>}
          {created === 'link' && (
            <Notice tone="warning">
              Konto angelegt. Es ist kein Mailversand eingerichtet - gib diesen Einladungslink selbst an die Person weiter.
              Er ist 7 Tage gültig, nur einmal nutzbar und wird hier nur kurz angezeigt.
              {inviteLink && <div className="mt-2"><CopyableField label="Einladungslink" value={inviteLink} /></div>}
            </Notice>
          )}
          {error && ERRORS[error] && <Notice tone="error">{ERRORS[error]}</Notice>}

          <form action={createUser} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">E-Mail</label>
              <input id="email" type="email" name="email" required maxLength={254} className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900" />
            </div>
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">Name (optional)</label>
              <input id="name" type="text" name="name" maxLength={100} className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900" />
            </div>
            {isAdmin && (
              <div>
                <label htmlFor="role" className="block text-sm font-medium mb-1">Rolle</label>
                <select id="role" name="role" defaultValue="CREATOR" className="w-full rounded-lg border border-gray-300 dark:border-gray-600 p-2 bg-white dark:bg-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900">
                  <option value="CREATOR">Creator (legt eigene Abstimmungen an)</option>
                  <option value="MODERATOR">Moderator (nur geteilte Abstimmungen)</option>
                  <option value="ADMIN">Administrator</option>
                </select>
              </div>
            )}
            <div className="sm:col-span-2">
              <SubmitButton inline>Konto anlegen und einladen</SubmitButton>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Die Person legt ihr Passwort selbst über den Einladungslink fest
                {isMailConfigured() ? ' - er geht direkt per E-Mail raus.' : ' - ohne Mailversand bekommst du den Link zum Weitergeben angezeigt.'}
              </p>
            </div>
          </form>
        </div>

        {isAdmin && (
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <h2 className="font-semibold mb-3">Alle Konten ({users.length})</h2>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
              {users.map(u => {
                const pending = !u.passwordHash && u._count.identities === 0
                const protectedAccount = u.role === 'ADMIN'
                return (
                  <li key={u.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="grow min-w-0">
                      <div className="font-medium truncate">{u.name ? `${u.name} · ` : ''}{u.email}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {ROLE_LABELS[u.role]}
                        {' · '}
                        {pending ? 'Einladung offen' : u.passwordHash ? 'Passwort' : 'Anmeldung über anderes Tool'}
                        {' · '}
                        {u._count.ownedPolls} Abstimmung{u._count.ownedPolls === 1 ? '' : 'en'}
                      </div>
                    </div>

                    {!protectedAccount && (
                      <>
                        <form action={updateUserRole} className="flex items-center gap-1">
                          <input type="hidden" name="userId" value={u.id} />
                          <select name="role" defaultValue={u.role} aria-label={`Rolle von ${u.email}`} className="border border-gray-300 dark:border-gray-600 rounded p-1 text-xs bg-white dark:bg-gray-800">
                            <option value="CREATOR">Creator</option>
                            <option value="MODERATOR">Moderator</option>
                            <option value="ADMIN">Administrator</option>
                          </select>
                          <button type="submit" className="text-xs text-blue-700 dark:text-blue-300 hover:underline">Ändern</button>
                        </form>

                        {pending && (
                          <form action={resendInvite}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button type="submit" className="text-xs text-blue-700 dark:text-blue-300 hover:underline">Einladung erneuern</button>
                          </form>
                        )}

                        <ConfirmForm
                          action={deleteUser}
                          message={`Konto ${u.email} löschen? Seine Abstimmungen gehen an dich über.`}
                        >
                          <input type="hidden" name="userId" value={u.id} />
                          <button type="submit" className="text-xs text-red-700 dark:text-red-300 hover:underline">Löschen</button>
                        </ConfirmForm>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
              Konten mit Admin-Rolle lassen sich hier nicht ändern oder löschen (Schutz vor versehentlichem Aussperren) -
              das geht nur per <code>create-user.js</code> auf dem Server.
            </p>
          </div>
        )}
      </div>
    </Main>
  )
}
