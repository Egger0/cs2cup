import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const temporaryRoot = await mkdtemp(join(tmpdir(), 'cs2cup-standalone-pack-test-'))
const sentinel = 'SOURCE_SECRET_SENTINEL_MUST_NOT_ENTER_STANDALONE'

async function fixture(path, contents) {
  const target = join(temporaryRoot, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents)
}

async function outputFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await outputFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

try {
  await fixture('public/brand/probe.txt', 'public')
  await fixture('public/photos/private.jpg', sentinel)
  await fixture('.next/static/probe.txt', 'static')
  await fixture('THIRD_PARTY_NOTICES.md', 'font notices')
  await fixture('.env.local', sentinel)
  await fixture('public/nested/.env.local', sentinel)
  await fixture('.next/standalone/.env.production', sentinel)
  await fixture('.next/standalone/nested/trace/.env.local', sentinel)
  await fixture('.next/standalone/public/photos/stale.jpg', sentinel)

  const { packStandalone } = await import(
    new URL('../scripts/pack-standalone.mjs', import.meta.url)
  )
  await packStandalone(temporaryRoot)
  assert.equal(
    await readFile(join(temporaryRoot, '.next/standalone/public/brand/probe.txt'), 'utf8'),
    'public',
  )
  assert.equal(
    await readFile(join(temporaryRoot, '.next/standalone/.next/static/probe.txt'), 'utf8'),
    'static',
  )
  assert.equal(
    await readFile(join(temporaryRoot, '.next/standalone/THIRD_PARTY_NOTICES.md'), 'utf8'),
    'font notices',
  )
  assert.equal(
    await readFile(join(temporaryRoot, '.env.local'), 'utf8'),
    sentinel,
  )
  await assert.rejects(
    readFile(join(temporaryRoot, '.next/standalone/public/photos/private.jpg'), 'utf8'),
    error => error.code === 'ENOENT',
  )
  await assert.rejects(
    readFile(join(temporaryRoot, '.next/standalone/public/photos/stale.jpg'), 'utf8'),
    error => error.code === 'ENOENT',
  )
  const outputEntries = await readdir(join(temporaryRoot, '.next/standalone'))
  assert.equal(
    outputEntries.some(entry => entry === '.env' || entry.startsWith('.env.')),
    false,
  )
  for (const path of await outputFiles(join(temporaryRoot, '.next/standalone'))) {
    assert.equal(basename(path) === '.env' || basename(path).startsWith('.env.'), false)
    assert.equal((await readFile(path, 'utf8')).includes(sentinel), false)
  }

  console.log('standalone packaging boundary tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
