import { createServer, type Server } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Test-Doppel für einen Push-Dienst (wie ihn Browser-Hersteller betreiben): nimmt jede
// Mitteilung an, antwortet für Pfade mit "/gone" mit 410 (Abo erloschen) und hängt Header
// und Rohinhalt als JSON-Zeile an eine Datei - wie tests/e2e/mail-server.ts.

export const PUSH_PORT = 2641
export const PUSH_ORIGIN = `http://127.0.0.1:${PUSH_PORT}`
const PUSH_FILE = join('.e2e', 'push.jsonl')

export type ReceivedPush = { path: string; headers: Record<string, string>; body: string }

export function startPushServer(): Promise<Server> {
  mkdirSync('.e2e', { recursive: true })
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const received: ReceivedPush = {
        path: request.url ?? '/',
        headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, String(v)])),
        body: Buffer.concat(chunks).toString('base64')
      }
      appendFileSync(PUSH_FILE, `${JSON.stringify(received)}\n`)
      response.writeHead(received.path.includes('/gone') ? 410 : 201).end()
    })
  })
  return new Promise(resolve => server.listen(PUSH_PORT, '127.0.0.1', () => resolve(server)))
}

/** Alle Mitteilungen an einen Pfad. */
export function pushesTo(path: string): ReceivedPush[] {
  if (!existsSync(PUSH_FILE)) return []
  return readFileSync(PUSH_FILE, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as ReceivedPush)
    .filter(push => push.path === path)
}
