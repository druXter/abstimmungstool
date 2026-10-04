import { joinLive } from '../live-actions'
import Notice from '../ui/notice'
import SubmitButton from '../ui/submit-button'

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
    <main className="bg-gray-50 flex items-center justify-center px-4 py-12">
      <form action={joinLive} className="max-w-sm w-full bg-white p-8 rounded-lg shadow space-y-4 text-gray-900">
        <h1 className="text-2xl font-bold">Live-Runde beitreten</h1>
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          <label htmlFor="live-pin" className="block text-sm font-medium mb-1">PIN</label>
          <input
            id="live-pin" name="pin" required inputMode="numeric" autoComplete="off" pattern="[0-9 ]{6,7}" maxLength={7}
            defaultValue={pin?.replace(/\D/g, '').slice(0, 6)} placeholder="123 456"
            className="w-full border border-gray-300 p-3 rounded text-2xl tracking-widest text-center"
          />
        </div>
        <div>
          <label htmlFor="live-name" className="block text-sm font-medium mb-1">Spitzname</label>
          <input
            id="live-name" name="nickname" required maxLength={24} autoComplete="nickname" defaultValue={name}
            className="w-full border border-gray-300 p-2 rounded"
          />
          <p className="text-xs text-gray-500 mt-1">Erscheint auf der Leinwand und in der Rangliste. Kein Konto nötig.</p>
        </div>
        <SubmitButton>Los geht&apos;s</SubmitButton>
      </form>
    </main>
  )
}
