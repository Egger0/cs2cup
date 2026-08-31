import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import {
  plainRow,
  scoreCorrectionFixture,
  scoreCorrectionState,
} from './score-correction-fixture.mjs'

const bindingsModule =
  'data:text/javascript,export function cloudflareBindings(){return globalThis.__scoreCorrectionBindings}'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    if (specifier === '../../auth') {
      return {
        url: 'data:text/javascript,export async function requireAdmin(){}',
        shortCircuit: true,
      }
    }
    if (specifier === '../../cloudflare-bindings') {
      return { url: bindingsModule, shortCircuit: true }
    }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { saveAdminMatchReport, saveAdminMatchScore } =
  await import('../lib/queries/admin/results.ts')
const { ScoreCorrectionConfirmationError } = await import('../lib/queries/admin/score-write.ts')
const { confirmScoreWrite } = await import('../lib/score-confirmation.ts')

async function expectConfirmation(work, affectedMatches, clearsCurrentReport) {
  try {
    await work
    assert.fail('a destructive write must require confirmation')
  } catch (error) {
    assert.equal(error instanceof ScoreCorrectionConfirmationError, true)
    assert.equal(error.affectedMatches, affectedMatches)
    assert.equal(error.clearsCurrentReport, clearsCurrentReport)
    assert.match(error.confirmationToken, /^[a-f0-9]{64}$/)
    return error
  }
}

const winnerBMaps = [
  {
    mapName: 'Inferno',
    action: 'pick',
    chosenBy: 'a',
    scoreA: 5,
    scoreB: 13,
    played: true,
  },
  {
    mapName: 'Nuke',
    action: 'pick',
    chosenBy: 'b',
    scoreA: 8,
    scoreB: 13,
    played: true,
  },
]

{
  const database = scoreCorrectionFixture()
  const before = scoreCorrectionState(database)
  const confirmation = await expectConfirmation(saveAdminMatchScore(10, 1, 2, 0, 2), 2, true)
  assert.deepEqual(
    scoreCorrectionState(database),
    before,
    'an unconfirmed correction must not mutate data',
  )

  const result = await saveAdminMatchScore(10, 1, 2, 0, 2, confirmation.confirmationToken)
  assert.equal(result.cleared, 2)
  assert.equal(result.reportCleared, true)
  assert.deepEqual(
    plainRow(
      database.prepare('SELECT score_a,score_b,winner_team_id FROM match WHERE id = 10').get(),
    ),
    { score_a: 0, score_b: 2, winner_team_id: 2 },
  )
  for (const id of [20, 30]) {
    assert.deepEqual(
      plainRow(
        database.prepare('SELECT score_a,score_b,winner_team_id FROM match WHERE id = ?').get(id),
      ),
      { score_a: null, score_b: null, winner_team_id: null },
    )
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM match_map').get().count, 0)
  assert.equal(
    database.prepare('SELECT champion_name FROM tournament WHERE id = 1').get().champion_name,
    null,
  )
}

{
  const database = scoreCorrectionFixture()
  database.prepare('DELETE FROM match_map WHERE match_id = 10').run()
  const result = await saveAdminMatchScore(10, 1, 2, 2, 1)
  assert.equal(result.cleared, 0)
  assert.equal(
    database.prepare('SELECT winner_team_id FROM match WHERE id = 20').get().winner_team_id,
    1,
  )
}

{
  const database = scoreCorrectionFixture()
  const confirmation = await expectConfirmation(saveAdminMatchScore(10, 1, 2, 2, 1), 0, true)
  const result = await saveAdminMatchScore(10, 1, 2, 2, 1, confirmation.confirmationToken)
  assert.equal(result.cleared, 0)
  assert.equal(result.reportCleared, true)
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM match_map WHERE match_id = 10').get().count,
    0,
  )
  assert.equal(
    database.prepare('SELECT winner_team_id FROM match WHERE id = 20').get().winner_team_id,
    1,
  )
}

{
  const database = scoreCorrectionFixture()
  database
    .prepare(
      'UPDATE match SET score_a = NULL, score_b = NULL, winner_team_id = NULL WHERE id IN (10,20,30)',
    )
    .run()
  database.prepare('DELETE FROM match_map WHERE match_id IN (10,20,30)').run()
  const result = await saveAdminMatchScore(10, 1, 2, 2, 0)
  assert.equal(result.winnerTeamId, 1)
  assert.equal(result.cleared, 2)
  assert.equal(result.reportCleared, false)
}

{
  const database = scoreCorrectionFixture()
  const before = scoreCorrectionState(database)
  const confirmation = await expectConfirmation(
    saveAdminMatchReport(10, 1, 2, winnerBMaps),
    2,
    false,
  )
  assert.deepEqual(scoreCorrectionState(database), before)
  const result = await saveAdminMatchReport(10, 1, 2, winnerBMaps, confirmation.confirmationToken)
  assert.equal(result.cleared, 2)
  assert.equal(result.maps, 2)
  assert.deepEqual(
    database
      .prepare('SELECT map_name FROM match_map WHERE match_id = 10 ORDER BY pick_order')
      .all()
      .map(plainRow),
    [{ map_name: 'Inferno' }, { map_name: 'Nuke' }],
  )
}

{
  const database = scoreCorrectionFixture()
  const confirmation = await expectConfirmation(saveAdminMatchReport(10, 1, 2, []), 2, false)
  const result = await saveAdminMatchReport(10, 1, 2, [], confirmation.confirmationToken)
  assert.equal(result.winnerTeamId, null)
  assert.equal(result.maps, 0)
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM match_map WHERE match_id = 10').get().count,
    0,
  )
}

{
  const database = scoreCorrectionFixture()
  database.prepare('DELETE FROM match_map WHERE match_id = 30').run()
  const result = await saveAdminMatchScore(30, 1, 5, 0, 2)
  assert.equal(result.cleared, 0)
  assert.equal(
    database.prepare('SELECT champion_name FROM tournament WHERE id = 1').get().champion_name,
    'Echo',
  )
}

for (const score of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  const database = scoreCorrectionFixture()
  const before = scoreCorrectionState(database)
  await assert.rejects(saveAdminMatchScore(10, 1, 2, score, 0), /比分无效/)
  assert.deepEqual(scoreCorrectionState(database), before)
}

{
  const database = scoreCorrectionFixture()
  const first = await expectConfirmation(saveAdminMatchScore(10, 1, 2, 0, 2), 2, true)
  database.prepare('UPDATE match SET score_b = 1 WHERE id = 20').run()
  const refreshed = await expectConfirmation(
    saveAdminMatchScore(10, 1, 2, 0, 2, first.confirmationToken),
    2,
    true,
  )
  assert.notEqual(refreshed.confirmationToken, first.confirmationToken)
}

{
  const firstToken = 'a'.repeat(64)
  const secondToken = 'b'.repeat(64)
  const submitted = []
  const prompts = []
  const result = await confirmScoreWrite(
    async token => {
      submitted.push(token)
      if (token === null) {
        return {
          ok: false,
          code: 'score_correction_confirmation',
          error: 'First confirmation',
          confirmationToken: firstToken,
        }
      }
      if (token === firstToken) {
        return {
          ok: false,
          code: 'score_correction_confirmation',
          error: 'State changed',
          confirmationToken: secondToken,
        }
      }
      return { ok: true, saved: true }
    },
    message => {
      prompts.push(message)
      return true
    },
  )
  assert.deepEqual(submitted, [null, firstToken, secondToken])
  assert.deepEqual(prompts, ['First confirmation', 'State changed'])
  assert.deepEqual(result, { ok: true, saved: true })

  let writes = 0
  const cancelled = await confirmScoreWrite(
    async () => {
      writes += 1
      return {
        ok: false,
        code: 'score_correction_confirmation',
        error: 'Cancel confirmation',
        confirmationToken: firstToken,
      }
    },
    () => false,
  )
  assert.equal(cancelled, null)
  assert.equal(writes, 1)
}

console.log('score correction tests passed')
