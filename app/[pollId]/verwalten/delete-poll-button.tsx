// app/[pollId]/verwalten/delete-poll-button.tsx
'use client'

import { deletePoll } from '../../actions'

/**
 * `creatorToken` nur bei Alt-Abstimmungen ohne Besitzer-Konto (siehe app/lib/permissions.ts) -
 * bei Abstimmungen mit Konto kommt die Berechtigung aus der Sitzung, nicht aus dem Formular.
 */
export default function DeletePollButton({ pollId, creatorToken }: { pollId: string; creatorToken?: string }) {
  return (
    <form
      action={deletePoll}
      onSubmit={(e) => {
        if (!confirm('Abstimmung inklusive aller Stimmen unwiderruflich löschen?')) {
          e.preventDefault()
        }
      }}
    >
      <input type="hidden" name="pollId" value={pollId} />
      {creatorToken && <input type="hidden" name="creatorToken" value={creatorToken} />}
      <button
        type="submit"
        className="rounded-lg border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-800 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-red-950"
      >
        Abstimmung löschen
      </button>
    </form>
  )
}
