const STORAGE_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/

export function assertStorageKey(key: string) {
  if (
    !STORAGE_KEY_PATTERN.test(key)
    || key.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw new Error('Invalid photo storage key')
  }
}
