import { chromium, devices } from 'playwright'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const BASE = resolveE2EBaseUrl()

const BUDGET = {
  transferKb: 700,
  jsKb: 180,
  imageKb: 260,
  fontKb: 320,
  lcpMs: 2000,
  clsScore: 0.1,
  requests: 60,
}

const PAGE_BUDGET = {
  '/archive': {
    transferKb: 1200,
    imageKb: 700,
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
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  })
  const outboundGuard = await installLoopbackRequestGuard(ctx)
  const page = await ctx.newPage()

  const sizes = { total: 0, js: 0, css: 0, image: 0, font: 0 }
  let requests = 0

  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  const kinds = new Map()
  const prefetches = new Set()

  cdp.on('Network.responseReceived', event => {
    kinds.set(event.requestId, event.type)
    if (event.response.url.includes('_rsc=')) prefetches.add(event.requestId)
  })

  cdp.on('Network.loadingFinished', event => {
    if (prefetches.has(event.requestId)) return
    requests += 1
    const bytes = event.encodedDataLength ?? 0
    const type = (kinds.get(event.requestId) ?? '').toLowerCase()
    sizes.total += bytes
    if (type === 'script') sizes.js += bytes
    else if (type === 'stylesheet') sizes.css += bytes
    else if (type === 'image') sizes.image += bytes
    else if (type === 'font') sizes.font += bytes
  })

  const response = await page.goto(BASE + path, { waitUntil: 'load' })
  if (!response?.ok()) {
    failed += 1
    console.log(`FAIL  ${path.padEnd(32)} HTTP ${response?.status() ?? 'no response'}`)
    outboundGuard.assertSafe()
    await ctx.close()
    continue
  }
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
  outboundGuard.assertSafe()
  await ctx.close()
}

const MOBILE_LCP_MS = 2500
const IDLE_BUSY_MS = 80

for (const path of ['/', '/news']) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' })
  const guard = await installLoopbackRequestGuard(ctx)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.addInitScript(() => {
    window.__lcp = 0
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__lcp = entry.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  })
  await page.goto(BASE + path, { waitUntil: 'load' })
  await page.waitForTimeout(3500)
  const lcp = Math.round(await page.evaluate(() => window.__lcp))
  const slow = lcp > MOBILE_LCP_MS
  if (slow) failed += 1
  rows.push({ path })
  console.log(
    `${slow ? 'FAIL' : 'PASS'}  ${path.padEnd(32)} throttled mobile LCP ${lcp}ms (4x CPU, 1.6 Mbps)`,
  )
  guard.assertSafe()
  await ctx.close()
}

{
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' })
  const guard = await installLoopbackRequestGuard(ctx)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await page.goto(BASE + '/news', { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  await cdp.send('Performance.enable')
  const busy = async () =>
    (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'TaskDuration').value
  const before = await busy()
  await page.waitForTimeout(5000)
  const idle = Math.round(((await busy()) - before) * 1000)
  const heavy = idle > IDLE_BUSY_MS
  if (heavy) failed += 1
  rows.push({ path: 'idle' })
  console.log(
    `${heavy ? 'FAIL' : 'PASS'}  ${'/news idle'.padEnd(32)} main thread busy ${idle}ms in 5s (budget ${IDLE_BUSY_MS}ms)`,
  )
  guard.assertSafe()
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
