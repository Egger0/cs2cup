import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const source = path => new URL(path, import.meta.url).href
const authModule = 'data:text/javascript,export async function requireAdmin(){return {uid:"test"}}'
const adminQueriesModule =
  'data:text/javascript,export async function listTeamsWithContact(){return globalThis.__teamCsvTeams}'
const contentQueriesModule =
  'data:text/javascript,export async function adminListTournaments(){return globalThis.__teamCsvTournaments}'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/auth') return { url: authModule, shortCircuit: true }
    if (specifier === '@/lib/csv') return { url: source('../lib/csv.ts'), shortCircuit: true }
    if (specifier === '@/lib/datetime') {
      return { url: source('../lib/datetime.ts'), shortCircuit: true }
    }
    if (specifier === '@/lib/http-cache') {
      return { url: source('../lib/http-cache.ts'), shortCircuit: true }
    }
    if (specifier === '@/lib/queries/admin') {
      return { url: adminQueriesModule, shortCircuit: true }
    }
    if (specifier === '@/lib/queries/content') {
      return { url: contentQueriesModule, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { GET } = await import('../app/admin/(console)/tournaments/[id]/teams.csv/route.ts')
const request = new Request('http://localhost/admin/tournaments/7/teams.csv')

globalThis.__teamCsvTournaments = [{ id: 7 }]
globalThis.__teamCsvTeams = [
  {
    id: 1,
    tournamentId: 7,
    seed: 1,
    status: 'approved',
    checkedInAt: '2026-08-31T00:00:00.000Z',
    tag: 'A',
    name: 'Alpha',
    captain: 'Captain',
    contact: '=unsafe',
    dept: null,
    note: 'Bring adapters',
    createdAt: '2026-08-30 00:00:00',
    players: [
      { nickname: 'Starter', isSubstitute: false },
      { nickname: 'Reserve', isSubstitute: true },
    ],
  },
]

function assertPrivate(response) {
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-cache, no-store, max-age=0, must-revalidate',
  )
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
}

{
  const response = await GET(request, { params: Promise.resolve({ id: 'invalid' }) })
  assert.equal(response.status, 400)
  assertPrivate(response)
}

{
  const response = await GET(request, { params: Promise.resolve({ id: '8' }) })
  assert.equal(response.status, 404)
  assertPrivate(response)
}

{
  const response = await GET(request, { params: Promise.resolve({ id: '7' }) })
  assert.equal(response.status, 200)
  assertPrivate(response)
  assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8')
  assert.equal(
    response.headers.get('content-disposition'),
    'attachment; filename="tournament-7-teams.csv"',
  )
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf])
  const body = new TextDecoder().decode(bytes.slice(3))
  assert.match(body, /'=unsafe/)
  assert.match(body, /Starter/)
  assert.match(body, /Reserve/)
  assert.match(body, /Bring adapters/)
  assert.match(body, /2026\/8\/31 08:00/)
  assert.match(body, /2026\/8\/30 08:00/)
}

console.log('Team CSV route tests passed')
