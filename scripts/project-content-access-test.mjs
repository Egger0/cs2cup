import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/navigation') {
      return {
        url: dataModule('export function notFound(){throw new Error("forbidden")}'),
        shortCircuit: true,
      }
    }
    if (specifier === 'next/headers') {
      return {
        url: dataModule('export function cookies(){throw new Error("Unexpected HTTP transport")}'),
        shortCircuit: true,
      }
    }
    if (specifier === './auth' || specifier === '@/lib/auth' || specifier === '../../auth') {
      return {
        url: dataModule(`
          export const requireAdmin = (...args) => globalThis.__projectContentAuth.requireAdmin(...args)
          export const requirePlatformConsole = (...args) => globalThis.__projectContentAuth.requirePlatformConsole(...args)
          export const canCreateTournamentForGame = (...args) => globalThis.__projectContentAuth.canCreateTournamentForGame(...args)
          export const getCurrentUnifiedPlatformOwner = (...args) => globalThis.__projectContentAuth.getCurrentUnifiedPlatformOwner(...args)
        `),
        shortCircuit: true,
      }
    }
    if (/cloudflare-bindings(?:\.ts)?$/.test(specifier)) {
      return {
        url: dataModule(
          'export function cloudflareBindings(){return globalThis.__projectContentBindings}',
        ),
        shortCircuit: true,
      }
    }
    if (specifier.startsWith('@/lib/')) {
      return nextResolve(new URL(`../lib/${specifier.slice(6)}.ts`, import.meta.url).href, context)
    }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { accountIds, createIdentityKernelFixture, credentialIds, opaque } =
  await import('./identity-kernel-test-fixture.mjs')
const { authorize } = await import('../lib/identity/kernel.ts')
const { resolveUnifiedConsolePermissions } = await import('../lib/identity/console-access.ts')
const access = await import('../lib/project-content-access.ts')
const documents = await import('../lib/handbook.ts')
const graphics = await import('../lib/graphics-presets.ts')
const routes = await import('../lib/sand-route-store.ts')
const handbookActions = await import('../app/admin/(console)/actions/handbook.ts')
const routeActions = await import('../app/admin/(console)/actions/routes.ts')

const fixture = await createIdentityKernelFixture()
const { database, db, now, execute } = fixture
globalThis.__projectContentBindings = { db }
let context = { kind: 'anonymous' }
let authorizationTime = now
const decision = (capability, resource) =>
  authorize(context, capability, resource, { database: db, now: authorizationTime })
const ownerIdentity = async () =>
  (await decision('platform.configure', { kind: 'platform' })).ok
    ? { accountId: context.account.id }
    : null
globalThis.__projectContentAuth = {
  async requireAdmin() {
    if (!(await ownerIdentity())) throw new Error('forbidden')
  },
  async requirePlatformConsole() {
    if (context.kind === 'anonymous') throw new Error('forbidden')
    const result = await resolveUnifiedConsolePermissions(db, context, authorizationTime)
    if (!result.ok) throw new Error('forbidden')
    return result.permissions
  },
  async canCreateTournamentForGame(gameId) {
    return (await decision('tournament.create', { kind: 'game', gameId })).ok
  },
  getCurrentUnifiedPlatformOwner: ownerIdentity,
}

const graphicsInput = gameId => ({
  gameId,
  title: 'Preset',
  hardware: 'RTX 4060',
  target: '144',
  author: '',
  note: '',
  settings: 'Shadows = Low',
})
const documentInput = gameId => ({
  gameId,
  kind: 'handbook',
  title: 'Rules',
  summary: '',
  storageKey: null,
  fileName: null,
  byteSize: null,
  url: 'https://example.test/rules',
})
const snapshot = () =>
  ['handbook_document', 'graphics_preset', 'sand_route'].map(table =>
    database.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
  )

try {
  database.exec("INSERT INTO game (id,slug,name,loadout_codes) VALUES (73,'Delta','Delta',1)")
  for (const [id, accountId, gameId] of [
    [opaque('j'), accountIds.manager, 73],
    [opaque('k'), accountIds.owner, 71],
  ]) {
    execute(
      `INSERT INTO identity_role_assignment (id,account_id,role,scope_type,scope_game_id,grant_reason,granted_at)
      VALUES (?,?,'project_manager','game',?,'content test',?)`,
      [id, accountId, gameId, now - 1000],
    )
  }
  const session = name =>
    fixture.session(accountIds[name], {
      method: 'passkey',
      authenticatorCredentialId: credentialIds[name],
    })
  const [owner, manager, other] = await Promise.all([
    session('platformOwner'),
    session('manager'),
    session('owner'),
  ])

  context = owner.context
  assert.equal((await access.projectContentWorkspace()).platformOwner, true)
  await documents.insertHandbookDocument(documentInput(null))
  await documents.insertHandbookDocument(documentInput(71))
  const [general, foreignDocument] = await documents.listHandbookDocuments()
  await graphics.insertGraphicsPreset(graphicsInput(71))
  const [foreignPreset] = await graphics.listGraphicsPresets(71)
  await routes.insertSandRoute(
    accountIds.manager,
    {
      mapId: 'zero',
      level: 0,
      title: 'Route',
      waypoints: [
        [0.1, 0.1, 'Start'],
        [0.2, 0.2],
      ],
    },
    now,
  )
  const [route] = await routes.listSandPlans('all')

  context = manager.context
  const workspace = await access.projectContentWorkspace()
  assert.deepEqual(
    workspace.games.map(game => game.id),
    [73],
  )
  assert.equal(workspace.platformOwner, false)
  assert.equal(await access.canManageSandRoutes(), true)
  const form = new FormData()
  for (const [name, value] of Object.entries({
    gameId: '73',
    kind: 'template',
    title: 'Delta template',
    url: 'https://example.test/template',
  }))
    form.set(name, value)
  assert.equal((await handbookActions.createHandbookDocument(form)).ok, true)
  const ownDocument = (await documents.listHandbookDocuments()).find(
    document => document.gameId === 73,
  )
  await graphics.insertGraphicsPreset(graphicsInput(73))
  const [ownPreset] = await graphics.listGraphicsPresets(73)
  const before = snapshot()
  await assert.rejects(documents.insertHandbookDocument(documentInput(null)), /forbidden/)
  await assert.rejects(documents.insertHandbookDocument(documentInput(71)), /forbidden/)
  await assert.rejects(documents.deleteHandbookDocument(general.id), /forbidden/)
  await assert.rejects(documents.deleteHandbookDocument(foreignDocument.id), /forbidden/)
  form.set('gameId', '71')
  await assert.rejects(handbookActions.createHandbookDocument(form), /forbidden/)
  await assert.rejects(graphics.insertGraphicsPreset(graphicsInput(71)), /forbidden/)
  await assert.rejects(
    graphics.updateGraphicsPreset(foreignPreset.id, graphicsInput(73)),
    /forbidden/,
  )
  await assert.rejects(graphics.updateGraphicsPreset(ownPreset.id, graphicsInput(71)), /forbidden/)
  await assert.rejects(graphics.deleteGraphicsPreset(foreignPreset.id), /forbidden/)
  assert.deepEqual(snapshot(), before, 'rejected cross-project requests must not change data')
  await graphics.updateGraphicsPreset(ownPreset.id, { ...graphicsInput(73), title: 'Updated' })
  assert.equal((await graphics.findGraphicsPreset(ownPreset.id)).title, 'Updated')
  await documents.deleteHandbookDocument(ownDocument.id)
  await graphics.deleteGraphicsPreset(ownPreset.id)
  assert.equal((await routeActions.reviewSandRoute(route.id, 'approve')).ok, true)
  assert.equal((await routes.findSandPlan(route.id)).approved, true)
  assert.equal((await routeActions.reviewSandRoute(route.id, 'invalid')).ok, false)

  context = other.context
  assert.equal(await access.canManageSandRoutes(), false)
  database.exec('UPDATE game SET loadout_codes = 1 WHERE id = 71')
  assert.equal(
    await access.canManageSandRoutes(),
    false,
    'another game feature flag must not grant Delta moderation',
  )
  await assert.rejects(routes.listSandPlans('all'), /forbidden/)
  await assert.rejects(routes.approveSandRoute(route.id), /forbidden/)
  await assert.rejects(routes.deleteSandRoute(route.id), /forbidden/)
  context = manager.context
  authorizationTime = now + 13 * 60 * 60 * 1000
  await assert.rejects(documents.insertHandbookDocument(documentInput(73)), /forbidden/)
  await assert.rejects(graphics.insertGraphicsPreset(graphicsInput(73)), /forbidden/)
  await assert.rejects(routes.deleteSandRoute(route.id), /forbidden/)
  authorizationTime = now
  context = { kind: 'anonymous' }
  await assert.rejects(access.projectContentWorkspace(), /forbidden/)
  await assert.rejects(documents.insertHandbookDocument(documentInput(73)), /forbidden/)
  await assert.rejects(routes.listSandPlans('all'), /forbidden/)

  context = owner.context
  await documents.deleteHandbookDocument(general.id)
  await graphics.deleteGraphicsPreset(foreignPreset.id)
  await routes.deleteSandRoute(route.id)
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  console.log(
    'project content permissions, cross-project writes, route review and session expiry passed',
  )
} finally {
  database.close()
}
