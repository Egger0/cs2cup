import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { registrationAvailability, validateRegistrationRoster } =
  await import('../lib/registration.ts')

const now = Date.parse('2026-08-31T12:00:00Z')
const tournament = {
  status: 'registration',
  regDeadline: '2026-09-01T12:00:00Z',
  teamCap: 8,
}

assert.deepEqual(registrationAvailability(tournament, 7, now), {
  open: true,
  seatsLeft: 1,
  reason: null,
})
assert.equal(
  registrationAvailability({ ...tournament, status: 'draft' }, 0, now).reason,
  'status_closed',
)
assert.equal(
  registrationAvailability({ ...tournament, regDeadline: '2026-08-31T12:00:00Z' }, 0, now).reason,
  'deadline_passed',
)
assert.equal(registrationAvailability(tournament, 8, now).reason, 'capacity_reached')
assert.equal(
  registrationAvailability({ ...tournament, regDeadline: 'not-a-date' }, 0, now).reason,
  'invalid_configuration',
)
assert.equal(
  registrationAvailability(
    { ...tournament, status: 'postponed', regDeadline: '2026-09-01 12:00:00' },
    0,
    now,
  ).open,
  true,
  'legacy D1 UTC timestamps must remain usable',
)

const player = (nickname, substitute = false) => ({ nickname, substitute })
const starters = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map(name => player(name))

assert.equal(validateRegistrationRoster(starters).ok, true)
assert.equal(validateRegistrationRoster([...starters, player('Foxtrot', true)]).ok, true)
assert.equal(validateRegistrationRoster(starters.slice(0, 4)).code, 'STARTER_COUNT')
assert.equal(validateRegistrationRoster([...starters, player('Foxtrot')]).code, 'STARTER_COUNT')
assert.equal(
  validateRegistrationRoster([...starters, player('Foxtrot', true), player('Golf', true)]).code,
  'SUBSTITUTE_COUNT',
)
assert.equal(
  validateRegistrationRoster([...starters.slice(0, 4), player(' alpha ')]).code,
  'DUPLICATE_NICKNAME',
)
assert.deepEqual(
  validateRegistrationRoster([...starters, player(' ', true)]),
  { ok: true, players: starters },
  'an empty optional substitute must be ignored',
)

console.log('registration eligibility and roster tests passed')
