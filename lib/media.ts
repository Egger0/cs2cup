export function photoUrl(storageKey: string) {
  if (/^https?:\/\//.test(storageKey)) return storageKey
  const base = process.env.NEXT_PUBLIC_PHOTO_BASE_URL ?? ''
  const key = storageKey.replace(/^\//, '')
  return base ? `${base.replace(/\/$/, '')}/${key}` : `/media/${key}`
}
