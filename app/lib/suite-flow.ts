// app/lib/suite-flow.ts
import { NextResponse } from 'next/server'
import { selfOrigin } from './suite'

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Cookie des Empfängers für einen laufenden Anmeldevorgang bei einem anderen Tool
 * (Inhalt: `state`, Anbieter, Rücksprungziel, Modus). `__Host-`-Präfix aus demselben
 * Grund wie beim Session-Cookie (siehe app/lib/auth.ts).
 */
export const SUITE_STATE_COOKIE = isProduction ? '__Host-suite-state' : 'suite-state'
export const SUITE_STATE_MAX_AGE_SECONDS = 10 * 60

/** `participant`: Anmeldung mit einem Teilnehmendenkonto (app/lib/participant.ts), nur zum Abstimmen. */
export type SuiteFlow = { state: string; issuer: string; next: string; mode: 'login' | 'link' | 'participant' }

export function parseFlow(raw: string | undefined): SuiteFlow | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<SuiteFlow>
    if (
      typeof value.state === 'string' && typeof value.issuer === 'string' &&
      typeof value.next === 'string' && (value.mode === 'login' || value.mode === 'link' || value.mode === 'participant')
    ) {
      return { state: value.state, issuer: value.issuer, next: value.next, mode: value.mode }
    }
  } catch {
    // Kaputtes Cookie - wie "kein Cookie" behandeln.
  }
  return null
}

/**
 * Absolute Weiterleitung innerhalb dieses Tools. Hinter einem Reverse Proxy zeigt
 * request.url auf die interne Adresse des Containers, deshalb wird der öffentliche
 * Origin aus BASE_URL genommen. Die Antworten der Föderations-Endpunkte tragen
 * Einmal-Werte in der URL und dürfen weder gecacht werden noch per Referer an Dritte gehen.
 */
/** Hängt einen Hinweis (`?hinweis=…`, feste Texte auf der Abstimmungsseite) an einen internen Pfad. */
export function withNotice(path: string, notice: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}hinweis=${encodeURIComponent(notice)}`
}

export function redirectResponse(target: string | URL, requestOrigin: string): NextResponse {
  const url = typeof target === 'string' ? new URL(target, selfOrigin() ?? requestOrigin) : target
  const response = NextResponse.redirect(url, 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
