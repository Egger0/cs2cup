import { access, cp, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const copies = [
  ['public', '.next/standalone/public'],
  ['.next/static', '.next/standalone/.next/static'],
  ['THIRD_PARTY_NOTICES.md', '.next/standalone/THIRD_PARTY_NOTICES.md'],
]

async function findEnvironmentFiles(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }

  const matches = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.name === '.env' || entry.name.startsWith('.env.')) {
      matches.push(path)
    } else if (entry.isDirectory()) {
      matches.push(...await findEnvironmentFiles(path))
    }
  }
  return matches
}

export async function packStandalone(root = process.cwd()) {
  const privatePhotoSource = resolve(root, 'public', 'photos')
  for (const [from, to] of copies) {
    const source = join(root, from)
    try {
      await access(source, constants.R_OK)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    await cp(source, join(root, to), {
      recursive: true,
      force: true,
      filter: candidate => {
        const absoluteCandidate = resolve(candidate)
        return absoluteCandidate !== privatePhotoSource
          && !absoluteCandidate.startsWith(`${privatePhotoSource}${sep}`)
      },
    })
    console.log('copied', from)
  }

  const standaloneRoot = join(root, '.next', 'standalone')
  await rm(join(standaloneRoot, 'public', 'photos'), { recursive: true, force: true })
  const environmentFiles = await findEnvironmentFiles(standaloneRoot)
  for (const path of environmentFiles) {
    await rm(path, { recursive: true, force: true })
    console.log('removed environment file from standalone output')
  }
  if ((await findEnvironmentFiles(standaloneRoot)).length > 0) {
    throw new Error('Standalone output still contains environment files')
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) await packStandalone()
