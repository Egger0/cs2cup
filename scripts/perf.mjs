import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

// 预算按实测设定,留出约 15% 余量。字体占比高是刻意的:
// 中文重磅标题是这个站的视觉识别,不是可有可无的装饰。
const BUDGET = {
  transferKb: 700,
  jsKb: 180,
  imageKb: 260,
  fontKb: 320,
  lcpMs: 2000,
  clsScore: 0.1,
  requests: 60,
}

const PAGES = ['/', '/tournaments/2026-nlc', '/tournaments/2026-nlc/bracket', '/archive']

const browser = await chromium.launch()
const rows = []
let failed = 0

for (const path of PAGES) {
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
  if (row.transferKb > BUDGET.transferKb) over.push(`总量 ${row.transferKb}KB`)
  if (row.jsKb > BUDGET.jsKb) over.push(`JS ${row.jsKb}KB`)
  if (row.imageKb > BUDGET.imageKb) over.push(`图片 ${row.imageKb}KB`)
  if (row.fontKb > BUDGET.fontKb) over.push(`字体 ${row.fontKb}KB`)
  if (row.lcp > BUDGET.lcpMs) over.push(`LCP ${row.lcp}ms`)
  if (row.cls > BUDGET.clsScore) over.push(`CLS ${row.cls}`)
  if (row.requests > BUDGET.requests) over.push(`请求 ${row.requests}`)

  if (over.length) failed += 1
  console.log(
    `${over.length ? 'FAIL' : 'PASS'}  ${path.padEnd(32)} ` +
      `${String(row.transferKb).padStart(4)}KB  JS ${String(row.jsKb).padStart(3)}KB  ` +
      `IMG ${String(row.imageKb).padStart(3)}KB  字体 ${String(row.fontKb).padStart(3)}KB  ` +
      `LCP ${String(row.lcp).padStart(4)}ms  ` +
      `CLS ${row.cls}  ${row.requests} 请求` +
      (over.length ? `  超出: ${over.join(', ')}` : ''),
  )
  await ctx.close()
}

console.log(
  `\n预算: 总量 ${BUDGET.transferKb}KB · JS ${BUDGET.jsKb}KB · 图片 ${BUDGET.imageKb}KB · ` +
    `字体 ${BUDGET.fontKb}KB · LCP ${BUDGET.lcpMs}ms · CLS ${BUDGET.clsScore} · 请求 ${BUDGET.requests}`,
)
console.log(`${rows.length - failed}/${rows.length} 页在预算内`)
await browser.close()
if (failed) process.exit(1)
