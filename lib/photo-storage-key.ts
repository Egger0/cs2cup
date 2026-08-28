import { randomUUID } from 'node:crypto'

import { assertStorageKey } from './local-object-storage.ts'

export function createPhotoStorageKey(tournamentSlug: string, extension: string) {
  const key = `${tournamentSlug}/${randomUUID()}.${extension}`
  assertStorageKey(key)
  return key
}
