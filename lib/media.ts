export function photoUrl(storageKey: string) {
  return `/media/${storageKey.replace(/^\//, '')}`
}

export function adminPhotoUrl(storageKey: string) {
  return `/admin/media/${storageKey.replace(/^\//, '')}`
}
