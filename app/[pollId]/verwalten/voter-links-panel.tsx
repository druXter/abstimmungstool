// app/[pollId]/verwalten/voter-links-panel.tsx
'use client'

import { useActionState } from 'react'
import { manageVoterLinks, type VoterLinkState } from '../../voter-link-actions'
import CopyableField from '../../ui/copyable-field'
import Notice from '../../ui/notice'
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
    <div className="bg-white p-6 rounded-lg shadow space-y-4">
      <h2 className="font-bold text-gray-900">Persönliche Stimmlinks</h2>
      <p className="text-sm text-gray-600">
        Jede Person bekommt ihren eigenen Link und kann damit genau einmal abstimmen (und ihre Auswahl ändern).
        {secretBallot
          ? ' Geheime Wahl: Gespeichert wird nur, wer abgestimmt hat - nicht, wofür. Ehrliche Grenze: Wer die Links verteilt, könnte mit einem Link nachsehen, wie diese Person gestimmt hat.'
          : ' Du siehst bei jeder Stimme, von welchem Link sie kommt.'}
      </p>

      {state.message && <Notice tone={state.error ? 'error' : 'success'}>{state.message}</Notice>}

      {state.issued.length > 0 && (
        <div className="rounded border border-blue-200 bg-blue-50 p-4 space-y-3">
          <p className="text-sm font-medium text-blue-900">
            Diese Links werden nur jetzt angezeigt - bitte gleich verteilen. Später geht nur noch &quot;neu ausstellen&quot;.
          </p>
          {state.issued.length > 1 && (
            <div>
              <label htmlFor="all-links" className="block text-xs text-gray-600 mb-1">Alle auf einmal (zum Kopieren)</label>
              <textarea
                id="all-links" readOnly rows={Math.min(state.issued.length, 8)}
                value={state.issued.map(l => `${l.label}: ${l.url}`).join('\n')}
                className="w-full bg-white border border-gray-200 rounded p-2 text-xs text-gray-700"
                onClick={e => e.currentTarget.select()}
              />
            </div>
          )}
          <ul className="space-y-3">
            {state.issued.map(link => (
              <li key={link.url} className="space-y-1">
                <CopyableField label={`${link.label}${link.mailed ? ' (per Mail verschickt)' : ''}`} value={link.url} />
                <details className="text-xs text-gray-600">
                  <summary className="cursor-pointer">QR-Code</summary>
                  <div className="mt-2"><QrCode value={link.url} label={`QR-Code für ${link.label}`} /></div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={action} className="space-y-3 border-t border-gray-100 pt-4">
        {hidden}
        <input type="hidden" name="intent" value="create" />
        <div>
          <label htmlFor="link-names" className="block text-sm font-medium mb-1">Namensliste (eine Person pro Zeile)</label>
          <textarea
            id="link-names" name="names" rows={4}
            placeholder={'Anna\nBen <ben@example.org>\nCem; cem@example.org'}
            className="w-full border border-gray-300 p-2 rounded text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">Optional mit E-Mail-Adresse. Statt Namen geht auch nur eine Anzahl:</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="link-count" className="text-sm">Anzahl ohne Namen</label>
          <input id="link-count" name="count" type="number" min={1} max={200} className="w-24 border border-gray-300 p-2 rounded text-sm" />
        </div>
        {mailConfigured && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="sendMail" defaultChecked className="w-4 h-4" />
            Links an eingetragene E-Mail-Adressen direkt verschicken
          </label>
        )}
        <button type="submit" disabled={pending} className="bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-50">
          {pending ? 'Wird ausgestellt …' : 'Links ausstellen'}
        </button>
      </form>

      {links.length > 0 && (
        <div className="border-t border-gray-100 pt-4 space-y-2">
          <h3 className="text-sm font-bold text-gray-900">
            Beteiligung: {voted.length} von {links.length} {links.length === 1 ? 'hat' : 'haben'} abgestimmt
          </h3>
          <ul className="divide-y text-sm border rounded">
            {links.map(link => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <span className="min-w-0 truncate">
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${link.hasVoted ? 'bg-green-500' : 'bg-gray-300'}`} aria-hidden />
                  {link.label}
                  {link.email && link.email !== link.label && <span className="text-gray-400"> · {link.email}</span>}
                  <span className="sr-only">{link.hasVoted ? ' (hat abgestimmt)' : ' (fehlt noch)'}</span>
                </span>
                <span className="flex items-center gap-3 text-xs">
                  <span className={link.hasVoted ? 'text-green-700' : 'text-gray-500'}>{link.hasVoted ? 'abgestimmt' : 'fehlt noch'}</span>
                  <form action={action}>
                    {hidden}
                    <input type="hidden" name="intent" value="reissue" />
                    <input type="hidden" name="linkId" value={link.id} />
                    {mailConfigured && link.email && <input type="hidden" name="sendMail" value="on" />}
                    <button type="submit" disabled={pending} className="text-blue-700 hover:underline" aria-label={`Link für ${link.label} neu ausstellen`}>
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
                    <button type="submit" disabled={pending} className="text-red-700 hover:underline" aria-label={`Link für ${link.label} widerrufen`}>
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
