import { hintClass, Notice, SubmitButton } from '../ui/kit'
import { joinLive } from '../live-actions'

export const dynamic = 'force-dynamic'

// Rückmeldungen von joinLive (?fehler=...). Nur feste Texte.
const ERRORS: Record<string, string> = {
  pin: 'Zu dieser PIN läuft gerade keine Live-Runde. Bitte prüfe die Zahl auf der Leinwand.',
  gesperrt: 'Zu viele falsche PINs von deinem Netzwerk aus. Bitte warte eine Viertelstunde.',
  zu: 'Der Beitritt zu dieser Runde ist gerade gesperrt.',
  name: 'Bitte gib einen Spitznamen ein.',
  vergeben: 'Diesen Spitznamen hat schon jemand in dieser Runde - bitte wähle einen anderen.',
  viele: 'Von deinem Netzwerk aus sind schon sehr viele beigetreten. Bitte versuche es später erneut.',
  voll: 'Diese Runde ist voll.'
}

/** Beitritt zu einer Live-Runde: PIN von der Leinwand (oder per QR-Code vorausgefüllt) und Spitzname. */
export default async function LiveJoinPage({ searchParams }: { searchParams: Promise<{ pin?: string; name?: string; fehler?: string }> }) {
  const { pin, name, fehler } = await searchParams
  const error = fehler && Object.hasOwn(ERRORS, fehler) ? ERRORS[fehler] : null

  return (
    <main className="bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 py-12">
      <form action={joinLive} className="max-w-sm w-full bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4 text-gray-900 dark:text-gray-100">
        <h1 className="text-2xl font-semibold">Live-Runde beitreten</h1>
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          <label htmlFor="live-pin" className="block text-sm font-medium mb-1">PIN</label>
          <input
            id="live-pin" name="pin" required inputMode="numeric" autoComplete="off" pattern="[0-9 ]{6,7}" maxLength={7}
            defaultValue={pin?.replace(/\D/g, '').slice(0, 6)} placeholder="123 456"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900 text-2xl tracking-widest text-center"
          />
        </div>
        <div>
          <label htmlFor="live-name" className="block text-sm font-medium mb-1">Spitzname</label>
          <input
            id="live-name" name="nickname" required maxLength={24} autoComplete="nickname" defaultValue={name}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900"
          />
          <p className={hintClass}>Erscheint auf der Leinwand und in der Rangliste. Kein Konto nötig.</p>
        </div>
        <SubmitButton>Los geht&apos;s</SubmitButton>
      </form>
    </main>
  )
}
