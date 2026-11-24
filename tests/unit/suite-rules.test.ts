import { afterEach, it, vi } from 'vitest'
import { suiteRules } from 'suite-kit/rules'

// Gemeinsame Regeln der Suite (suite-kit/rules, docs/KONVENTIONEN.md dort): Prüfungen aus den Audits aller Tools,
// die hier gegen die EIGENEN Funktionen laufen. Kommt mit einer neuen suite-kit-Version eine Regel dazu, wird sie
// hier von selbst rot, wenn das Abstimmungstool sie nicht erfüllt (scripts/update-apps.mjs in suite-kit lässt diese Datei laufen).
//
// Anders als in den anderen Tools ist clientIp() hier die volle Adresse: ipRules zählt IPv6 zweistufig, je /64 (die
// Grenze für den Anschluss) und darunter je Adresse (damit ein Hörsaal in einem /64 nicht gemeinsam gesperrt wird).
// Die Regel „ein /64 ist ein Besucher“ gilt deshalb für die Netz-Stufe, und genau die prüft networkOf unten.

let forwardedFor: string | null = null
vi.mock('next/headers', () => ({
  headers: async () => new Headers(forwardedFor === null ? {} : { 'x-forwarded-for': forwardedFor })
}))
vi.mock('../../app/lib/prisma', () => ({ prisma: {} }))

const { clientIp, ipRules } = await import('../../app/lib/throttle')
const { IP_LIMITS } = await import('../../app/lib/throttle-limits')
const { normalizeEmail } = await import('../../app/lib/form')

afterEach(() => {
  vi.unstubAllEnvs()
  forwardedFor = null
})

// Der Zähler je Anschluss ist die gröbste Stufe von ipRules (IPv4-Adresse bzw. IPv6-/64) - die prüft die Regel.
const networkOf = async (header: string) => {
  vi.stubEnv('TRUST_PROXY_HOPS', '1')
  forwardedFor = header
  return ipRules('login', await clientIp(), IP_LIMITS.login, 60_000)[0].identifier
}

for (const rule of suiteRules({ clientIp: networkOf, normalizeEmail })) it(rule.name, rule.run)
