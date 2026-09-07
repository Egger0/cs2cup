import assert from 'node:assert/strict'
import { createMigratedDatabase } from './sqlite-fixture.mjs'

const database = await createMigratedDatabase()

try {
  const columns = database.prepare('PRAGMA table_info(photo)').all()
  const variant = columns.find(column => column.name === 'variant_widths')
  assert.ok(variant, 'photo.variant_widths must exist')
  assert.equal(variant.notnull, 1)

  const publicColumns = database.prepare('PRAGMA table_info(photo_public)').all()
  assert.ok(
    publicColumns.some(column => column.name === 'variant_widths'),
    'photo_public must expose variant_widths',
  )

  database.exec("INSERT INTO game (id, slug, name, sort_order) VALUES (1, 'cs2', 'CS2', 0)")
  database.exec(
    "INSERT INTO tournament (id, game_id, slug, title, season, edition, status, team_cap) VALUES (1, 1, 'x', 'X', '2026春季', 1, 'finished', 16)",
  )
  database.exec(
    "INSERT INTO photo (id, tournament_id, storage_key, width, height) VALUES (1, 1, 'x/a.webp', 100, 100)",
  )
  const row = database.prepare('SELECT variant_widths FROM photo_public WHERE id = 1').get()
  assert.equal(row.variant_widths, '[]')

  console.log('photo variant schema tests passed')
} finally {
  database.close()
}
