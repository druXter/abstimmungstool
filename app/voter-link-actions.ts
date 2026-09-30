// app/voter-link-actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from './lib/prisma'
import { formString } from './lib/form'
import { loadManageablePoll } from './lib/manage'
import { isMailConfigured, sendVoterLinkEmail } from './lib/mail'
import { voterKey } from './lib/voter-identity'
import { issueLinkToken, MAX_LINKS_PER_POLL, parseLinkList, voterLinkUrl } from './lib/voter-links'

export type IssuedLink = { label: string; url: string; mailed: boolean }
export type VoterLinkState = { issued: IssuedLink[]; message: string | null; error: boolean }

const MAX_LINKS_PER_REQUEST = 200

/**
 * Stimmlinks einer Abstimmung verwalten (Modus LINK, siehe app/lib/voter-links.ts) - eine
 * Action für alle Knöpfe des Bereichs, unterschieden per `intent`:
 * - create:  Links für eine Namensliste oder eine Anzahl ausstellen
 * - reissue: neuen Token für einen Link (der alte wird ungültig, die Stimme bleibt)
 * - revoke:  Link samt seiner Stimme entfernen
 *
 * Für useActionState gebaut (app/[pollId]/verwalten/voter-links-panel.tsx): Die frisch
 * ausgestellten Links kommen NUR im Rückgabewert zurück und werden nirgends gespeichert -
 * die Datenbank kennt nur ihre Hashes. Owner, Admin und Moderator:innen mit Freigabe.
 */
export async function manageVoterLinks(_prev: VoterLinkState, formData: FormData): Promise<VoterLinkState> {
  const ctx = await loadManageablePoll(formData, 'moderator')
  if (!ctx) return { issued: [], message: 'Keine Berechtigung.', error: true }
  const { poll } = ctx
  const intent = formString(formData, 'intent', 20)
  const sendMail = formData.get('sendMail') === 'on' && isMailConfigured()

  const result = await (async (): Promise<VoterLinkState> => {
    if (intent === 'create') {
      const count = Number.parseInt(formString(formData, 'count', 5), 10)
      const listed = parseLinkList(formString(formData, 'names', 20_000))
      const existing = await prisma.voterLink.count({ where: { pollId: poll.id } })
      const entries = listed.length > 0
        ? listed
        : Number.isInteger(count) && count > 0
          ? Array.from({ length: Math.min(count, MAX_LINKS_PER_REQUEST) }, (_, i) => ({ label: `Link ${existing + i + 1}`, email: null }))
          : []
      if (entries.length === 0) return { issued: [], message: 'Bitte Namen eintragen oder eine Anzahl angeben.', error: true }
      if (entries.length > MAX_LINKS_PER_REQUEST) return { issued: [], message: `Höchstens ${MAX_LINKS_PER_REQUEST} Links auf einmal.`, error: true }
      if (existing + entries.length > MAX_LINKS_PER_POLL) return { issued: [], message: `Höchstens ${MAX_LINKS_PER_POLL} Links pro Abstimmung.`, error: true }

      const issued: IssuedLink[] = []
      for (const entry of entries) {
        const { token, tokenHash } = issueLinkToken()
        await prisma.voterLink.create({ data: { pollId: poll.id, tokenHash, label: entry.label, email: entry.email } })
        const url = voterLinkUrl(poll.id, token)
        const mailed = sendMail && entry.email ? await sendVoterLinkEmail(entry.email, poll.title, url) : false
        issued.push({ label: entry.label, url, mailed })
      }
      return { issued, message: `${issued.length} Link${issued.length === 1 ? '' : 's'} ausgestellt.`, error: false }
    }

    const link = await prisma.voterLink.findUnique({ where: { id: formString(formData, 'linkId', 50) } })
    if (!link || link.pollId !== poll.id) return { issued: [], message: 'Diesen Link gibt es nicht mehr.', error: true }

    if (intent === 'reissue') {
      const { token, tokenHash } = issueLinkToken()
      await prisma.voterLink.update({ where: { id: link.id }, data: { tokenHash } })
      const url = voterLinkUrl(poll.id, token)
      const mailed = sendMail && link.email ? await sendVoterLinkEmail(link.email, poll.title, url) : false
      return { issued: [{ label: link.label, url, mailed }], message: `Neuer Link für ${link.label} - der bisherige gilt nicht mehr.`, error: false }
    }

    if (intent === 'revoke') {
      const closed = !!poll.closedAt || (poll.closesAt !== null && poll.closesAt < new Date())
      if (link.hasVoted && closed) return { issued: [], message: 'Die Abstimmung ist beendet - Links mit abgegebener Stimme bleiben, damit sich das Ergebnis nicht nachträglich ändert.', error: true }
      // Bei geheimer Wahl ist die Stimme keinem Link zuzuordnen, also auch nicht zu entfernen.
      if (link.hasVoted && poll.secretBallot) return { issued: [], message: 'Bei geheimer Wahl lässt sich eine abgegebene Stimme keinem Link zuordnen - dieser Link kann daher nicht mehr widerrufen werden.', error: true }
      await prisma.$transaction([
        prisma.vote.deleteMany({ where: { pollId: poll.id, voterKey: voterKey('LINK', link.id) } }),
        prisma.voterLink.delete({ where: { id: link.id } })
      ])
      return { issued: [], message: `Link für ${link.label} widerrufen.`, error: false }
    }

    return { issued: [], message: null, error: false }
  })()

  revalidatePath(`/${poll.id}/verwalten`)
  revalidatePath(`/${poll.id}`)
  return result
}
