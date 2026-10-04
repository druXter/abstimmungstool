// app/api/suite/login/route.ts
import type { NextRequest } from 'next/server'
import { buildAuthorizeRequestUrl, fetchDiscovery, normalizeOrigin, randomState, sanitizeNextPath } from 'suite-kit'
import { cookieOptions, getCurrentUser } from '../../../lib/auth'
import { getIdps, selfOrigin } from '../../../lib/suite'
import { redirectResponse, SUITE_STATE_COOKIE, SUITE_STATE_MAX_AGE_SECONDS, withNotice, type SuiteFlow } from '../../../lib/suite-flow'

export const dynamic = 'force-dynamic'

/**
 * EMPFÄNGER-Seite, Schritt 1: Startet die Anmeldung mit einem Konto aus einem anderen
 * Tool (`?idp=<Origin>`). Erzeugt den einmaligen `state`, legt ihn in ein Cookie DIESES
 * Browsers und schickt den Browser zum Anbieter. Der Anbieter muss in SUITE_IDPS stehen -
 * die Adresse kommt nie ungeprüft aus der Anfrage.
 *
 * `mode=link` verknüpft stattdessen ein Konto mit dem bereits eingeloggten lokalen Konto
 * (Button unter /konto), statt ein neues Login zu erzeugen.
 *
 * `mode=participant` meldet mit einem TEILNEHMENDENKONTO an (nur Anbieter mit `participants: true`,
 * Button auf Abstimmungen im Modus ACCOUNT) - fordert beim Anbieter `kind=participant` an, Fehler
 * landen als Hinweis auf der Abstimmungsseite (`next`).
 */
export async function GET(request: NextRequest) {
  const origin = selfOrigin()
  const params = request.nextUrl.searchParams
  const modeParam = params.get('mode')
  const mode: SuiteFlow['mode'] = modeParam === 'link' || modeParam === 'participant' ? modeParam : 'login'
  const next = sanitizeNextPath(params.get('next'), mode === 'link' ? '/konto' : mode === 'participant' ? '/' : '/meine-abstimmungen')

  // Beim Verknüpfen ist man eingeloggt - /anmelden würde sofort weiterleiten und die Meldung verschlucken.
  const errorPage = mode === 'link' ? '/konto' : '/anmelden'
  const errorUrl = (code: string) => (mode === 'participant' ? withNotice(next, code === 'sso' ? 'anmeldung-fehlgeschlagen' : 'anbieter-nicht-erreichbar') : `${errorPage}?error=${code}`)

  const issuer = normalizeOrigin(params.get('idp') ?? '')
  const idp = getIdps().find(i => i.issuer === issuer && (mode !== 'participant' || i.participants))
  if (!origin || !idp) return redirectResponse(errorUrl('sso'), request.nextUrl.origin)

  if (mode === 'link' && !(await getCurrentUser())) {
    return redirectResponse(`/anmelden?next=${encodeURIComponent('/konto')}`, origin)
  }

  const discovery = await fetchDiscovery(idp.issuer)
  if (!discovery) return redirectResponse(errorUrl('idp-unreachable'), origin)

  const state = randomState()
  const kind = mode === 'participant' ? 'participant' : 'staff'
  const response = redirectResponse(buildAuthorizeRequestUrl(discovery.authorizeUrl, { app: origin, state, kind }), origin)
  const flow: SuiteFlow = { state, issuer: idp.issuer, next, mode }
  response.cookies.set(SUITE_STATE_COOKIE, JSON.stringify(flow), cookieOptions(SUITE_STATE_MAX_AGE_SECONDS))
  return response
}
