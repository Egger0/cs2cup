import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

const STORAGE_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/

export function assertStorageKey(key: string) {
  if (
    !STORAGE_KEY_PATTERN.test(key)
    || key.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw new Error('Invalid photo storage key')
  }
}

export function resolveLocalObjectPath(root: string, key: string) {
  assertStorageKey(key)
  const resolvedRoot = resolve(root)
  const target = resolve(resolvedRoot, key)
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`
  if (!target.startsWith(rootPrefix)) {
    throw new Error('Photo storage key escapes the configured root')
  }
  return target
}

export async function putLocalObject(root: string, key: string, body: Uint8Array) {
  const target = resolveLocalObjectPath(root, key)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, body)
}

export async function getLocalObject(root: string, key: string) {
  return readFile(resolveLocalObjectPath(root, key))
}

export async function removeLocalObject(root: string, key: string) {
  const target = resolveLocalObjectPath(root, key)
  try {
    await unlink(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
