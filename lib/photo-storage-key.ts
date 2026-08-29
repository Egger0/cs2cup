import { randomUUID } from 'node:crypto'

import { assertStorageKey } from './object-storage/key.ts'

export function createPhotoStorageKey(tournamentSlug: string, extension: string) {
  const key = `${tournamentSlug}/${randomUUID()}.${extension}`
  assertStorageKey(key)
  return key
}
