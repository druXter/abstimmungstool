import { createHmac } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Test-Doppel für rsvp-app (Terminabstimmung, app/lib/rsvp-date.ts): nimmt POST /api/poll-date
// und /api/poll-result-webhook an, schreibt jede Anfrage mit und antwortet auf poll-date mit dem,
// was der Test per setRsvpScenario vorgibt - Server (globalSetup) und Tests laufen in
// verschiedenen Prozessen und reden wie die anderen Doppel über Dateien.

export const RSVP_PORT = 2642
export const RSVP_ORIGIN = `http://127.0.0.1:${RSVP_PORT}`
const LOG = join('.e2e', 'rsvp.jsonl')
const SCENARIO = join('.e2e', 'rsvp-scenario.json')
// Anwesenheit für Sitzungen (POST /api/assembly/roster, docs/KONZEPT-SITZUNG.md): pro Sitzung, was rsvp-app meldet.
const ROSTERS = join('.e2e', 'rsvp-rosters.json')
// Gleiches Secret wie playwright.config.ts (TEST_RSVP_SECRET) - hier nicht importiert, weil die Config diese Datei lädt.
const SECRET = 'nur-fuer-e2e-tests-kein-echtes-secret'

export type RosterScenario = {
  status?: number; checkin?: boolean; members?: number; present: string[]; badSignature?: boolean
  /** Alle Zusagen mit Namen (POST /api/assembly/attendance) - wer in `present` steht, ist da, wer in `left`, gegangen. */
  people?: { sub: string; name: string }[]
  left?: string[]
  trackPresence?: boolean
  /** HTTP-Status für POST /api/assembly/presence (z.B. 503 = nicht erreichbar, 409 = kein QR-Einlass). */
  presenceStatus?: number
}

function readRosters(): Record<string, RosterScenario> {
  return existsSync(ROSTERS) ? JSON.parse(readFileSync(ROSTERS, 'utf8')) : {}
}

export function getRoster(assemblyId: string): RosterScenario | undefined {
  return readRosters()[assemblyId]
}

/** Was rsvp-app für diese Sitzung als anwesend meldet (status: z.B. 503 = nicht erreichbar). */
export function setRoster(assemblyId: string, roster: RosterScenario) {
  mkdirSync('.e2e', { recursive: true })
  const all: Record<string, RosterScenario> = existsSync(ROSTERS) ? JSON.parse(readFileSync(ROSTERS, 'utf8')) : {}
  all[assemblyId] = roster
  writeFileSync(ROSTERS, JSON.stringify(all))
}

function signed(payload: object, secret = SECRET): string {
  const part = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${part}.${createHmac('sha256', secret).update(part).digest('base64url')}`
}

function decode(body: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(body.split('.')[0], 'base64url').toString('utf8'))
}

/** Anwesenheitsliste mit Namen für die Sitzungsleitung. */
function attendanceResponse(body: string): { status: number; body: string } {
  const request = decode(body) as { typ: string; assemblyId: string; eventId: string }
  const roster = readRosters()[request.assemblyId]
  if (request.typ !== 'assembly-attendance') return { status: 401, body: 'invalid' }
  if (!roster) return { status: 404, body: 'not linked' }
  if (roster.status && roster.status !== 200) return { status: roster.status, body: '' }
  return {
    status: 200,
    body: signed({
      typ: 'assembly-attendance-result', assemblyId: request.assemblyId, eventId: request.eventId, checkin: roster.checkin ?? true,
      trackPresence: roster.trackPresence ?? true, exp: Math.floor(Date.now() / 1000) + 300,
      people: (roster.people ?? []).map(p => ({ ...p, present: roster.present.includes(p.sub), left: (roster.left ?? []).includes(p.sub) }))
    }, roster.badSignature ? 'falsch' : SECRET)
  }
}

/** Ein- und Auschecken: ändert, was das Doppel danach als anwesend meldet (wie rsvp-app). */
function presenceResponse(body: string): { status: number; body: string } {
  const request = decode(body) as { typ: string; assemblyId: string; sub: string; present: boolean }
  const all = readRosters()
  const roster = all[request.assemblyId]
  if (request.typ !== 'assembly-presence') return { status: 401, body: 'invalid' }
  if (!roster) return { status: 404, body: 'not linked' }
  if (roster.presenceStatus && roster.presenceStatus !== 200) return { status: roster.presenceStatus, body: '' }
  if (roster.people && !roster.people.some(p => p.sub === request.sub)) return { status: 404, body: 'unknown member' }
  const present = new Set(roster.present)
  const left = new Set(roster.left ?? [])
  if (request.present) {
    present.add(request.sub)
    left.delete(request.sub)
  } else if (present.delete(request.sub)) {
    left.add(request.sub)
  }
  all[request.assemblyId] = { ...roster, present: [...present], left: [...left] }
  writeFileSync(ROSTERS, JSON.stringify(all))
  return { status: 200, body: '{"ok":true}' }
}

/** Mitgeschriebene Ein-/Auscheck-Meldungen einer Sitzung (Payload dekodiert). */
export function presenceMessages(assemblyId: string): Record<string, unknown>[] {
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as { path: string; body: string })
    .filter(entry => entry.path === '/api/assembly/presence')
    .map(entry => decode(entry.body))
    .filter(payload => payload.assemblyId === assemblyId)
}

function rosterResponse(body: string): { status: number; body: string } {
  const request = JSON.parse(Buffer.from(body.split('.')[0], 'base64url').toString('utf8')) as { assemblyId: string; eventId: string }
  const all: Record<string, RosterScenario> = existsSync(ROSTERS) ? JSON.parse(readFileSync(ROSTERS, 'utf8')) : {}
  const roster = all[request.assemblyId]
  if (!roster) return { status: 404, body: 'not linked' }
  if (roster.status && roster.status !== 200) return { status: roster.status, body: '' }
  return {
    status: 200,
    body: signed({
      typ: 'assembly-roster-result', assemblyId: request.assemblyId, eventId: request.eventId, checkin: roster.checkin ?? true,
      members: roster.members ?? roster.present.length, present: roster.present, exp: Math.floor(Date.now() / 1000) + 300
    }, roster.badSignature ? 'falsch' : SECRET)
  }
}

export type RsvpScenario = {
  /** HTTP-Status für poll-date (z.B. 503 = nicht erreichbar/defekt). */
  status?: number
  events?: { id: string; title: string; datePending: boolean }[]
  canCreate?: boolean
  updated?: { id: string; title: string; url: string }[]
  created?: { id: string; title: string; url: string; adminUrl: string } | null
}

export function setRsvpScenario(scenario: RsvpScenario) {
  mkdirSync('.e2e', { recursive: true })
  writeFileSync(SCENARIO, JSON.stringify(scenario))
}

export function startRsvpServer(): Promise<Server> {
  mkdirSync('.e2e', { recursive: true })
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      appendFileSync(LOG, `${JSON.stringify({ path: request.url, body })}\n`)
      const handler = ({ '/api/assembly/roster': rosterResponse, '/api/assembly/attendance': attendanceResponse, '/api/assembly/presence': presenceResponse } as Record<string, (b: string) => { status: number; body: string }>)[request.url ?? '']
      if (handler) {
        const answer = handler(body)
        return response.writeHead(answer.status, { 'Content-Type': 'text/plain' }).end(answer.body)
      }
      if (request.url !== '/api/poll-date') return response.writeHead(200).end('{"ok":true}')
      const scenario: RsvpScenario = existsSync(SCENARIO) ? JSON.parse(readFileSync(SCENARIO, 'utf8')) : {}
      if (scenario.status && scenario.status !== 200) return response.writeHead(scenario.status).end('{}')
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ok: true,
        events: scenario.events ?? [],
        canCreate: scenario.canCreate ?? false,
        updated: scenario.updated ?? [],
        created: scenario.created ?? null,
        unchanged: (scenario.events ?? []).filter(e => !e.datePending).map(e => ({ id: e.id, title: e.title }))
      }))
    })
  })
  return new Promise(resolve => server.listen(RSVP_PORT, '127.0.0.1', () => resolve(server)))
}

/** Mitgeschriebene Nachrichten an /api/poll-date (Payload dekodiert, Signatur-Teil separat). */
export function pollDateMessages(pollId: string): { payload: Record<string, unknown>; token: string }[] {
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as { path: string; body: string })
    .filter(entry => entry.path === '/api/poll-date')
    .map(entry => ({ token: entry.body, payload: JSON.parse(Buffer.from(entry.body.split('.')[0], 'base64url').toString('utf8')) }))
    .filter(message => message.payload.pollId === pollId)
}

/** Mitgeschriebene Ergebnis-Meldungen (POST /api/poll-result-webhook), Payload dekodiert. */
export function resultMessages(pollId: string): Record<string, unknown>[] {
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as { path: string; body: string })
    .filter(entry => entry.path === '/api/poll-result-webhook')
    .map(entry => JSON.parse(Buffer.from(entry.body.split('.')[0], 'base64url').toString('utf8')) as Record<string, unknown>)
    .filter(payload => payload.pollId === pollId)
}
