import { mkdir } from 'node:fs/promises'

export async function captureResponsiveScreens(page, name) {
  const original = page.viewportSize()
  await mkdir('output/playwright', { recursive: true })
  try {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await page.screenshot({
        path: `output/playwright/frontend-${name}-${width}.png`,
        fullPage: true,
      })
    }
  } finally {
    if (original) await page.setViewportSize(original)
  }
}
