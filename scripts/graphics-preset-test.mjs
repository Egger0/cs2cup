import assert from 'node:assert/strict'
import { graphicsSettingGroups, parseGraphicsSettings } from '../lib/graphics-settings.ts'
import { createMigratedDatabase } from './sqlite-fixture.mjs'

assert.deepEqual(
  parseGraphicsSettings(
    'Resolution = 1920x1080\n\n# Advanced\nShadows: Low\nDLSS：Quality\nFrame cap = 144 = fixed',
  ),
  {
    ok: true,
    groups: [
      { name: '', items: [['Resolution', '1920x1080']] },
      {
        name: 'Advanced',
        items: [
          ['Shadows', 'Low'],
          ['DLSS', 'Quality'],
          ['Frame cap', '144 = fixed'],
        ],
      },
    ],
  },
)
assert.deepEqual(parseGraphicsSettings('# Empty\n# Filled\nA = 1'), {
  ok: true,
  groups: [{ name: 'Filled', items: [['A', '1']] }],
})
assert.deepEqual(parseGraphicsSettings('Shadows Low'), { ok: false, line: 'Shadows Low' })
assert.deepEqual(parseGraphicsSettings('Shadows ='), { ok: false, line: 'Shadows =' })
assert.deepEqual(parseGraphicsSettings('#'), { ok: false, line: '#' })
assert.deepEqual(parseGraphicsSettings(' \n# Only a heading'), { ok: false, line: '' })
assert.deepEqual(graphicsSettingGroups('nonsense'), [])

const database = await createMigratedDatabase()
try {
  database.exec("INSERT INTO game (id, slug, name, sort_order) VALUES (1, 'cs2', 'CS2', 0)")
  const insert = database.prepare(
    'INSERT INTO graphics_preset (game_id, title, hardware, settings) VALUES (?, ?, ?, ?)',
  )
  insert.run(1, 'Mid-range 144', 'RTX 4060', 'Shadows = Low')
  for (const row of [
    [2, 'Unknown game', 'RTX 4060', 'A = 1'],
    [1, '', 'RTX 4060', 'A = 1'],
    [1, 'No hardware', '', 'A = 1'],
    [1, 'No settings', 'RTX 4060', ''],
    [1, 'x'.repeat(61), 'RTX 4060', 'A = 1'],
  ]) {
    assert.throws(() => insert.run(...row), row[1])
  }
  database.exec('DELETE FROM game WHERE id = 1')
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM graphics_preset').get().n, 0)
} finally {
  database.close()
}

console.log('graphics preset tests passed')
