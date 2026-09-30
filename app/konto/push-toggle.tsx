// app/konto/push-toggle.tsx
'use client'

import { useEffect, useState } from 'react'
import { deletePushSubscription, savePushSubscription } from '../push-actions'

type State = 'loading' | 'unsupported' | 'denied' | 'off' | 'on' | 'error'

function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4)
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
}

async function registration() {
  // Derselbe Worker wie für die Installierbarkeit (app/ui/pwa-register.tsx) - register ist
  // idempotent; hier auch in der Entwicklung, sonst ließe sich Push nicht ausprobieren.
  return navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
}

/**
 * Push-Mitteilungen auf DIESEM Gerät an- und ausschalten (app/lib/push.ts). Ist im Browser
 * schon ein Abo vorhanden, wird es beim Öffnen der Seite erneut gespeichert - so hängt es nach
 * einer neuen Anmeldung wieder an der aktuellen Sitzung (siehe PushSubscription in schema.prisma).
 */
export default function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
      if (Notification.permission === 'denied') return 'denied'
      const subscription = await (await registration()).pushManager.getSubscription()
      if (!subscription) return 'off'
      return (await savePushSubscription(subscription.toJSON())) ? 'on' : 'off'
    })()
      .then(result => { if (active) setState(result as State) })
      .catch(() => { if (active) setState('error') })
    return () => { active = false }
  }, [])

  async function enable() {
    setState('loading')
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setState('denied')
      const reg = await registration()
      const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) })
      setState((await savePushSubscription(subscription.toJSON())) ? 'on' : 'error')
    } catch {
      setState('error')
    }
  }

  async function disable() {
    setState('loading')
    try {
      const subscription = await (await registration()).pushManager.getSubscription()
      if (subscription) {
        await deletePushSubscription(subscription.endpoint)
        await subscription.unsubscribe()
      }
      setState('off')
    } catch {
      setState('error')
    }
  }

  const button = 'text-sm px-3 py-1.5 rounded transition disabled:opacity-50'
  return (
    <div className="space-y-2 text-sm">
      {state === 'unsupported' && <p className="text-gray-600">Dieser Browser unterstützt keine Push-Mitteilungen. Auf dem iPhone/iPad gehen sie nur, wenn das Tool als App installiert ist (Safari → Teilen → &quot;Zum Home-Bildschirm&quot;).</p>}
      {state === 'denied' && <p className="text-gray-600">Mitteilungen sind für diese Seite im Browser blockiert. Du kannst sie in den Website-Einstellungen des Browsers wieder erlauben.</p>}
      {state === 'error' && <p className="text-red-700">Das hat nicht geklappt. Bitte versuche es später erneut.</p>}
      {(state === 'off' || state === 'error') && (
        <button type="button" onClick={enable} className={`${button} bg-blue-600 text-white hover:bg-blue-700`}>Mitteilungen auf diesem Gerät einschalten</button>
      )}
      {state === 'on' && (
        <>
          <p className="text-green-800">Mitteilungen sind auf diesem Gerät eingeschaltet.</p>
          <button type="button" onClick={disable} className={`${button} bg-gray-100 text-gray-800 hover:bg-gray-200`}>Ausschalten</button>
        </>
      )}
      {state === 'loading' && <p className="text-gray-500">…</p>}
    </div>
  )
}
