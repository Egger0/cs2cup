import assert from 'node:assert/strict'
import { createMigratedDatabase } from './sqlite-fixture.mjs'

const database = await createMigratedDatabase()
const token = seed => seed.repeat(43).slice(0, 43)
const [alice, bob] = [token('a'), token('b')]
const notifications = () => database.prepare('SELECT * FROM notification ORDER BY id').all()

try {
  database.exec(`
    INSERT INTO identity_account (id, webauthn_user_handle, display_name, status, verification_state)
    VALUES ('${alice}', '${token('x')}', 'Alice', 'active', 'verified'),
           ('${bob}', '${token('y')}', 'Bob', 'active', 'verified');
    INSERT INTO game (id, slug, name, roster_size, loadout_codes) VALUES (1, 'delta-force', 'Delta', 4, 1);
    INSERT INTO squad (id, game_id, name, tag, captain_account_id, created_at)
    VALUES ('${token('s')}', 1, 'Rockets', 'RKT', '${alice}', 1);
    INSERT INTO squad_invitation (id, squad_id, account_id, invited_by_account_id, created_at)
    VALUES ('${token('i')}', '${token('s')}', '${bob}', '${alice}', 5);
  `)
  const [invite] = notifications()
  assert.equal(invite.account_id, bob)
  assert.equal(invite.kind, 'squad_invitation')
  assert.equal(invite.href, '/squads')
  assert.match(invite.body, /Alice.*Rockets/)
  assert.equal(invite.read_at, null)

  database.exec(`
    INSERT INTO loadout_code (id, game_id, account_id, mode, weapon, code, title, status, created_at)
    VALUES (7, 1, '${alice}', 'operations', 'AK', '${'0'.repeat(21)}', 'Rush', 'pending', 10);
    UPDATE loadout_code SET status = 'approved', reviewed_at = 20 WHERE id = 7;
    INSERT INTO loadout_comment (code_id, account_id, body, created_at) VALUES (7, '${bob}', 'nice', 30);
    INSERT INTO loadout_comment (code_id, account_id, body, created_at) VALUES (7, '${alice}', 'thanks', 40);
  `)
  const [, review, comment, ...rest] = notifications()
  assert.equal(review.kind, 'loadout_review')
  assert.equal(review.account_id, alice)
  assert.equal(comment.kind, 'loadout_comment')
  assert.equal(comment.account_id, alice)
  assert.equal(comment.href, '/games/delta-force/loadouts/7')
  assert.equal(rest.length, 0, 'authors are not notified about their own comments')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  database.close()
}
if (!process.exitCode) console.log('notification tests passed')
