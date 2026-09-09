// app/[pollId]/verwalten/delete-poll-button.tsx
'use client'

import { deletePoll } from '../../actions'

export default function DeletePollButton({ pollId, creatorToken }: { pollId: string; creatorToken: string }) {
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
      <input type="hidden" name="creatorToken" value={creatorToken} />
      <button
        type="submit"
        className="text-sm text-red-700 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded transition"
      >
        🗑️ Abstimmung löschen
      </button>
    </form>
  )
}
