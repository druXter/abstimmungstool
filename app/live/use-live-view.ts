'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveView } from '../lib/live'

export type LiveStatus = 'ok' | 'gone' | 'offline'

/**
 * Hält eine Live-Ansicht aktuell: fragt per Long-Polling (app/api/live/[id]/route.ts) mit dem
 * zuletzt gesehenen Fingerabdruck nach - der Server antwortet erst, wenn sich etwas ändert.
 * `refresh()` bricht die laufende Anfrage ab und fragt sofort neu (nach einer eigenen Aktion).
 * `offset` gleicht die Geräteuhr an die Serveruhr an (für den Countdown). Die erste Anfrage geht
 * ohne Fingerabdruck raus und kommt sofort zurück - die vorgerenderte Ansicht ist zum Zeitpunkt
 * der Hydrierung schon älter, ihre Serverzeit taugt nicht zum Abgleich.
 */
export function useLiveView(sessionId: string, asHost: boolean, initial: LiveView) {
  const [view, setView] = useState(initial)
  const [status, setStatus] = useState<LiveStatus>('ok')
  const [offset, setOffset] = useState(0)
  const sigRef = useRef('')
  const controllerRef = useRef<AbortController | null>(null)
  const [kick, setKick] = useState(0)

  useEffect(() => {
    let stopped = false
    let failures = 0

    async function loop() {
      while (!stopped) {
        const controller = new AbortController()
        controllerRef.current = controller
        const params = new URLSearchParams({ sig: sigRef.current })
        if (asHost) params.set('as', 'host')
        try {
          const res = await fetch(`/api/live/${sessionId}?${params}`, { cache: 'no-store', signal: controller.signal })
          if (res.status === 404 || res.status === 410) {
            setStatus('gone')
            return
          }
          if (!res.ok) throw new Error(String(res.status))
          const next = (await res.json()) as LiveView
          failures = 0
          setStatus('ok')
          setOffset(next.now - Date.now())
          if (next.sig !== sigRef.current) {
            sigRef.current = next.sig
            setView(current => (current.sig === next.sig ? current : next))
          }
        } catch {
          if (stopped) return
          if (controller.signal.aborted) continue // refresh()
          failures++
          setStatus('offline')
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * failures, 5000)))
        }
      }
    }

    loop()
    return () => {
      stopped = true
      controllerRef.current?.abort()
    }
  }, [sessionId, asHost, kick])

  const refresh = useCallback(() => {
    sigRef.current = ''
    if (controllerRef.current) controllerRef.current.abort()
    else setKick(k => k + 1)
  }, [])

  return { view, status, offset, refresh }
}

/** Verbleibende Sekunden bis `endsAt` (Serverzeit), aktualisiert sich selbst. null ohne Zeitlimit. */
export function useCountdown(endsAt: number | null, offset: number): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (endsAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [endsAt])
  if (endsAt === null) return null
  return Math.max(0, Math.ceil((endsAt - (now + offset)) / 1000))
}
