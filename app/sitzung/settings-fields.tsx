// app/sitzung/settings-fields.tsx
import { hintClass, inputClass, labelClass } from '../ui/kit'

/**
 * Die einzeln schaltbaren Funktionen einer Sitzung (docs/KONZEPT-SITZUNG.md) - beim Anlegen und in der Verwaltung.
 * Kein Gesamtschalter: jede Funktion für sich.
 */
export default function AssemblySettingsFields({ value }: { value: { presenceRequired: boolean; quorum: number | null; speakerList: boolean; secretDefault: boolean; selfCheckin: boolean } }) {
  const check = (name: string, checked: boolean, label: string, hint: string) => (
    <label className="flex items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-1 h-4 w-4" />
      <span>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
        <span className={`block ${hintClass}`}>{hint}</span>
      </span>
    </label>
  )
  return (
    <div className="space-y-4">
      {check('presenceRequired', value.presenceRequired, 'Nur Anwesende stimmen ab',
        'Abstimmen und Wortmeldungen nur, wer laut rsvp-app gerade eingecheckt ist (Termin mit QR-Einlass, am besten mit „Kommen und Gehen“). Sonst alle Mitglieder mit Zusage.')}
      {check('selfCheckin', value.selfCheckin, 'Mitglieder checken sich selbst ein und aus',
        'Knopf „Einchecken“ bzw. „Ich gehe“ in der Mitgliederansicht (Termin mit QR-Einlass). Praktisch für Sitzungen ohne Einlass oder mit Online-Teilnahme - wer sich selbst eincheckt, darf auch ohne Scan abstimmen.')}
      <div>
        <label htmlFor="assembly-quorum" className={labelClass}>Beschlussfähig ab (Anwesende, optional)</label>
        <input id="assembly-quorum" name="quorum" type="number" min={1} max={10000} defaultValue={value.quorum ?? ''} className={`${inputClass} sm:w-32`} />
        <p className={hintClass}>Zeigt live, ob die Sitzung beschlussfähig ist, und hält es bei jedem Beschluss fest. Leer = keine Anzeige.</p>
      </div>
      {check('speakerList', value.speakerList, 'Rednerliste',
        'Mitglieder melden sich auf ihrem Handy zu Wort oder mit einem GO-Antrag (kommt zuerst), die Sitzungsleitung ruft auf.')}
      {check('secretDefault', value.secretDefault, 'Neue Abstimmungen geheim',
        'Vorauswahl für neue Abstimmungen - geheim: niemand sieht, wer wie gestimmt hat; sonst namentlich. Pro Abstimmung änderbar.')}
    </div>
  )
}
