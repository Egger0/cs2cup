const STORAGE_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/
export const MAX_STORAGE_KEY_LENGTH = 1024

export function assertStorageKey(key: string) {
  if (
    key.length > MAX_STORAGE_KEY_LENGTH
    || !STORAGE_KEY_PATTERN.test(key)
    || key.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw new Error('Invalid photo storage key')
  }
}

export function contentTypeForStorageKey(key: string) {
  assertStorageKey(key)
  const extension = key.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'avif') return 'image/avif'
  return 'application/octet-stream'
}

export function safeContentTypeForStorageKey(
  key: string,
  storedContentType: string | undefined,
) {
  const inferred = contentTypeForStorageKey(key)
  return storedContentType === inferred ? storedContentType : inferred
}
