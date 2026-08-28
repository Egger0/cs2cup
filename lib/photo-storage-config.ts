import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export function resolvePhotoLocalRoot(
  configured = process.env.PHOTO_LOCAL_ROOT,
  temporaryDirectory = tmpdir(),
) {
  const root = configured?.trim() || join(temporaryDirectory, 'cs2cup-photos')
  if (!isAbsolute(root)) {
    throw new Error('PHOTO_LOCAL_ROOT must be an absolute path when configured')
  }
  return root
}
