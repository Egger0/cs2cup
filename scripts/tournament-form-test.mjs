import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'

const authModule = 'data:text/javascript,export async function requireAdmin(){}'
const rdbModule = `data:text/javascript,
  export async function deletePrivateRows(){}
  export async function insertPrivateRows(){}
  export async function selectPrivateRows(){return []}
  export async function updatePrivateRows(...args){return globalThis.__tournamentUpdateRows(...args)}`
const actionContentModule = `data:text/javascript,
  export async function adminCreateTournament(values){return globalThis.__tournamentCreate(values)}
  export async function adminDeleteTournament(){}
  export async function adminListPhotos(){return []}
  export async function adminListTournaments(){return []}
  export async function adminSaveTournament(){}`
const actionRdbModule = `data:text/javascript,
  export class RdbError extends Error {
    constructor(status, table, message) {
      super(table + ': ' + message);
      this.status = status;
      this.table = table;
    }
  }`
const cacheModule =
  'data:text/javascript,export function updateTag(tag){return globalThis.__tournamentUpdateTag(tag)}'
const navigationModule =
  'data:text/javascript,export function redirect(path){return globalThis.__tournamentRedirect(path)}'
const tournamentFormModule = new URL('../lib/tournament-form.ts', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    if (specifier === '../../auth') return { url: authModule, shortCircuit: true }
    if (specifier === '../../rdb') return { url: rdbModule, shortCircuit: true }
    if (specifier === '@/lib/auth') return { url: authModule, shortCircuit: true }
    if (specifier === '@/lib/object-cleanup') {
      return {
        url: 'data:text/javascript,export async function deleteRecordThenObjects(){}',
        shortCircuit: true,
      }
    }
    if (specifier === '@/lib/queries/content') {
      return { url: actionContentModule, shortCircuit: true }
    }
    if (specifier === '@/lib/rdb') return { url: actionRdbModule, shortCircuit: true }
    if (specifier === '@/lib/storage') {
      return {
        url: 'data:text/javascript,export async function removeObject(){}',
        shortCircuit: true,
      }
    }
    if (specifier === '@/lib/tournament-form') {
      return { url: tournamentFormModule, shortCircuit: true }
    }
    if (specifier === 'next/cache') return { url: cacheModule, shortCircuit: true }
    if (specifier === 'next/navigation') return { url: navigationModule, shortCircuit: true }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { parseTournamentCreate, parseTournamentUpdate } = await import('../lib/tournament-form.ts')
const { TOURNAMENT_FORM_LIMITS } = await import('../lib/tournament-form-validation.ts')
const createPage = await readFile(
  new URL('../app/admin/(console)/tournaments/page.tsx', import.meta.url),
  'utf8',
)
assert.match(createPage, /pattern="\[a-z0-9\]\(\?:\[a-z0-9\]\|-\)\{0,99\}"/)

function validCreateForm(overrides = {}) {
  const values = {
    slug: ' 2027-autumn-cup ',
    title: ' Autumn Cup ',
    gameId: '7',
    season: ' 2027 秋季 ',
    edition: '5',
    teamCap: '16',
    ...overrides,
  }
  const form = new FormData()
  for (const [name, value] of Object.entries(values)) form.set(name, value)
  return form
}

function createRejected(overrides) {
  assert.equal(parseTournamentCreate(validCreateForm(overrides)).ok, false)
}

const created = parseTournamentCreate(validCreateForm())
assert.deepEqual(created, {
  ok: true,
  value: {
    slug: '2027-autumn-cup',
    title: 'Autumn Cup',
    gameId: 7,
    season: '2027 秋季',
    edition: 5,
    teamCap: 16,
  },
})

assert.equal(
  parseTournamentCreate(
    validCreateForm({
      slug: `a${'b'.repeat(TOURNAMENT_FORM_LIMITS.slug - 1)}`,
      title: 'x'.repeat(TOURNAMENT_FORM_LIMITS.title),
      gameId: String(Number.MAX_SAFE_INTEGER),
      season: '季'.repeat(TOURNAMENT_FORM_LIMITS.season),
      edition: String(Number.MAX_SAFE_INTEGER),
      teamCap: String(TOURNAMENT_FORM_LIMITS.teamCap),
    }),
  ).ok,
  true,
)
assert.equal(parseTournamentCreate(validCreateForm({ teamCap: '2' })).ok, true)

for (const slug of [
  '',
  '-autumn-cup',
  'Autumn-cup',
  'autumn cup',
  'autumn/cup',
  `a${'b'.repeat(TOURNAMENT_FORM_LIMITS.slug)}`,
]) {
  createRejected({ slug })
}
createRejected({ title: ' ' })
createRejected({ title: 'Cup\nFinal' })
createRejected({ title: 'x'.repeat(TOURNAMENT_FORM_LIMITS.title + 1) })
createRejected({ season: ' ' })
createRejected({ season: '2027\n秋季' })
createRejected({ season: '季'.repeat(TOURNAMENT_FORM_LIMITS.season + 1) })

for (const gameId of ['', '0', '-1', '1.5', '1e2', String(Number.MAX_SAFE_INTEGER + 1)]) {
  createRejected({ gameId })
}
for (const edition of ['', '0', '-1', '1.5', '1e2', String(Number.MAX_SAFE_INTEGER + 1)]) {
  createRejected({ edition })
}
for (const teamCap of ['', '1', '2.5', String(TOURNAMENT_FORM_LIMITS.teamCap + 1)]) {
  createRejected({ teamCap })
}

for (const field of ['slug', 'title', 'season', 'gameId', 'edition', 'teamCap']) {
  const form = validCreateForm()
  form.set(field, new Blob(['invalid']), `${field}.txt`)
  assert.equal(parseTournamentCreate(form).ok, false)
}

const actionEvents = []
let createFailure = null
globalThis.__tournamentCreate = async values => {
  actionEvents.push({ type: 'create', values })
  if (createFailure) throw createFailure
}
globalThis.__tournamentUpdateTag = tag => actionEvents.push({ type: 'tag', tag })
const redirectSentinel = new Error('redirect sentinel')
globalThis.__tournamentRedirect = path => {
  actionEvents.push({ type: 'redirect', path })
  throw redirectSentinel
}
const { createTournament } = await import('../app/admin/(console)/actions/tournaments.ts')

const initialCreateState = { error: null }
assert.deepEqual(await createTournament(initialCreateState, validCreateForm({ teamCap: '1' })), {
  error: `席位数必须在 2 到 ${TOURNAMENT_FORM_LIMITS.teamCap} 之间`,
})
assert.deepEqual(actionEvents, [])

createFailure = new Error('credential-canary')
const originalConsoleError = console.error
console.error = () => {}
try {
  assert.deepEqual(await createTournament(initialCreateState, validCreateForm()), {
    error: '赛事创建失败',
  })
} finally {
  console.error = originalConsoleError
}
assert.deepEqual(
  actionEvents.map(event => event.type),
  ['create'],
)

actionEvents.length = 0
createFailure = null
await assert.rejects(
  createTournament(initialCreateState, validCreateForm()),
  error => error === redirectSentinel,
)
assert.deepEqual(actionEvents, [
  { type: 'create', values: created.value },
  { type: 'tag', tag: 'tournament' },
  { type: 'redirect', path: '/admin/tournaments' },
])

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
