import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  signPollDateMessage, signResultWebhookPayload, signTypedRsvpMessage, verifyRsvpSurveyToken, verifyRsvpToken,
  verifyRsvpWebhookPayload, verifyTypedRsvpMessage
} from '../../app/lib/rsvp-verification'

// Kopplung mit rsvp-app im Format der Suite (suite-kit signLinkMessage):
// `${base64url(JSON)}.${base64url(HMAC-SHA256(payloadPart, secret))}`, Nutzlast `{ typ, aud, ...felder, iat, exp }`.
// Hier bewusst unabhängig nachgebaut, damit die Tests das Format prüfen und nicht die Implementierung gegen sich selbst.
const SECRET = 'unit-test-secret'
const RSVP = 'https://rsvp.example.test'
const VOTE = 'https://vote.example.test'

function sign(payload: object, secret = SECRET): string {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadPart}.${createHmac('sha256', secret).update(payloadPart).digest('base64url')}`
}

function decode(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
}

const now = () => Math.floor(Date.now() / 1000)
const access = (overrides: Record<string, unknown> = {}) => ({
  typ: 'poll-access', aud: VOTE, email: 'Anna@Example.test', pollId: 'poll-1', attending: true, iat: now(), exp: now() + 600, ...overrides
})

beforeEach(() => {
  vi.stubEnv('RSVP_VERIFICATION_SECRET', SECRET)
  vi.stubEnv('BASE_URL', VOTE)
  vi.stubEnv('RSVP_APP_BASE_URL', `${RSVP}/`)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('feste Prüfnachrichten (gleich im Unit-Test von rsvp-app, tests/unit/poll-verification.test.ts)', () => {
  const AT = new Date('2026-10-24T10:00:00Z')

  it('Ergebnis-Meldung an rsvp-app sieht genau so aus', () => {
    vi.useFakeTimers({ now: AT })
    expect(signResultWebhookPayload({
      eventId: 'event-1', pollId: 'poll-1', pollTitle: 'Wohin?', winners: [{ label: 'Kino', votes: 2 }],
      closedAt: '2026-09-01T18:00:00.000Z', quorumMet: true, unit: 'votes'
    })).toBe('eyJ0eXAiOiJwb2xsLXJlc3VsdCIsImF1ZCI6Imh0dHBzOi8vcnN2cC5leGFtcGxlLnRlc3QiLCJldmVudElkIjoiZXZlbnQtMSIsInBvbGxJZCI6InBvbGwtMSIsInBvbGxUaXRsZSI6IldvaGluPyIsIndpbm5lcnMiOlt7ImxhYmVsIjoiS2lubyIsInZvdGVzIjoyfV0sImNsb3NlZEF0IjoiMjAyNi0wOS0wMVQxODowMDowMC4wMDBaIiwicXVvcnVtTWV0Ijp0cnVlLCJ1bml0Ijoidm90ZXMiLCJpYXQiOjE3OTI4MzYwMDAsImV4cCI6MTc5MjgzNjYwMH0.kq-1tB0Vzwh9K7oe8nEmhT7lPNGpYw2Rp05LXNTKDMU')
  })

  it('Klick-Token von rsvp-app wird angenommen', () => {
    vi.useFakeTimers({ now: AT })
    const FIXED_ACCESS = 'eyJ0eXAiOiJwb2xsLWFjY2VzcyIsImF1ZCI6Imh0dHBzOi8vdm90ZS5leGFtcGxlLnRlc3QiLCJlbWFpbCI6ImFubmFAZXhhbXBsZS50ZXN0IiwicG9sbElkIjoicG9sbC0xIiwiYXR0ZW5kaW5nIjp0cnVlLCJpYXQiOjE3OTI4MzYwMDAsImV4cCI6MTc5MjgzNjYwMH0.pdxpIG9LATlTKa_74NxLzV3AbjEdU2A2aqcz7SwCJGs'
    expect(verifyRsvpToken(FIXED_ACCESS, 'poll-1')).toEqual({ email: 'anna@example.test', pollId: 'poll-1', attending: true })
  })
})

describe('verifyRsvpToken (Klick-Token)', () => {
  it('Positivkontrolle; E-Mail klein geschrieben', () => {
    expect(verifyRsvpToken(sign(access()), 'poll-1')).toEqual({ email: 'anna@example.test', pollId: 'poll-1', attending: true })
  })

  it('nur für genau diese Abstimmung, mit typ poll-access und uns als Empfänger', () => {
    expect(verifyRsvpToken(sign(access()), 'poll-2')).toBeNull()
    expect(verifyRsvpToken(sign(access({ typ: undefined })), 'poll-1')).toBeNull()
    expect(verifyRsvpToken(sign(access({ typ: 'poll-attendance', eventId: 'e' })), 'poll-1')).toBeNull()
    expect(verifyRsvpToken(sign(access({ aud: undefined })), 'poll-1')).toBeNull()
    expect(verifyRsvpToken(sign(access({ aud: RSVP })), 'poll-1')).toBeNull()
  })

  it('Signatur, Secret, Gültigkeit', () => {
    expect(verifyRsvpToken(sign(access(), 'anderes-secret'), 'poll-1')).toBeNull()
    expect(verifyRsvpToken(sign(access({ exp: now() - 1 })), 'poll-1')).toBeNull()
    expect(verifyRsvpToken(sign(access({ exp: now() + 16 * 60 })), 'poll-1')).toBeNull()
    expect(verifyRsvpToken(sign(access({ iat: undefined })), 'poll-1')).toBeNull()
    for (const token of [undefined, null, '', 'a.b.c', '.', sign(access()) + 'x']) expect(verifyRsvpToken(token, 'poll-1')).toBeNull()
    vi.stubEnv('RSVP_VERIFICATION_SECRET', '')
    expect(verifyRsvpToken(sign(access(), ''), 'poll-1')).toBeNull()
  })
})

describe('verifyRsvpWebhookPayload (Zu-/Absage)', () => {
  const attendance = (overrides: Record<string, unknown> = {}) => access({ typ: 'poll-attendance', eventId: 'event-1', attending: false, ...overrides })

  it('Positivkontrolle und Pflichtfelder', () => {
    expect(verifyRsvpWebhookPayload(sign(attendance()))).toEqual({ email: 'anna@example.test', pollId: 'poll-1', eventId: 'event-1', attending: false })
    expect(verifyRsvpWebhookPayload(sign(attendance({ eventId: undefined })))).toBeNull()
    expect(verifyRsvpWebhookPayload(sign(attendance({ attending: 'nein' })))).toBeNull()
  })

  it('ein Klick-Token gilt nie als Zu-/Absage-Meldung', () => {
    expect(verifyRsvpWebhookPayload(sign(access({ eventId: 'event-1' })))).toBeNull()
  })
})

describe('verifyRsvpSurveyToken (Fragebogen)', () => {
  const survey = (overrides: Record<string, unknown> = {}) => ({
    typ: 'survey-access', aud: VOTE, surveyId: 'survey-1', sub: 'a'.repeat(43), iat: now(), exp: now() + 12 * 3600, ...overrides
  })

  it('bis 24 Stunden gültig, nur für diesen Fragebogen', () => {
    expect(verifyRsvpSurveyToken(sign(survey()), 'survey-1')).toEqual({ sub: 'a'.repeat(43) })
    expect(verifyRsvpSurveyToken(sign(survey()), 'survey-2')).toBeNull()
    expect(verifyRsvpSurveyToken(sign(survey({ exp: now() + 25 * 3600 })), 'survey-1')).toBeNull()
    expect(verifyRsvpSurveyToken(sign(survey({ aud: RSVP })), 'survey-1')).toBeNull()
    expect(verifyRsvpSurveyToken(sign(survey({ sub: 'kurz' })), 'survey-1')).toBeNull()
  })
})

describe('ausgehende Nachrichten an rsvp-app', () => {
  it('Ergebnis, Termin und Sitzung: typ, aud = rsvp-app, iat und begrenztes exp', () => {
    const result = decode(signResultWebhookPayload({ eventId: 'e', pollId: 'p', pollTitle: 't', winners: [], closedAt: 'x', quorumMet: false, unit: 'points' })!)
    expect(result).toMatchObject({ typ: 'poll-result', aud: RSVP, eventId: 'e', quorumMet: false, unit: 'points' })
    expect(result.exp - result.iat).toBe(600)

    const date = decode(signPollDateMessage({ typ: 'poll-date-status', pollId: 'p', owner: { toolUserId: 'u', rsvpUserId: null } })!)
    expect(date).toMatchObject({ typ: 'poll-date-status', aud: RSVP, pollId: 'p' })
    expect(date.exp - date.iat).toBe(300)

    const roster = signTypedRsvpMessage({ typ: 'assembly-roster', assemblyId: 'a', eventId: 'e' }, 300)!
    expect(decode(roster)).toMatchObject({ typ: 'assembly-roster', aud: RSVP, assemblyId: 'a', eventId: 'e' })
    expect(sign(decode(roster))).toBe(roster)
  })

  it('eigene Nachrichten gelten hier nicht als eingehende (anderer Empfänger)', () => {
    const roster = signTypedRsvpMessage({ typ: 'assembly-roster', assemblyId: 'a', eventId: 'e' }, 300)!
    expect(verifyTypedRsvpMessage(roster, 'assembly-roster', 300)).toBeNull()
  })

  it('ohne Secret oder ohne RSVP_APP_BASE_URL nichts', () => {
    vi.stubEnv('RSVP_APP_BASE_URL', '')
    expect(signTypedRsvpMessage({ typ: 'assembly-roster' }, 300)).toBeNull()
    vi.stubEnv('RSVP_APP_BASE_URL', RSVP)
    vi.stubEnv('RSVP_VERIFICATION_SECRET', '')
    expect(signPollDateMessage({ typ: 'poll-date-status' })).toBeNull()
  })
})
