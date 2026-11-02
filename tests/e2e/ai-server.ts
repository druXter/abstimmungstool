import { createServer, type Server } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Test-Doppel der OpenAI Responses API für die KI-Zusammenfassung (app/lib/survey-summary.ts, askAi aus suite-kit).
// Liest die nummerierten Antworten aus der Anfrage: Antworten mit „Essen“ bilden das Thema „Essen“, mit „Musik“ das
// Thema „Musik“; Antworten ohne beides keinem Thema. Steht „Kaputt“ in der Frage, antwortet es mit 500. Jede Anfrage
// landet in AI_FILE (Modell, store, Anweisung, Text) - die Tests prüfen damit, was an OpenAI gegangen wäre.

export const AI_PORT = 2645
export const AI_KEY = 'test-openai-key'
export const AI_FILE = join('.e2e', 'ai-last.json')

export function startAiServer(): Promise<Server> {
  mkdirSync('.e2e', { recursive: true })
  rmSync(AI_FILE, { force: true })
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(body))
      }
      if (request.method !== 'POST' || request.url !== '/v1/responses') return reply(404, { error: 'unbekannt' })
      if (request.headers.authorization !== `Bearer ${AI_KEY}`) return reply(401, { error: { message: 'falscher Schlüssel' } })
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const text: string = body.input?.[0]?.content?.find((part: { type: string }) => part.type === 'input_text')?.text ?? ''
      writeFileSync(AI_FILE, JSON.stringify({ model: body.model, store: body.store, instructions: body.instructions, text }))
      if (/^Frage: [^\n]*Kaputt/m.test(text)) return reply(500, { error: { message: 'Testfehler' } })
      const numbers = (word: string) => [...text.matchAll(/^(\d+)\. (.*)$/gm)].filter(match => match[2].includes(word)).map(match => Number(match[1]))
      const themen = [
        { titel: 'Musik', beschreibung: 'Die Musik war vielen zu laut.', antworten: numbers('Musik') },
        { titel: 'Essen', beschreibung: 'Lob und Wünsche zum Essen.', antworten: numbers('Essen') }
      ].filter(theme => theme.antworten.length > 0)
      const answer = { ueberblick: 'Überwiegend zufrieden, Wünsche zu Essen und Musik.', themen }
      reply(200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] })
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(AI_PORT, '127.0.0.1', () => resolve(server))
  })
}
