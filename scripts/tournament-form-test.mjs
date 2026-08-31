import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const authModule = 'data:text/javascript,export async function requireAdmin(){}'
const rdbModule = `data:text/javascript,
  export async function deletePrivateRows(){}
  export async function insertPrivateRows(){}
  export async function selectPrivateRows(){return []}
  export async function updatePrivateRows(...args){return globalThis.__tournamentUpdateRows(...args)}`

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    if (specifier === '../../auth') return { url: authModule, shortCircuit: true }
    if (specifier === '../../rdb') return { url: rdbModule, shortCircuit: true }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { parseTournamentUpdate } = await import('../lib/tournament-form.ts')
const { TOURNAMENT_FORM_LIMITS } = await import('../lib/tournament-form-validation.ts')

function validForm(overrides = {}) {
  const values = {
    title: '  Autumn Cup  ',
    heroBottom: 'Finals',
    heroEyebrow: 'Open',
    lede: 'Season opener',
    status: 'registration',
    teamCap: '16',
    gameId: '1',
    regDeadline: '2026-09-01T18:00',
    startsAt: '2026-09-02T18:00',
    mapPool: 'Mirage， Inferno, Nuke',
    rules: JSON.stringify([{ label: '01', title: 'Roster', body: 'Five starters.' }]),
    faqs: JSON.stringify([{ question: 'When?', answer: 'September.' }]),
    championName: '',
    championNote: '',
    ...overrides,
  }
  const form = new FormData()
  for (const [name, value] of Object.entries(values)) form.set(name, value)
  return form
}

function rejected(overrides) {
  assert.equal(parseTournamentUpdate(validForm(overrides)).ok, false)
}

const parsed = parseTournamentUpdate(validForm())
assert.equal(parsed.ok, true)
if (parsed.ok) {
  assert.equal(parsed.value.title, 'Autumn Cup')
  assert.equal(parsed.value.reg_deadline, '2026-09-01T10:00:00.000Z')
  assert.equal(parsed.value.starts_at, '2026-09-02T10:00:00.000Z')
  assert.deepEqual(parsed.value.map_pool, ['Mirage', 'Inferno', 'Nuke'])
  assert.equal(parsed.value.champion_name, null)
}

const noDates = parseTournamentUpdate(validForm({ regDeadline: '', startsAt: '' }))
assert.equal(noDates.ok, true)
if (noDates.ok) {
  assert.equal(noDates.value.reg_deadline, null)
  assert.equal(noDates.value.starts_at, null)
}

rejected({ status: 'unknown' })
rejected({ teamCap: '1' })
rejected({ teamCap: String(TOURNAMENT_FORM_LIMITS.teamCap + 1) })
rejected({ gameId: 'not-a-number' })
rejected({ title: '  ' })
rejected({ title: 'Cup\nFinal' })
rejected({ title: 'x'.repeat(TOURNAMENT_FORM_LIMITS.title + 1) })
assert.equal(
  parseTournamentUpdate(validForm({ title: 'x'.repeat(TOURNAMENT_FORM_LIMITS.title) })).ok,
  true,
)
rejected({ regDeadline: 'invalid' })
rejected({ regDeadline: '2026-09-02T18:00', startsAt: '2026-09-02T18:00' })
rejected({ regDeadline: '2026-09-03T18:00', startsAt: '2026-09-02T18:00' })

const fileForm = validForm()
fileForm.set('title', new Blob(['invalid']), 'title.txt')
assert.equal(parseTournamentUpdate(fileForm).ok, false)
const fileMapForm = validForm()
fileMapForm.set('mapPool', new Blob(['Mirage']), 'maps.txt')
assert.equal(parseTournamentUpdate(fileMapForm).ok, false)

rejected({ mapPool: 'x'.repeat(TOURNAMENT_FORM_LIMITS.mapPoolText + 1) })
rejected({
  mapPool: Array.from(
    { length: TOURNAMENT_FORM_LIMITS.mapPoolItems + 1 },
    (_, index) => `Map ${index}`,
  ).join(','),
})
rejected({ mapPool: 'x'.repeat(TOURNAMENT_FORM_LIMITS.mapName + 1) })
rejected({ mapPool: 'Mirage, ＭＩＲＡＧＥ' })

rejected({ rules: '[' })
rejected({ rules: '{}' })
rejected({
  rules: JSON.stringify(
    Array.from({ length: TOURNAMENT_FORM_LIMITS.collectionItems + 1 }, (_, index) => ({
      label: String(index),
      title: `Rule ${index}`,
      body: 'Body',
    })),
  ),
})
rejected({
  rules: JSON.stringify([
    { label: '01', title: 'Roster', body: 'First' },
    { label: '02', title: ' roster ', body: 'Second' },
  ]),
})
rejected({
  rules: JSON.stringify([{ label: '01', title: 'Line\nbreak', body: 'Body' }]),
})
rejected({ rules: `[${' '.repeat(TOURNAMENT_FORM_LIMITS.collectionText)}]` })
rejected({
  faqs: JSON.stringify([
    { question: 'When?', answer: 'September.' },
    { question: ' when? ', answer: 'Later.' },
  ]),
})
rejected({ faqs: JSON.stringify([{ question: 1, answer: 'Never.' }]) })

let updateRows = []
let updateArguments
globalThis.__tournamentUpdateRows = async (...args) => {
  updateArguments = args
  return updateRows
}
const { adminSaveTournament } = await import('../lib/queries/content/tournaments.ts')

assert.equal(await adminSaveTournament(42, parsed.value), false)
assert.deepEqual(updateArguments, ['tournament', parsed.value, { filters: { id: 'eq.42' } }])
updateRows = [{ id: 42 }]
assert.equal(await adminSaveTournament(42, parsed.value), true)

console.log('tournament form tests passed')
