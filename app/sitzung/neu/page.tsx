// app/sitzung/neu/page.tsx
import { redirect } from 'next/navigation'
import { requireUser } from '../../lib/auth'
import { canCreatePolls } from '../../lib/permissions'
import { createAssembly } from '../../assembly-actions'
import { Card, inputClass, labelClass, Main, PageHeader, SubmitButton, Notice } from '../../ui/kit'
import AssemblySettingsFields from '../settings-fields'

export const dynamic = 'force-dynamic'

/** Neue Sitzung (docs/KONZEPT-SITZUNG.md): Titel und die einzeln schaltbaren Funktionen. */
export default async function NewAssemblyPage({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  const user = await requireUser('/sitzung/neu')
  if (!canCreatePolls(user)) redirect('/erstellen')
  const { fehler } = await searchParams

  return (
    <Main width="narrow">
      <PageHeader
        title="Neue Sitzung"
        back={{ href: '/meine-abstimmungen', label: 'Alle Abstimmungen' }}
        subtitle={<>Für Mitgliederversammlung, Fachschaftsrat oder StuPa: viele kurze Abstimmungen hintereinander, auf Wunsch nur
          für Anwesende, mit Beschlussfähigkeit und Rednerliste. Mitglieder kommen über einen Termin in rsvp-app dazu.</>}
      />
      <form action={createAssembly} className="space-y-4">
        {fehler === 'titel' && <Notice tone="error">Bitte gib einen Titel ein.</Notice>}
        <Card className="space-y-4">
          <div>
            <label htmlFor="assembly-title" className={labelClass}>Titel</label>
            <input id="assembly-title" name="title" required maxLength={200} placeholder="z.B. Mitgliederversammlung 2026" className={inputClass} />
          </div>
          <AssemblySettingsFields value={{ presenceRequired: true, quorum: null, speakerList: false, secretDefault: true, selfCheckin: false }} />
        </Card>
        <div className="flex justify-end">
          <SubmitButton inline>Sitzung anlegen</SubmitButton>
        </div>
      </form>
    </Main>
  )
}
