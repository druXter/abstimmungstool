// app/erstellen/page.tsx
import Link from 'next/link'
import { requireUser } from '../lib/auth'
import { canCreatePolls } from '../lib/permissions'
import { createPoll } from '../actions'
import { POLL_PRESETS, PRESET_IDS } from '../lib/poll-presets'
import SubmitButton from '../ui/submit-button'
import Notice from '../ui/notice'
import { Card, hintClass, inputClass, labelClass, Main, PageHeader } from '../ui/kit'
import NewPollFields from './new-poll-fields'

export const dynamic = 'force-dynamic'

/**
 * Neue Abstimmung (docs/KONZEPT-OBERFLAECHE.md): kurz anlegen - Frage, Optionen und eine Vorlage
 * (app/lib/poll-presets.ts) -, alle weiteren Einstellungen danach auf der Verwaltungsseite.
 */
export default async function ErstellenPage() {
  // Anlegen erfordert ein Konto: nicht eingeloggt -> Anmeldung, danach zurück hierher.
  // Die eigentliche Berechtigung prüft createPoll erneut auf dem Server.
  const user = await requireUser('/erstellen')

  if (!canCreatePolls(user)) {
    return (
      <Main width="narrow">
        <PageHeader title="Anlegen nicht möglich" back={{ href: '/meine-abstimmungen', label: 'Alle Abstimmungen' }} />
        <Notice tone="warning">
          Dein Konto hat die Rolle &quot;Moderator&quot; und kann keine eigenen Abstimmungen anlegen - nur
          Abstimmungen moderieren, die dir freigegeben wurden.
        </Notice>
      </Main>
    )
  }

  const presets = PRESET_IDS.map(id => {
    const preset = POLL_PRESETS[id]
    return { id, title: preset.title, text: preset.text, sets: preset.sets, dateOptions: 'dateOptions' in preset && preset.dateOptions }
  })

  return (
    <Main width="narrow">
      <PageHeader title="Neue Abstimmung" back={{ href: '/meine-abstimmungen', label: 'Alle Abstimmungen' }} />

      <form action={createPoll} className="space-y-6">
        <Card className="space-y-4">
          <div>
            <label htmlFor="poll-title" className={labelClass}>Frage / Titel</label>
            <input id="poll-title" type="text" name="title" required maxLength={200} className={inputClass} placeholder="z.B. Wohin gehen wir am Mittwoch?" />
          </div>
          <div>
            <label htmlFor="poll-description" className={labelClass}>Beschreibung (optional)</label>
            <textarea id="poll-description" name="description" rows={2} maxLength={200} className={inputClass} placeholder="Zusätzliche Infos für alle Teilnehmenden" />
          </div>
          <div>
            <label htmlFor="poll-closes-at" className={labelClass}>Automatisch schließen am (optional)</label>
            <input id="poll-closes-at" type="datetime-local" name="closesAt" className={`${inputClass} sm:w-64`} />
            <p className={hintClass}>Ohne Datum bleibt die Abstimmung offen, bis du sie schließt.</p>
          </div>
        </Card>

        <NewPollFields presets={presets} />

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Lieber live im Raum, Frage für Frage auf der Leinwand?{' '}
            <Link href="/live/neu" className="font-medium text-blue-700 hover:underline dark:text-blue-300">Neue Live-Runde</Link>
          </p>
          <SubmitButton inline>Abstimmung erstellen</SubmitButton>
        </div>
      </form>
    </Main>
  )
}
