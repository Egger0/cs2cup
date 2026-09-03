import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const BASE = resolveE2EBaseUrl()
const PAGES = [
  '/',
  '/games',
  '/games/cs2',
  '/tournaments',
  '/tournaments/2026-nlc',
  '/tournaments/2026-nlc/schedule?state=all',
  '/tournaments/2026-nlc/teams',
  '/tournaments/2026-nlc/bracket',
  '/tournaments/2026-nlc/results',
  '/tournaments/2026-nlc/rules',
  '/tournaments/2026-nlc/register',
  '/archive',
  '/news',
  '/about',
  '/search',
  '/admin/login?error=rate',
]

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: 'block',
})
const outboundGuard = await installLoopbackRequestGuard(ctx)
const page = await ctx.newPage()

let total = 0
const byRule = new Map()

for (const path of PAGES) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.evaluate(() => {
    document.querySelectorAll('[data-rise]').forEach(el => {
      el.style.setProperty('animation', 'none', 'important')
      el.style.setProperty('opacity', '1', 'important')
    })
  })

  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  const count = violations.reduce((sum, v) => sum + v.nodes.length, 0)
  total += count
  for (const violation of violations) {
    const entry = byRule.get(violation.id) ?? {
      impact: violation.impact,
      nodes: 0,
      pages: new Set(),
      help: violation.help,
    }
    entry.nodes += violation.nodes.length
    entry.pages.add(path)
    byRule.set(violation.id, entry)
  }
  console.log(`${count === 0 ? 'PASS' : 'FAIL'}  ${path.padEnd(36)} ${count} issues`)
}

console.log('\n=== Summary ===')
for (const [rule, entry] of [...byRule.entries()].sort((a, b) => b[1].nodes - a[1].nodes)) {
  console.log(
    `${(entry.impact ?? '?').padEnd(9)} ${rule.padEnd(30)} ${entry.nodes} occurrences / ${entry.pages.size} pages`,
  )
  console.log(`          ${entry.help}`)
}
console.log(`\nTotal: ${total} issues`)
await browser.close()
outboundGuard.assertSafe()
if (total > 0) process.exit(1)
