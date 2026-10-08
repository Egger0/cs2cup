export function photoUrl(storageKey: string) {
  return `/media/${storageKey.replace(/^\//, '')}`
}

export function officialImageUrl(source: string, width?: number) {
  return `${source}?imageMogr2/${width ? `thumbnail/${width}x/` : ''}format/webp`
}
