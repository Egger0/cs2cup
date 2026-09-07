export const VARIANT_WIDTHS = [480, 960, 1600, 2560] as const

const VARIANT_KEY_PATTERN = /^(.+)\.([1-9][0-9]*)\.webp$/

export function variantStorageKey(baseKey: string, width: number) {
  const stem = baseKey.replace(/\.[a-z0-9]+$/i, '')
  return `${stem}.${width}.webp`
}

export function parseVariantKey(key: string) {
  const match = VARIANT_KEY_PATTERN.exec(key)
  if (!match) return null
  const [, stem, width] = match
  if (!stem || !width) return null
  return { stem, width: Number(width) }
}

export function plannedVariantWidths(imageWidth: number) {
  const fitting = VARIANT_WIDTHS.filter(width => width <= imageWidth)
  return fitting.length ? [...fitting] : [VARIANT_WIDTHS[0]]
}

export function variantStemMatches(storageKey: string, stem: string) {
  if (!storageKey.startsWith(`${stem}.`)) return false
  const suffix = storageKey.slice(stem.length + 1)
  return suffix.length > 0 && !suffix.includes('/')
}
