// app/[pollId]/ballot-inputs.tsx
import type { PollType } from '@prisma/client'
import { ANSWER_VALUES, DEFAULT_POINTS_BUDGET, type Answer } from '../lib/poll-types'

const ANSWERS: { answer: Answer; label: string }[] = [
  { answer: 'yes', label: 'Ja' },
  { answer: 'maybe', label: 'Vielleicht' },
  { answer: 'no', label: 'Nein' }
]

/**
 * Die Eingabefelder des Abstimmformulars je Art (Gegenstück: parseBallot in
 * app/lib/poll-types.ts). Bewusst ohne JavaScript bedienbar: Rangfolge per Auswahlfeld
 * "Platz", Punkte per Zahlenfeld - doppelte Plätze oder ein überzogenes Budget prüft der
 * Server und meldet sich mit einem Hinweis.
 */
export default function BallotInputs({
  pollType,
  allowMultipleChoices,
  pointsBudget,
  options,
  myVotes
}: {
  pollType: PollType
  allowMultipleChoices: boolean
  pointsBudget: number | null
  options: { id: string; label: string }[]
  myVotes: Record<string, number>
}) {
  switch (pollType) {
    case 'CHOICE':
      return (
        <>
          {options.map(option => (
            <label key={option.id} className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer">
              <input
                type={allowMultipleChoices ? 'checkbox' : 'radio'}
                name="optionId"
                value={option.id}
                defaultChecked={option.id in myVotes}
                required={!allowMultipleChoices}
                className="w-4 h-4"
              />
              <span className="text-gray-800">{option.label}</span>
            </label>
          ))}
        </>
      )

    case 'YES_MAYBE_NO':
      return (
        <div className="divide-y">
          {options.map(option => (
            <fieldset key={option.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <legend className="sr-only">{option.label}</legend>
              <span className="text-gray-800" aria-hidden>{option.label}</span>
              <span className="flex gap-3 text-sm">
                {ANSWERS.map(({ answer, label }) => (
                  <label key={answer} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio" name={`answer_${option.id}`} value={answer}
                      defaultChecked={myVotes[option.id] === ANSWER_VALUES[answer]}
                      className="w-4 h-4"
                    />
                    {label}
                  </label>
                ))}
              </span>
            </fieldset>
          ))}
        </div>
      )

    case 'RANKING':
      return (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Gib deinen Favoriten Platz 1, dann Platz 2 usw. Optionen ohne Platz bekommen keine Punkte.</p>
          {options.map(option => (
            <div key={option.id} className="flex items-center justify-between gap-3">
              <label htmlFor={`rank-${option.id}`} className="text-gray-800">{option.label}</label>
              <select
                id={`rank-${option.id}`} name={`rank_${option.id}`} defaultValue={myVotes[option.id] ?? ''}
                className="border border-gray-300 p-1.5 rounded bg-white text-sm"
              >
                <option value="">–</option>
                {options.map((_, i) => <option key={i} value={i + 1}>Platz {i + 1}</option>)}
              </select>
            </div>
          ))}
        </div>
      )

    case 'POINTS': {
      const budget = pointsBudget ?? DEFAULT_POINTS_BUDGET
      return (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Verteile bis zu {budget} Punkte auf die Optionen.</p>
          {options.map(option => (
            <div key={option.id} className="flex items-center justify-between gap-3">
              <label htmlFor={`points-${option.id}`} className="text-gray-800">{option.label}</label>
              <input
                id={`points-${option.id}`} type="number" name={`points_${option.id}`} min={0} max={budget}
                defaultValue={myVotes[option.id] ?? ''} placeholder="0"
                className="w-20 border border-gray-300 p-1.5 rounded text-sm"
              />
            </div>
          ))}
        </div>
      )
    }
  }
}
