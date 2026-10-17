// app/page.tsx
import { buttonClass, ButtonLink, Card, inputClass, InstallHint } from './ui/kit'

export default function Home() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-xl w-full text-center space-y-8">
        <div className="space-y-4">
          <span aria-hidden className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-xl font-semibold text-white">A</span>
          <h1 className="text-3xl md:text-4xl font-semibold text-gray-900 dark:text-gray-100 tracking-tight">
            Abstimmungstool
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Einfache, anonyme Abstimmungen für die Gruppe - z.B. um gemeinsam ein Restaurant
            für den nächsten Termin auszuwählen. Zum Abstimmen brauchst du kein Konto, nur zum
            Anlegen und Verwalten eigener Abstimmungen.
          </p>
          <ButtonLink href="/erstellen" variant="primary">Neue Abstimmung erstellen</ButtonLink>
        </div>
        <Card className="space-y-3 text-left">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Zu einer Abstimmung eingeladen? Nutze einfach den Link, den du bekommen hast. Bei einer Live-Runde gibst du die
            PIN von der Leinwand ein:
          </p>
          <form action="/live" className="flex gap-2">
            <label htmlFor="home-pin" className="sr-only">PIN der Live-Runde</label>
            <input
              id="home-pin" name="pin" inputMode="numeric" maxLength={7} placeholder="PIN der Live-Runde"
              className={`${inputClass} min-w-0 text-center tracking-widest`}
            />
            <button type="submit" className={buttonClass('primary')}>Beitreten</button>
          </form>
        </Card>
        <InstallHint />
      </div>
    </main>
  )
}
