import assert from 'node:assert/strict'
import { parseRouteQuery, parseWaypoints, routeMeters, routeQuery } from '../lib/sand-routes.ts'
import { createMigratedDatabase } from './sqlite-fixture.mjs'

assert.deepEqual(
  parseWaypoints([
    [0.123456, 0.5, '  spawn,   grab the crate '],
    [0.9, 1],
  ]),
  [
    [0.1235, 0.5, 'spawn, grab the crate'],
    [0.9, 1],
  ],
)
for (const invalid of [
  null,
  'route',
  [[0.1, 0.1]],
  Array.from({ length: 41 }, () => [0.5, 0.5]),
  [
    [0.1, 0.1],
    [1.2, 0.5],
  ],
  [
    [0.1, 0.1],
    [Number.NaN, 0.5],
  ],
  [
    [0.1, 0.1],
    ['0.2', 0.5],
  ],
  [
    [0.1, 0.1],
    [0.2, 0.5, 7],
  ],
  [
    [0.1, 0.1],
    [0.2, 0.5, 'x'.repeat(121)],
  ],
  [
    [0.1, 0.1],
    [0.2, 0.5, 'note', 'extra'],
  ],
  [[0.1, 0.1], { 0: 0.2, 1: 0.5 }],
]) {
  assert.equal(parseWaypoints(invalid), null, JSON.stringify(invalid)?.slice(0, 60))
}

const route = [
  [0, 0, 'start'],
  [0.3, 0.4],
  [0.3, 1],
]
assert.equal(Math.round(routeMeters(route, 1000)), 1100)
assert.equal(routeQuery(route), '0.0000,0.0000;0.3000,0.4000;0.3000,1.0000')
assert.deepEqual(parseRouteQuery(routeQuery(route)), [
  [0, 0],
  [0.3, 0.4],
  [0.3, 1],
])
assert.deepEqual(parseRouteQuery('0.5,0.5;2,0.5;nope;0.1,0.2,0.3'), [[0.5, 0.5]])
assert.deepEqual(parseRouteQuery(null), [])

const database = await createMigratedDatabase()
try {
  const account = 'R'.repeat(43)
  database
    .prepare(
      `INSERT INTO identity_account
        (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
       VALUES (?, ?, 'Route tester', 'active', 'verified', 1, 1)`,
    )
    .run(account, account)
  const insert = database.prepare(
    'INSERT INTO sand_route (account_id, map_id, level, title, waypoints, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 0)',
  )
  const points = JSON.stringify([
    [0.1, 0.1, 'start'],
    [0.2, 0.2],
  ])
  for (let index = 0; index < 5; index++) {
    insert.run(account, 'zero-dam', 0, `Route ${index}`, points, 'pending')
  }
  assert.throws(
    () => insert.run(account, 'zero-dam', 0, 'Sixth pending', points, 'pending'),
    /sand route submission rejected/,
  )
  database.exec("UPDATE sand_route SET status = 'approved' WHERE title = 'Route 0'")
  insert.run(account, 'zero-dam', 0, 'After approval', points, 'pending')
  for (const row of [
    [account, 'zero-dam', 0, 'Born approved', points, 'approved'],
    ['M'.repeat(43), 'zero-dam', 0, 'Unknown account', points, 'pending'],
    [account, 'zero-dam', 0, 'One stop', '[[0.1,0.1]]', 'pending'],
    [account, 'zero-dam', 0, 'Not JSON', 'route', 'pending'],
    [account, 'zero-dam', 12, 'Bad level', points, 'pending'],
    [account, 'zero-dam', 0, '', points, 'pending'],
  ]) {
    assert.throws(() => insert.run(...row), row[3])
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM sand_route').get().n, 6)
} finally {
  database.close()
}

console.log('sand route tests passed')
