import assert from 'node:assert/strict'

import sharp from 'sharp'

export async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `${label} overflows horizontally: ${dimensions.scrollWidth}px > ${dimensions.clientWidth}px`,
  )
}

export async function assertLightSurface(locator, label) {
  const buffer = await locator.screenshot({ animations: 'disabled' })
  const stats = await sharp(buffer).removeAlpha().stats()
  const [red, green, blue] = stats.channels
  const luminance = red.mean * 0.2126 + green.mean * 0.7152 + blue.mean * 0.0722
  assert.ok(luminance >= 180, `${label} is unexpectedly obscured (${luminance.toFixed(1)})`)
}

export async function assertStacked(first, second, label) {
  const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()])
  assert.ok(firstBox, `${label}: first region is not visible`)
  assert.ok(secondBox, `${label}: second region is not visible`)
  assert.ok(
    secondBox.y >= firstBox.y + firstBox.height - 1,
    `${label}: regions still share a cramped row`,
  )
}

export async function assertMinimumTapHeight(locator, label, minimum = 40) {
  const boxes = await locator.evaluateAll(elements =>
    elements.map(element => {
      const box = element.getBoundingClientRect()
      return { label: element.textContent?.trim() ?? element.tagName, height: box.height }
    }),
  )
  const undersized = boxes.filter(box => box.height + 0.5 < minimum)
  assert.deepEqual(undersized, [], `${label} has undersized tap targets`)
}
