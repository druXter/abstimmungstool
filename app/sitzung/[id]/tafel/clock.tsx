'use client'

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 1000)
  return () => clearInterval(timer)
}

/** Uhr der Tafel - erst im Browser (der Server kennt die Uhrzeit beim Anzeigen nicht), minutengenau. */
export default function Clock() {
  const minute = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 60_000), () => null)
  return (
    <p aria-label="Uhrzeit" className="shrink-0 text-[clamp(1.75rem,4vw,4.5rem)] font-bold tabular-nums leading-none">
      {minute === null ? '' : new Date(minute * 60_000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
    </p>
  )
}
