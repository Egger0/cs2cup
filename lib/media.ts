export function photoUrl(storageKey: string) {
  return `/media/${storageKey.replace(/^\//, '')}`
}
