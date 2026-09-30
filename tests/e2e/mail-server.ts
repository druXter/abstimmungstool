import { createServer, type Server } from 'node:net'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Minimaler SMTP-Server als Test-Doppel für den Mailversand (app/lib/mail.ts). Versteht nur
// das, was nodemailer ohne TLS und ohne Anmeldung braucht, und hängt jede empfangene Mail als
// JSON-Zeile an eine Datei - wie bei tests/e2e/suite-server.ts laufen Server (globalSetup)
// und Tests in verschiedenen Prozessen und reden über das Dateisystem miteinander.

export const MAIL_PORT = 2525
const MAIL_DIR = '.e2e'
const MAIL_FILE = join(MAIL_DIR, 'mails.jsonl')

type StoredMail = { to: string[]; raw: string }

export function startMailServer(): Promise<Server> {
  mkdirSync(MAIL_DIR, { recursive: true })
  const server = createServer(socket => {
    let buffer = ''
    let inData = false
    let to: string[] = []
    socket.write('220 test-smtp ESMTP\r\n')
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end === -1) return
          const mail: StoredMail = { to, raw: buffer.slice(0, end) }
          appendFileSync(MAIL_FILE, `${JSON.stringify(mail)}\n`)
          buffer = buffer.slice(end + 5)
          inData = false
          to = []
          socket.write('250 OK\r\n')
          continue
        }
        const lineEnd = buffer.indexOf('\r\n')
        if (lineEnd === -1) return
        const line = buffer.slice(0, lineEnd)
        buffer = buffer.slice(lineEnd + 2)
        const command = line.slice(0, 4).toUpperCase()
        if (command === 'EHLO') socket.write('250-test-smtp\r\n250 8BITMIME\r\n')
        else if (command === 'RCPT') {
          to.push(line.replace(/^RCPT TO:\s*<?([^>]*)>?.*$/i, '$1').toLowerCase())
          socket.write('250 OK\r\n')
        } else if (command === 'DATA') {
          inData = true
          socket.write('354 go ahead\r\n')
        } else if (command === 'QUIT') {
          socket.end('221 bye\r\n')
          return
        } else socket.write('250 OK\r\n')
      }
    })
    socket.on('error', () => {})
  })
  return new Promise(resolve => server.listen(MAIL_PORT, '127.0.0.1', () => resolve(server)))
}

/** Entfernt die Quoted-Printable-Kodierung (weiche Umbrüche, =XX), damit Links am Stück lesbar sind. */
function decodeQuotedPrintable(text: string): string {
  // Byteweise sammeln und erst am Ende als UTF-8 lesen - ein "ä" steht dort als zwei Bytes (=C3=A4).
  const bytes = text.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  return Buffer.from(bytes, 'latin1').toString('utf8')
}

/** Wartet auf die jüngste Mail an eine Adresse und gibt ihren (dekodierten) Rohtext zurück. */
export async function waitForMail(to: string, { timeoutMs = 5000 } = {}): Promise<string> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (existsSync(MAIL_FILE)) {
      const mails = readFileSync(MAIL_FILE, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as StoredMail)
      const match = mails.reverse().find(mail => mail.to.includes(to.toLowerCase()))
      if (match) return decodeQuotedPrintable(match.raw)
    }
    if (Date.now() > deadline) throw new Error(`Keine Mail an ${to} angekommen`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** Alle Mails an eine Adresse (für "es kam KEINE weitere"). */
export function mailsTo(to: string): string[] {
  if (!existsSync(MAIL_FILE)) return []
  return readFileSync(MAIL_FILE, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as StoredMail)
    .filter(mail => mail.to.includes(to.toLowerCase()))
    .map(mail => decodeQuotedPrintable(mail.raw))
}

/** Erste URL in einer Mail, die mit `prefix` beginnt. */
export function linkIn(mail: string, prefix: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = mail.match(new RegExp(`${escaped}[^\\s"<>]+`))
  if (!match) throw new Error(`Kein Link mit ${prefix} in der Mail`)
  return match[0].replace(/&amp;/g, '&')
}
