import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildAuthorizeResponseUrl, buildDiscoveryDocument, issueLoginAssertion, loadSigner, parseAuthorizeRequest, type Signer } from 'suite-kit'

// Test-Doppel für andere Tools der Suite, damit die Föderation ohne echtes rsvp-app oder Seating
// geprüft werden kann. Tool A und B sind ANBIETER für dieses Tool (Discovery, Authorize mit einer
// von den Tests eingestellten Identität) - A mit autoProvision, B ohne. Tool C ist konfiguriert,
// aber nie gestartet: ein Anbieter, der gerade nicht erreichbar ist.
//
// Absichtlich auf `localhost` statt 127.0.0.1 (dieses Tool): unterschiedliche Hostnamen, sonst
// teilten sich die Tools Cookies. Andere Ports als die Test-Doppel von Seating, damit beide
// Testläufe gleichzeitig laufen können.

export type ToolName = 'a' | 'b'
export const SUITE_TOOLS: Record<ToolName | 'c', { port: number; origin: string; label: string }> = {
  a: { port: 2628, origin: 'http://localhost:2628', label: 'Tool A' },
  b: { port: 2629, origin: 'http://localhost:2629', label: 'Tool B' },
  c: { port: 2630, origin: 'http://localhost:2630', label: 'Tool C' }
}
// Eigenes Verzeichnis statt data/ - das gehört im Betrieb dem Container.
export const SUITE_DIR = '.e2e/suite'

/** Konfiguration für dieses Tool (playwright.config.ts): A legt Konten an, B und C nicht. */
export const TEST_SUITE_IDPS = JSON.stringify([
  { issuer: SUITE_TOOLS.a.origin, label: SUITE_TOOLS.a.label, autoProvision: true },
  { issuer: SUITE_TOOLS.b.origin, label: SUITE_TOOLS.b.label, autoProvision: false },
  { issuer: SUITE_TOOLS.c.origin, label: SUITE_TOOLS.c.label, autoProvision: false }
])

/**
 * Feste Ed25519-Schlüssel aus einem Namen (PKCS#8 = fester Präfix + 32 Byte Seed), damit die
 * Schlüssel über Neustarts stabil bleiben. Nur für Tests.
 */
function testSigner(name: string): Signer {
  const seed = createHash('sha256').update(`suite-e2e:${name}`).digest()
  return loadSigner(Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]).toString('base64url'))
}

/**
 * Wer beim Anbieter "eingeloggt" ist. null = niemand.
 * tamper 'signature': absichtlich ungültige Bestätigung - für die Fehlerfälle.
 */
export type TestIdentity = { sub: string; email: string; name?: string; role?: string; tamper?: 'signature' }

export function setIdentity(tool: ToolName, identity: TestIdentity | null) {
  mkdirSync(SUITE_DIR, { recursive: true })
  const file = join(SUITE_DIR, `identity-${tool}.json`)
  if (identity === null) rmSync(file, { force: true })
  else writeFileSync(file, JSON.stringify(identity))
}

/**
 * Schlüsselwechsel beim Anbieter nachspielen (suite-kit docs/PROTOCOL.md "Schlüsselwechsel"):
 * `sign` signiert, `publish` steht im Discovery-Dokument (erster = aktiv, weitere = wie
 * SUITE_SIGNING_KEY_PREVIOUS). null = Standard (ein fester Schlüssel pro Tool).
 */
export type TestKeys = { sign: string; publish: string[] }

export function setKeys(tool: ToolName, keys: TestKeys | null) {
  mkdirSync(SUITE_DIR, { recursive: true })
  const file = join(SUITE_DIR, `keys-${tool}.json`)
  if (keys === null) rmSync(file, { force: true })
  else writeFileSync(file, JSON.stringify(keys))
}

function currentKeys(tool: ToolName): { signer: Signer; published: Signer[] } {
  const file = join(SUITE_DIR, `keys-${tool}.json`)
  if (!existsSync(file)) return { signer: testSigner(tool), published: [testSigner(tool)] }
  const keys = JSON.parse(readFileSync(file, 'utf8')) as TestKeys
  return { signer: testSigner(keys.sign), published: keys.publish.map(testSigner) }
}

function handler(tool: ToolName, appOrigin: string) {
  const { origin, label } = SUITE_TOOLS[tool]
  const html = (text: string) => `<!doctype html><meta charset="utf-8"><title>${label}</title><p>${text}</p>`

  return (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
    const url = new URL(request.url ?? '/', origin)

    if (url.pathname === '/.well-known/suite-identity') {
      const doc = buildDiscoveryDocument({ issuer: origin, name: label, signers: currentKeys(tool).published })
      return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(doc))
    }

    if (url.pathname === '/api/suite/authorize') {
      // Wie ein echter Anbieter: nur an freigegebene Tools (hier: das Abstimmungstool) ausstellen.
      const parsed = parseAuthorizeRequest(url, [appOrigin])
      if (!parsed.ok) return response.writeHead(400, { 'Content-Type': 'text/html' }).end(html(`Abgelehnt: ${parsed.reason}`))
      const file = join(SUITE_DIR, `identity-${tool}.json`)
      if (!existsSync(file)) return response.writeHead(200, { 'Content-Type': 'text/html' }).end(html('Bei diesem Tool ist niemand angemeldet.'))
      const identity = JSON.parse(readFileSync(file, 'utf8')) as TestIdentity

      let assertion = issueLoginAssertion(currentKeys(tool).signer, {
        issuer: origin,
        audience: parsed.request.app,
        subject: identity.sub,
        email: identity.email,
        name: identity.name,
        role: identity.role,
        nonce: parsed.request.state
      })
      if (identity.tamper === 'signature') {
        // Letztes Zeichen der Signatur ändern.
        assertion = assertion.slice(0, -2) + (assertion.slice(-2, -1) === 'A' ? 'B' : 'A') + assertion.slice(-1)
      }
      return response.writeHead(303, { Location: buildAuthorizeResponseUrl(parsed.request, assertion), 'Cache-Control': 'no-store' }).end()
    }

    response.writeHead(404).end('not found')
  }
}

/**
 * `localhost` löst je nach System zu ::1 oder 127.0.0.1 auf (Browser und Node können sich dabei
 * unterscheiden) - deshalb auf beiden Loopback-Adressen lauschen, aber nie nach außen.
 */
export async function startSuiteServers(appOrigin: string): Promise<Server[]> {
  rmSync(SUITE_DIR, { recursive: true, force: true })
  mkdirSync(SUITE_DIR, { recursive: true })
  const tools: ToolName[] = ['a', 'b']
  const listeners = tools.flatMap(tool => ['127.0.0.1', '::1'].map(host => new Promise<Server>((resolve, reject) => {
    const server = createServer(handler(tool, appOrigin))
    server.once('error', reject)
    server.listen(SUITE_TOOLS[tool].port, host, () => resolve(server))
  })))
  return Promise.all(listeners)
}
