import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { createAccount, createPoll, prisma, uniqueEmail } from './helpers'

// Auskunft und Löschung zu einer Adresse (Idee Q8, auskunft.js): findet ohne Groß-/Kleinschreibung, gibt keine
// Tokens oder Hashes heraus, ändert erst mit --ja etwas und nie Verwaltungskonten oder Fremdes.
const run = (...args: string[]) => JSON.parse(execFileSync('node', ['auskunft.js', ...args], { env: { ...process.env, DATABASE_URL: 'file:./test.db' }, encoding: 'utf8' }))

test('Stimmen anonymisiert, Bestätigungen gelöscht, Freigabeliste nie leer', async () => {
  const email = uniqueEmail('auskunft')
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { title: 'Wohin?', voterIdentity: 'EMAIL', allowedEmails: email }, ['Pizza', 'Sushi'])
  const options = await prisma.pollOption.findMany({ where: { pollId: poll.id }, orderBy: { position: 'asc' } })
  await prisma.vote.create({ data: { pollId: poll.id, optionId: options[0].id, identityKind: 'EMAIL', voterKey: `email:${email}`, voterName: null } })
  await prisma.vote.create({ data: { pollId: poll.id, optionId: options[1].id, identityKind: 'EMAIL', voterKey: `email:${uniqueEmail('fremd')}` } })
  await prisma.emailVoter.create({ data: { pollId: poll.id, email, tokenExpiresAt: new Date(Date.now() + 3_600_000), confirmedAt: new Date() } })

  const info = run(email.toUpperCase())
  expect(info.daten.stimmen).toEqual([expect.objectContaining({ abstimmung: 'Wohin?', option: 'Pizza' })])
  expect(info.daten.bestaetigungen).toHaveLength(1)
  expect(info.daten.freigabelisten).toEqual([{ abstimmung: 'Wohin?' }])
  expect(JSON.stringify(info)).not.toMatch(/sessionHash|tokenHash/)

  expect(run(email, '--loeschen')).toMatchObject({ modus: 'probe', loeschen: { stimmenAnonymisiert: 1, bestaetigungen: 1 } })
  run(email, '--loeschen', '--ja')
  const votes = await prisma.vote.findMany({ where: { pollId: poll.id }, orderBy: { optionId: 'asc' } })
  // Ergebnis unverändert, aber ohne die Adresse
  expect(votes).toHaveLength(2)
  expect(votes.some(v => v.voterKey.includes(email))).toBe(false)
  expect(await prisma.emailVoter.count({ where: { pollId: poll.id } })).toBe(0)
  // Leere Liste hieße „jede Adresse“ - bleibt eine, die auf niemanden passt
  expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).allowedEmails).toBe('@geloescht.invalid')
  expect(run(email).daten.stimmen).toEqual([])
})
