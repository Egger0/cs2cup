import assert from 'node:assert/strict'
import { accountIds, opaque } from './identity-kernel-test-fixture.mjs'

export async function assertProjectManagerScope({
  fixture,
  decision,
  manager,
  owner,
  platformOwner,
  now,
}) {
  fixture.execute(
    "INSERT INTO game (id, slug, name) VALUES (73, 'identity-kernel-other', 'Other Project')",
  )
  fixture.execute(
    "INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap) VALUES (73, 'kernel-other', 'Kernel Other', 73, '2026', 1, 'draft', 8)",
  )
  fixture.execute(
    `INSERT INTO identity_role_assignment
      (id, account_id, role, scope_type, scope_game_id, grant_reason, granted_at)
    VALUES (?, ?, 'project_manager', 'game', 71, 'kernel test', ?)`,
    [opaque('j'), accountIds.manager, now - 1_000],
  )
  const results = await Promise.all([
    decision(manager.context, 'tournament.create', { kind: 'game', gameId: 71 }),
    decision(manager.context, 'tournament.create', { kind: 'game', gameId: 73 }),
    decision(manager.context, 'tournament.configure', { kind: 'tournament', tournamentId: 72 }),
    decision(manager.context, 'tournament.configure', { kind: 'tournament', tournamentId: 73 }),
    decision(owner.context, 'tournament.create', { kind: 'game', gameId: 71 }),
    decision(platformOwner.context, 'tournament.create', { kind: 'game', gameId: 73 }),
  ])
  assert.deepEqual(
    results.map(result => result.ok),
    [true, false, true, false, false, true],
    'a project manager must only create and configure tournaments within its own project',
  )
}
