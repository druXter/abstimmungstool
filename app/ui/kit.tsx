// app/ui/kit.tsx
//
// Bausteine der Oberfläche: die gemeinsamen aus suite-kit/ui (Gestaltung für alle Tools der Suite, siehe
// docs/DESIGN.md in suite-kit), dazu die eigenen des Abstimmungstools.
export * from 'suite-kit/ui'

/** "Mo., 12.10.2026, 19:00" in der Zeitzone des Servers (TZ, wie Schließdatum und Termine). */
export function formatShortDate(date: Date): string {
  return date.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
