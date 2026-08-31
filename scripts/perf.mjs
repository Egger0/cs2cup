import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

// Budgets keep roughly 15% headroom and retain the site's display font.
const BUDGET = {
  transferKb: 700,
  jsKb: 180,
  imageKb: 260,
  fontKb: 320,
  lcpMs: 2000,
  clsScore: 0.1,
  requests: 60,
}

// Keep the guarded archive ceiling until authorization-aware thumbnails replace originals.
const PAGE_BUDGET = {
  '/archive': {
    transferKb: 2400,
    imageKb: 2100,
  },
}

const PAGES = [
  '/',
  '/tournaments/2026-nlc',
  '/tournaments/2026-nlc/schedule?state=all',
  '/tournaments/2026-nlc/bracket',
  '/archive',
]

const browser = await chromium.launch()
const rows = []
let failed = 0

for (const path of PAGES) {
  const budget = { ...BUDGET, ...PAGE_BUDGET[path] }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()

  const sizes = { total: 0, js: 0, css: 0, image: 0, font: 0 }
  let requests = 0

  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  const kinds = new Map()

  cdp.on('Network.responseReceived', event => {
    kinds.set(event.requestId, event.type)
  })

  cdp.on('Network.loadingFinished', event => {
    requests += 1
    const bytes = event.encodedDataLength ?? 0
    const type = (kinds.get(event.requestId) ?? '').toLowerCase()
    sizes.total += bytes
    if (type === 'script') sizes.js += bytes
    else if (type === 'stylesheet') sizes.css += bytes
    else if (type === 'image') sizes.image += bytes
    else if (type === 'font') sizes.font += bytes
  })

  await page.goto(BASE + path, { waitUntil: 'load' })
  await page.waitForTimeout(2500)

  const vitals = await page.evaluate(
    () =>
      new Promise(resolve => {
        let lcp = 0
        let cls = 0
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) lcp = entry.startTime
        }).observe({ type: 'largest-contentful-paint', buffered: true })
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const shift = entry
            if (!shift.hadRecentInput) cls += shift.value
          }
        }).observe({ type: 'layout-shift', buffered: true })
        setTimeout(() => resolve({ lcp: Math.round(lcp), cls: +cls.toFixed(4) }), 900)
      }),
  )

  const kb = n => Math.round(n / 1024)
  const row = {
    path,
    transferKb: kb(sizes.total),
    jsKb: kb(sizes.js),
    imageKb: kb(sizes.image),
    fontKb: kb(sizes.font),
    lcp: vitals.lcp,
    cls: vitals.cls,
    requests,
  }
  rows.push(row)

  const over = []
  if (row.transferKb > budget.transferKb) over.push(`total ${row.transferKb}KB`)
  if (row.jsKb > budget.jsKb) over.push(`JS ${row.jsKb}KB`)
  if (row.imageKb > budget.imageKb) over.push(`images ${row.imageKb}KB`)
  if (row.fontKb > budget.fontKb) over.push(`fonts ${row.fontKb}KB`)
  if (row.lcp > budget.lcpMs) over.push(`LCP ${row.lcp}ms`)
  if (row.cls > budget.clsScore) over.push(`CLS ${row.cls}`)
  if (row.requests > budget.requests) over.push(`requests ${row.requests}`)

  if (over.length) failed += 1
  console.log(
    `${over.length ? 'FAIL' : 'PASS'}  ${path.padEnd(32)} ` +
      `${String(row.transferKb).padStart(4)}KB  JS ${String(row.jsKb).padStart(3)}KB  ` +
      `IMG ${String(row.imageKb).padStart(3)}KB  FONT ${String(row.fontKb).padStart(3)}KB  ` +
      `LCP ${String(row.lcp).padStart(4)}ms  ` +
      `CLS ${row.cls}  ${row.requests} requests` +
      (over.length ? `  over budget: ${over.join(', ')}` : ''),
  )
  await ctx.close()
}

console.log(
  `\nBudget: total ${BUDGET.transferKb}KB · JS ${BUDGET.jsKb}KB · images ${BUDGET.imageKb}KB · ` +
    `fonts ${BUDGET.fontKb}KB · LCP ${BUDGET.lcpMs}ms · CLS ${BUDGET.clsScore} · requests ${BUDGET.requests}`,
)
console.log(
  `Temporary archive ceiling: total ${PAGE_BUDGET['/archive'].transferKb}KB · ` +
    `images ${PAGE_BUDGET['/archive'].imageKb}KB`,
)
console.log(`${rows.length - failed}/${rows.length} pages within budget`)
await browser.close()
if (failed) process.exit(1)
