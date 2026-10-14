import { NextResponse } from 'next/server'

/**
 * Einziger Zweck: Der eingebettete Fragebogen (/fragebogen/<id>/einbetten, docs/KONZEPT-FRAGEBOGEN.md) darf in
 * den Seiten aus EMBED_ALLOWED_ORIGINS erscheinen. Alle anderen Seiten verbieten das Einbetten über die Header in
 * next.config.ts, die diesen Pfad auslassen. Hier statt dort, weil die .env erst zur Laufzeit vorliegt.
 *
 * EMBED_ALLOWED_ORIGINS: durch Leerzeichen oder Komma getrennt, z.B. "https://campus-koblenz.app https://*.ramonroeser.de".
 * Nur Einträge der Form http(s)://host[:port] (Platzhalter nur als erste Subdomain) - alles andere fällt weg, damit
 * ein Tippfehler die CSP nicht aushebelt. Ohne Einträge nur 'self'.
 */
const SOURCE = /^https?:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/

function embedAncestors(raw = process.env.EMBED_ALLOWED_ORIGINS ?? ''): string {
  const allowed = raw.split(/[\s,]+/).map(s => s.toLowerCase().replace(/\/$/, '')).filter(s => SOURCE.test(s))
  return ["'self'", ...new Set(allowed)].join(' ')
}

export function proxy() {
  const response = NextResponse.next()
  response.headers.set('Content-Security-Policy', `frame-ancestors ${embedAncestors()}`)
  return response
}

export const config = {
  matcher: '/fragebogen/:id/einbetten'
}
