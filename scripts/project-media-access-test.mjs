import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { scoreCorrectionFixture } from './score-correction-fixture.mjs'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const authModule = dataModule(`
  export async function requireAdmin() {
    if (!globalThis.__photoOwner) throw new Error('forbidden')
  }
  export async function requireTournamentStaffCapability(id, capability) {
    if (capability !== 'tournament.media.manage') throw new Error('wrong capability')
    if (!globalThis.__photoOwner && id !== 1) throw new Error('forbidden')
  }
`)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === '../../auth') return { url: authModule, shortCircuit: true }
    if (specifier.endsWith('cloudflare-bindings')) {
      return {
        url: dataModule(
          'export function cloudflareBindings(){return globalThis.__scoreCorrectionBindings}',
        ),
        shortCircuit: true,
      }
    }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const photos = await import('../lib/queries/content/photos.ts')
const database = scoreCorrectionFixture()
database.exec(`CREATE TABLE photo (
  id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL, storage_key TEXT NOT NULL,
  width INTEGER, height INTEGER, caption TEXT, sort_order INTEGER,
  blur_data_url TEXT, variant_widths TEXT
)`)
const values = tournamentId => ({
  tournamentId,
  storageKey: `event-${tournamentId}/photo.webp`,
  width: 100,
  height: 100,
  caption: null,
  sortOrder: 0,
  blurDataUrl: null,
  variantWidths: [],
})

try {
  globalThis.__photoOwner = true
  await photos.adminInsertPhoto(values(2))
  const foreignId = database.prepare('SELECT id FROM photo WHERE tournament_id = 2').get().id
  globalThis.__photoOwner = false
  await photos.adminInsertPhoto(values(1))
  const own = await photos.adminListPhotos([1])
  assert.equal(own.length, 1)
  assert.equal(own[0].tournamentId, 1)
  assert.deepEqual(await photos.adminListPhotos([]), [])
  await assert.rejects(photos.adminListPhotos(), /forbidden/)
  await assert.rejects(photos.adminListPhotos([1, 2]), /forbidden/)
  await assert.rejects(photos.adminGetPhoto(foreignId), /forbidden/)
  await assert.rejects(photos.adminInsertPhoto(values(2)), /forbidden/)
  await assert.rejects(
    photos.adminAttachPhotoVariants({ id: foreignId, blurDataUrl: null, variantWidths: [480] }),
    /forbidden/,
  )
  await assert.rejects(photos.adminDeletePhoto(foreignId), /forbidden/)
  await photos.adminAttachPhotoVariants({ id: own[0].id, blurDataUrl: null, variantWidths: [480] })
  assert.deepEqual((await photos.adminGetPhoto(own[0].id)).variantWidths, [480])
  await photos.adminDeletePhoto(own[0].id)
  assert.equal(await photos.adminGetPhoto(own[0].id), null)
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM photo').get().n, 1)
  globalThis.__photoOwner = true
  assert.equal((await photos.adminListPhotos()).length, 1)
  await photos.adminDeletePhoto(foreignId)
  console.log('project media access tests passed')
} finally {
  database.close()
}
