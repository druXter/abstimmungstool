import { NextResponse, type NextRequest } from 'next/server'

/**
 * Fragebögen (docs/KONZEPT-FRAGEBOGEN.md):
 *
 * 1. Der eingebettete Fragebogen (/fragebogen/<id>/einbetten) darf in den Seiten aus EMBED_ALLOWED_ORIGINS erscheinen.
 *    Alle anderen Seiten verbieten das Einbetten über die Header in next.config.ts, die diesen Pfad auslassen. Hier
 *    statt dort, weil die .env erst zur Laufzeit vorliegt.
 *    EMBED_ALLOWED_ORIGINS: durch Leerzeichen oder Komma getrennt, z.B. "https://campus-koblenz.app https://*.ramonroeser.de".
 *    Nur Einträge der Form http(s)://host[:port] (Platzhalter nur als erste Subdomain) - alles andere fällt weg, damit
 *    ein Tippfehler die CSP nicht aushebelt. Ohne Einträge nur 'self'.
 * 2. Abgaben an die öffentlichen Fragebogen-Seiten dürfen höchstens MAX_SUBMIT_BYTES groß sein. Global erlaubt
 *    next.config.ts 16 MB (Bilder der Live-Runden) - ohne diese Grenze könnte jeder ohne Konto beliebig oft so große
 *    Anfragen schicken, die der Server erst vollständig einliest, bevor er sie ablehnt. Ein voll ausgefüllter
 *    Fragebogen (50 Fragen, lange Freitexte) bleibt weit darunter.
 */
const SOURCE = /^https?:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/
const MAX_SUBMIT_BYTES = 512 * 1024

function embedAncestors(raw = process.env.EMBED_ALLOWED_ORIGINS ?? ''): string {
  const allowed = raw.split(/[\s,]+/).map(s => s.toLowerCase().replace(/\/$/, '')).filter(s => SOURCE.test(s))
  return ["'self'", ...new Set(allowed)].join(' ')
}

export function proxy(request: NextRequest) {
  if (request.method === 'POST') {
    const length = Number(request.headers.get('content-length') ?? NaN)
    // Ohne Längenangabe (chunked) ebenfalls ablehnen - Browser schicken Formulare immer mit Content-Length.
    if (!Number.isFinite(length) || length > MAX_SUBMIT_BYTES) return new NextResponse('Payload Too Large', { status: 413 })
  }
  const response = NextResponse.next()
  if (request.nextUrl.pathname.replace(/\/$/, '').endsWith('/einbetten')) {
    response.headers.set('Content-Security-Policy', `frame-ancestors ${embedAncestors()}`)
  }
  return response
}

export const config = {
  // /fragebogen/neu (Anlegen mit Konto) fällt hierunter, bleibt aber ebenfalls weit unter der Grenze.
  matcher: ['/fragebogen/:id', '/fragebogen/:id/einbetten']
}
