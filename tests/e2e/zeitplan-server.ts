import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Test-Doppel für den öffentlichen Polling-Endpunkt des Zeitplans (GET /api/view/<slug>, app/lib/timeline.ts): liefert,
// was der Test per setAgenda vorgibt. Server und Tests reden wie die anderen Doppel über eine Datei.

export const ZEITPLAN_PORT = 2644
export const ZEITPLAN_ORIGIN = `http://127.0.0.1:${ZEITPLAN_PORT}`
const VIEWS = join('.e2e', 'zeitplan-views.json')

export type AgendaScenario = {
  status?: number
  /** Nur mit diesem Tafel-Schlüssel (?k=), sonst 403 - wie ein Ablauf "nur mit Zugang". */
  key?: string
  title?: string
  announcement?: string
  items: { title: string; status: 'upcoming' | 'now' | 'past' | 'cancelled'; start: string; delayMin?: number }[]
}

export function setAgenda(slug: string, scenario: AgendaScenario) {
  mkdirSync('.e2e', { recursive: true })
  const all: Record<string, AgendaScenario> = existsSync(VIEWS) ? JSON.parse(readFileSync(VIEWS, 'utf8')) : {}
  all[slug] = scenario
  writeFileSync(VIEWS, JSON.stringify(all))
}

export function startZeitplanServer(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', ZEITPLAN_ORIGIN)
    const slug = url.pathname.match(/^\/api\/view\/([^/]+)$/)?.[1]
    const all: Record<string, AgendaScenario> = existsSync(VIEWS) ? JSON.parse(readFileSync(VIEWS, 'utf8')) : {}
    const scenario = slug ? all[decodeURIComponent(slug)] : undefined
    if (!scenario) return response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not-found"}')
    if (scenario.status && scenario.status !== 200) return response.writeHead(scenario.status).end('{}')
    if (scenario.key && url.searchParams.get('k') !== scenario.key) return response.writeHead(403, { 'Content-Type': 'application/json' }).end('{"error":"protected"}')
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      event: { title: scenario.title ?? 'Mitgliederversammlung', description: '', date: new Date().toISOString(), timezone: 'Europe/Berlin', status: 'LIVE', series: null },
      showTracks: false,
      announcement: scenario.announcement ? { text: scenario.announcement, at: new Date().toISOString(), until: null } : null,
      items: scenario.items.map((item, index) => ({
        id: `i${index}`, title: item.title, location: null, address: null, routeUrl: null, description: null, track: 'Programm', status: item.status,
        plannedStart: item.start, shownStart: item.start, approximate: false, delayMin: item.delayMin ?? null, cancelReason: null
      }))
    }))
  })
  return new Promise(resolve => server.listen(ZEITPLAN_PORT, '127.0.0.1', () => resolve(server)))
}
