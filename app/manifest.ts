// app/manifest.ts
import type { MetadataRoute } from 'next'

/**
 * Web-App-Manifest: macht das Tool installierbar (Startbildschirm/App-Fenster). Bewusst schlank -
 * das Abstimmen selbst braucht keine Installation, jeder Abstimmungslink funktioniert im Browser.
 * Wer das Tool regelmäßig zum Anlegen und Verwalten nutzt, bekommt so ein eigenes App-Symbol.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Abstimmungstool',
    short_name: 'Abstimmen',
    description: 'Einfache Gruppen-Abstimmungen - anlegen, teilen, gemeinsam moderieren',
    lang: 'de',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Tailwind gray-50 bzw. blue-600 - dieselben Farben wie die Oberfläche, damit Start-Bildschirm
    // und Statusleiste nahtlos in die App übergehen.
    background_color: '#f9fafb',
    theme_color: '#2563eb',
    categories: ['productivity', 'utilities'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Vollflächig, damit Android das Symbol frei zuschneiden kann (Kreis, abgerundetes Quadrat ...).
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Meine Abstimmungen', short_name: 'Meine', url: '/meine-abstimmungen', description: 'Eigene und geteilte Abstimmungen ansehen' },
      { name: 'Neue Abstimmung', short_name: 'Neu', url: '/erstellen', description: 'Eine neue Abstimmung anlegen' },
    ],
  }
}
