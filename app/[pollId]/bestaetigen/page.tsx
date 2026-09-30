// app/[pollId]/bestaetigen/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { confirmVoteEmail } from '../../actions'
import { findPendingConfirmation } from '../../lib/email-voters'
import SubmitButton from '../../ui/submit-button'
import Notice from '../../ui/notice'

export const dynamic = 'force-dynamic'

/**
 * Ziel des Bestätigungslinks im Modus EMAIL (siehe app/lib/email-voters.ts). Der Aufruf
 * allein bestätigt nichts - erst der Knopf. Mail-Scanner, die Links vorab öffnen, verbrauchen
 * den Einmal-Link so nicht.
 */
export default async function BestaetigenPage({
  params,
  searchParams
}: {
  params: Promise<{ pollId: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { pollId } = await params
  const { t } = await searchParams
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, select: { id: true, voterIdentity: true } })
  if (!poll || poll.voterIdentity !== 'EMAIL') notFound()

  const pending = await findPendingConfirmation(poll.id, t)

  return (
    <main className="bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full bg-white p-8 rounded-lg shadow space-y-4 text-gray-900">
        <h1 className="text-xl font-bold">Adresse bestätigen</h1>
        {pending ? (
          <form action={confirmVoteEmail} className="space-y-4">
            <input type="hidden" name="pollId" value={poll.id} />
            <input type="hidden" name="token" value={t} />
            <p className="text-sm text-gray-600">
              Mit <strong>{pending.email}</strong> abstimmen? Danach kannst du in diesem Browser abstimmen und deine Auswahl
              später ändern.
            </p>
            <SubmitButton>Bestätigen und zur Abstimmung</SubmitButton>
          </form>
        ) : (
          <>
            <Notice tone="error">Dieser Link ist ungültig, abgelaufen oder wurde schon benutzt.</Notice>
            <Link href={`/${poll.id}`} className="text-sm text-blue-700 hover:underline">Zur Abstimmung - dort kannst du einen neuen Link anfordern</Link>
          </>
        )}
      </div>
    </main>
  )
}
