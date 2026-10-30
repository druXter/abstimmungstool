// app/[pollId]/verwalten/voter-links-panel.tsx
'use client'

import { CopyableField, hintClass, Notice } from '../../ui/kit'
import { useActionState } from 'react'
import { manageVoterLinks, type VoterLinkState } from '../../voter-link-actions'
import QrCode from '../../ui/qr-code'

type LinkRow = { id: string; label: string; email: string | null; hasVoted: boolean }

const INITIAL: VoterLinkState = { issued: [], message: null, error: false }

/**
 * Persönliche Stimmlinks auf der Verwaltungsseite (Modus LINK): ausstellen, neu ausstellen,
 * widerrufen, Beteiligung. Frisch ausgestellte Links gibt es NUR im Ergebnis der Action -
 * nach dem Neuladen sind sie weg (die Datenbank kennt nur Hashes), daher der deutliche Hinweis.
 */
export default function VoterLinksPanel({
  pollId,
  legacyToken,
  links,
  secretBallot,
  mailConfigured
}: {
  pollId: string
  legacyToken: string
  links: LinkRow[]
  secretBallot: boolean
  mailConfigured: boolean
}) {
  const [state, action, pending] = useActionState(manageVoterLinks, INITIAL)
  const voted = links.filter(l => l.hasVoted)
  const hidden = (
    <>
      <input type="hidden" name="pollId" value={pollId} />
      {legacyToken && <input type="hidden" name="creatorToken" value={legacyToken} />}
    </>
  )

  return (
    <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">Persönliche Stimmlinks</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Jede Person bekommt ihren eigenen Link und kann damit genau einmal abstimmen (und ihre Auswahl ändern).
        {secretBallot
          ? ' Geheime Wahl: Gespeichert wird nur, wer abgestimmt hat - nicht, wofür. Ehrliche Grenze: Wer die Links verteilt, könnte mit einem Link nachsehen, wie diese Person gestimmt hat.'
          : ' Du siehst bei jeder Stimme, von welchem Link sie kommt.'}
      </p>

      {state.message && <Notice tone={state.error ? 'error' : 'success'}>{state.message}</Notice>}

      {state.issued.length > 0 && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950 p-4 space-y-3">
          <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
            Diese Links werden nur jetzt angezeigt - bitte gleich verteilen. Später geht nur noch &quot;neu ausstellen&quot;.
          </p>
          {state.issued.length > 1 && (
            <div>
              <label htmlFor="all-links" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Alle auf einmal (zum Kopieren)</label>
              <textarea
                id="all-links" readOnly rows={Math.min(state.issued.length, 8)}
                value={state.issued.map(l => `${l.label}: ${l.url}`).join('\n')}
                className="w-full rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-2 text-xs text-gray-700 dark:text-gray-300"
                onClick={e => e.currentTarget.select()}
              />
            </div>
          )}
          <ul className="space-y-3">
            {state.issued.map(link => (
              <li key={link.url} className="space-y-1">
                <CopyableField label={`${link.label}${link.mailed ? ' (per Mail verschickt)' : ''}`} value={link.url} />
                <details className="text-xs text-gray-600 dark:text-gray-400">
                  <summary className="cursor-pointer">QR-Code</summary>
                  <div className="mt-2"><QrCode value={link.url} label={`QR-Code für ${link.label}`} /></div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={action} className="space-y-3 border-t border-gray-100 dark:border-gray-700 pt-4">
        {hidden}
        <input type="hidden" name="intent" value="create" />
        <div>
          <label htmlFor="link-names" className="block text-sm font-medium mb-1">Namensliste (eine Person pro Zeile)</label>
          <textarea
            id="link-names" name="names" rows={4}
            placeholder={'Anna\nBen <ben@example.org>\nCem; cem@example.org'}
            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900"
          />
          <p className={hintClass}>Optional mit E-Mail-Adresse. Statt Namen geht auch nur eine Anzahl:</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="link-count" className="text-sm">Anzahl ohne Namen</label>
          <input id="link-count" name="count" type="number" min={1} max={200} className="w-24 rounded-lg border border-gray-300 bg-white p-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900" />
        </div>
        {mailConfigured && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="sendMail" defaultChecked className="w-4 h-4" />
            Links an eingetragene E-Mail-Adressen direkt verschicken
          </label>
        )}
        <button type="submit" disabled={pending} className="rounded-lg border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50">
          {pending ? 'Wird ausgestellt …' : 'Links ausstellen'}
        </button>
      </form>

      {links.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Beteiligung: {voted.length} von {links.length} {links.length === 1 ? 'hat' : 'haben'} abgestimmt
          </h3>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-sm border border-gray-200 dark:border-gray-700 rounded-lg">
            {links.map(link => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${link.hasVoted ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} aria-hidden />
                  {link.label}
                  {link.email && link.email !== link.label && <span className="text-gray-500 dark:text-gray-400"> · {link.email}</span>}
                  <span className="sr-only">{link.hasVoted ? ' (hat abgestimmt)' : ' (fehlt noch)'}</span>
                </span>
                <span className="flex items-center gap-3 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${link.hasVoted ? 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>{link.hasVoted ? 'abgestimmt' : 'fehlt noch'}</span>
                  <form action={action}>
                    {hidden}
                    <input type="hidden" name="intent" value="reissue" />
                    <input type="hidden" name="linkId" value={link.id} />
                    {mailConfigured && link.email && <input type="hidden" name="sendMail" value="on" />}
                    <button type="submit" disabled={pending} className="text-blue-700 dark:text-blue-300 hover:underline" aria-label={`Link für ${link.label} neu ausstellen`}>
                      {mailConfigured && link.email ? 'Neu ausstellen & mailen' : 'Neu ausstellen'}
                    </button>
                  </form>
                  <form
                    action={action}
                    onSubmit={e => {
                      const warning = link.hasVoted ? ' Die bereits abgegebene Stimme wird dabei entfernt.' : ''
                      if (!window.confirm(`Link für ${link.label} widerrufen?${warning}`)) e.preventDefault()
                    }}
                  >
                    {hidden}
                    <input type="hidden" name="intent" value="revoke" />
                    <input type="hidden" name="linkId" value={link.id} />
                    <button type="submit" disabled={pending} className="text-red-700 dark:text-red-300 hover:underline" aria-label={`Link für ${link.label} widerrufen`}>
                      Widerrufen
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
