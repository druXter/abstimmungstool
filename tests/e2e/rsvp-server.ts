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
