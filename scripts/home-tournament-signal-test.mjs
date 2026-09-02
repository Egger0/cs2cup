import assert from 'node:assert/strict'

import { homeTournamentSignal } from '../lib/home-tournament-signal.ts'

const source = Object.freeze({
  slug: '2026-nlc',
  title: '2026 NLC 校园杯',
  season: '2026 秋',
  edition: 7,
})

for (const [status, statusLabel] of [
  ['registration', '报名阶段'],
  ['running', '进行中'],
  ['postponed', '延期中'],
]) {
  const tournament = Object.freeze({ ...source, status, unexpected: 'sentinel' })
  const signal = homeTournamentSignal(tournament)
  assert.deepEqual(signal, { ...source, status, statusLabel })
  assert.notEqual(signal, tournament)
  assert.equal('unexpected' in signal, false)
}

for (const status of ['draft', 'finished', 'cancelled', '', undefined]) {
  assert.equal(homeTournamentSignal({ ...source, status }), null)
}

assert.equal(homeTournamentSignal(null), null)

console.log('home tournament signal tests passed')
