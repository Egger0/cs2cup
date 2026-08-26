import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const results = []
const check = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()

await page.goto(`${BASE}/tournaments/2026-nlc`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

await page.keyboard.press('Tab')
const first = await page.evaluate(() => {
  const el = document.activeElement
  return { tag: el?.tagName, text: (el?.textContent ?? '').trim().slice(0, 20), href: el?.getAttribute('href') }
})
check('存在跳到主内容的链接', first.href === '#main' || first.text.includes('主内容'), `${first.tag} ${first.text}`)

const focusable = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
  return nodes.filter(n => n.getBoundingClientRect().height > 0).length
})
check('可聚焦元素存在', focusable > 5, `${focusable} 个`)

const invisibleFocus = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('a[href],button')].filter(
    n => n.getBoundingClientRect().height > 0,
  )
  let bad = 0
  for (const node of nodes.slice(0, 40)) {
    node.focus()
    const style = getComputedStyle(node)
    const ring =
      style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
    const shadow = style.boxShadow !== 'none'
    if (!ring && !shadow) bad += 1
  }
  return bad
})
check('聚焦时有可见指示', invisibleFocus === 0, `${invisibleFocus} 个无指示`)

const landmarks = await page.evaluate(() => ({
  header: document.querySelectorAll('header').length,
  nav: document.querySelectorAll('nav').length,
  main: document.querySelectorAll('main').length,
  footer: document.querySelectorAll('footer').length,
}))
check('地标齐全', landmarks.main === 1 && landmarks.nav >= 1 && landmarks.footer === 1, JSON.stringify(landmarks))

await page.goto(`${BASE}/archive`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
await page.locator('button[class*="poster"]').first().focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(700)
const dialogOpen = await page.locator('dialog[open]').count()
check('键盘可打开灯箱', dialogOpen === 1)

const focusInDialog = await page.evaluate(() => {
  const dialog = document.querySelector('dialog[open]')
  return dialog ? dialog.contains(document.activeElement) : false
})
check('焦点进入对话框', focusInDialog)

await page.keyboard.press('Escape')
await page.waitForTimeout(600)
check('Esc 关闭灯箱', (await page.locator('dialog[open]').count()) === 0)

const returned = await page.evaluate(() => document.activeElement?.tagName)
check('关闭后焦点回到页面', returned !== 'BODY', String(returned))

const mobile = await ctx.newPage()
await mobile.setViewportSize({ width: 390, height: 760 })
await mobile.goto(BASE, { waitUntil: 'domcontentloaded' })
await mobile.waitForTimeout(1000)
await mobile.locator('[aria-controls="site-nav"]').focus()
await mobile.keyboard.press('Enter')
await mobile.waitForTimeout(600)
check('键盘可开移动端抽屉', await mobile.locator('#site-nav a').first().isVisible())
check(
  '抽屉状态已声明',
  (await mobile.locator('[aria-controls="site-nav"]').getAttribute('aria-expanded')) === 'true',
)
await mobile.close()

await browser.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
if (failed) process.exit(1)
