export function photoUrl(storageKey: string) {
  if (/^https?:\/\//.test(storageKey)) return storageKey
  const base = process.env.NEXT_PUBLIC_PHOTO_BASE_URL ?? ''
  return `${base.replace(/\/$/, '')}/${storageKey.replace(/^\//, '')}`
}
