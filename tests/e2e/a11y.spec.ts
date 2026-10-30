import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createAccount, createPoll, login } from './helpers'

// Barrierefreiheit (Idee Q11, suite-kit docs/KONVENTIONEN.md „Tests“): axe prüft die wichtigsten Seiten für Gäste und
// Verwaltung nach WCAG 2.1 A/AA, hell und dunkel. Ein Befund lässt den Test scheitern - Ausnahmen nur mit Begründung
// hier im Test.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** Prüft jede Seite hell und dunkel und meldet alle Befunde auf einmal (Seite, Schema, Regel, Elemente). */
async function check(page: Page, paths: string[]) {
  const found: string[] = []
  for (const path of paths) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
      for (const v of violations) {
        found.push(`${path} (${colorScheme}) ${v.id}: ${v.help}\n${v.nodes.slice(0, 6).map(n => `    ${n.target.join(' ')} | ${n.html.slice(0, 160)} | ${n.failureSummary?.split('\n').slice(1).join(' ')}`).join('\n')}`)
      }
    }
  }
  expect(found).toEqual([])
}

test('Seiten für Abstimmende', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { title: 'Wohin zum Essen?' })
  await check(page, ['/', `/${poll.id}`, '/anmelden', '/passwort-vergessen', '/impressum', '/datenschutz'])
})

test('Seiten der Verwaltung', async ({ page }) => {
  const owner = await createAccount()
  const poll = await createPoll(owner.id, { title: 'Wohin zum Essen?' })
  await login(page, owner.email)
  await check(page, ['/meine-abstimmungen', '/erstellen', `/${poll.id}/verwalten`, '/konto', '/fragebogen/neu', '/sitzung/neu', '/live/neu'])
})
