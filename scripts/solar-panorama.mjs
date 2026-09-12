import { chromium } from 'playwright'
import sharp from 'sharp'
import { PLANET_COLORS } from '../lib/planets.ts'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
})
const guards = []
const stage = async (viewport, deviceScaleFactor) => {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  guards.push(await installLoopbackRequestGuard(context))
  return context
}
const context = await stage({ width: 1600, height: 1000 }, 1)
const base = resolveE2EBaseUrl()
const interface_ =
  'body * { visibility: hidden !important; } [data-solar-stage], [data-solar-stage] * { visibility: visible !important; }'

async function capture(target, focus, source = context) {
  const page = await source.newPage()
  await page.goto(focus ? `${base}/#${focus}` : base)
  await page.locator('[data-solar-ready="true"]').waitFor({ timeout: 30000 })
  if (focus) {
    await page.getByRole('button', { name: '近地', exact: true }).click()
    await page.waitForTimeout(2500)
  }
  await page.addStyleTag({ content: interface_ })
  await page.waitForTimeout(300)
  await sharp(await page.locator('[data-solar-canvas]').screenshot())
    .webp({ quality: 88 })
    .toFile(target)
  await page.close()
  console.log(`Saved ${target}`)
}

await capture('public/models/solar-panorama.webp')
await capture(
  'public/models/solar-portrait.webp',
  undefined,
  await stage({ width: 1170, height: 2532 }, 1),
)
for (const slug of PLANET_COLORS.keys()) await capture(`public/models/planet-${slug}.webp`, slug)
guards.forEach(guard => guard.assertSafe())
await browser.close()
