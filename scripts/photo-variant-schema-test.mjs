import assert from 'node:assert/strict'
import { createMigratedDatabase } from './sqlite-fixture.mjs'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

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

  database.exec(
    "INSERT INTO photo (storage_key,width,height,activity_name) VALUES ('club-activities/recruitment.webp',100,100,'2026年9月线下招新')",
  )
  assert.equal(
    database.prepare('SELECT COUNT(*) AS n FROM photo_public WHERE tournament_id IS NULL').get().n,
    1,
  )
  for (const activity of [null, '', '   ', 'x'.repeat(101)]) {
    assert.throws(
      () =>
        database
          .prepare('INSERT INTO photo (storage_key,width,height,activity_name) VALUES (?,?,?,?)')
          .run('invalid.webp', 100, 100, activity),
      /CHECK constraint/,
    )
  }
  assert.throws(
    () =>
      database.exec(
        "INSERT INTO photo (tournament_id,activity_name,storage_key,width,height) VALUES (1,'Event','invalid.webp',100,100)",
      ),
    /CHECK constraint/,
  )
  database.exec("UPDATE tournament SET status = 'draft' WHERE id = 1")
  assert.equal(
    database.prepare('SELECT COUNT(*) AS n FROM photo_public WHERE tournament_id = 1').get().n,
    0,
  )
  assert.equal(
    database.prepare('SELECT COUNT(*) AS n FROM photo_public WHERE tournament_id IS NULL').get().n,
    1,
  )
  database.exec('DELETE FROM tournament WHERE id = 1')
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM photo').get().n, 1)
} finally {
  database.close()
}

const upgrade = new DatabaseSync(':memory:')
try {
  upgrade.exec('PRAGMA foreign_keys = ON')
  for (const migration of ['0001_schema.sql', '0027_photo_display_variants.sql']) {
    upgrade.exec(await readFile(new URL(`../cloudflare/d1/${migration}`, import.meta.url), 'utf8'))
  }
  upgrade.exec(
    "INSERT INTO tournament (id,slug,title,season,edition,status,team_cap) VALUES (1,'old','Old','2026',1,'finished',8)",
  )
  upgrade.exec(
    "INSERT INTO photo (id,tournament_id,storage_key,width,height,caption,sort_order,blur_data_url,created_at,variant_widths) VALUES (7,1,'old/a.webp',100,80,'Existing',2,'data:image/webp;base64,AA','2026-09-01','[480,960]')",
  )
  const before = upgrade.prepare('SELECT * FROM photo').get()
  upgrade.exec(
    await readFile(
      new URL('../cloudflare/d1/0046_club_activity_photos.sql', import.meta.url),
      'utf8',
    ),
  )
  const after = upgrade.prepare('SELECT * FROM photo').get()
  delete after.activity_name
  assert.deepEqual(after, before, 'the upgrade must preserve every existing photo field')
  assert.deepEqual(upgrade.prepare('PRAGMA foreign_key_check').all(), [])
} finally {
  upgrade.close()
}
console.log('photo variants and activity upgrade schema tests passed')
