// app/sitzung/live-refresh.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * Hält Sitzungsseiten aktuell (docs/KONZEPT-SITZUNG.md): fragt alle 3 Sekunden die Versionsnummer ab und lädt bei einer
 * Änderung neu (neue Abstimmung, geschlossen, Rednerliste). Zusätzlich alle `everySeconds` Sekunden ohnehin - die
 * Anwesenheit kommt aus rsvp-app und ändert die Version nicht. Nur, solange die Seite sichtbar ist.
 */
export default function LiveRefresh({ assemblyId, version, everySeconds = 15 }: { assemblyId: string; version: number; everySeconds?: number }) {
  const router = useRouter()
  const known = useRef(version)
  useEffect(() => { known.current = version }, [version])
  useEffect(() => {
    let ticks = 0
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      ticks++
      try {
        const response = await fetch(`/api/sitzung/${assemblyId}/stand`, { cache: 'no-store' })
        const { version: current } = await response.json()
        if (typeof current === 'number' && current !== known.current) {
          known.current = current
          router.refresh()
          return
        }
      } catch {
        // nächster Versuch
      }
      if (ticks * 3 >= everySeconds) {
        ticks = 0
        router.refresh()
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [assemblyId, everySeconds, router])
  return null
}
