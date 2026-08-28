import { randomBytes } from 'node:crypto'

import {
  cloudBaseGatewayUrl,
  resolveCloudBaseSmokeTarget,
} from '../lib/cloudbase-environment.ts'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

if (process.env.CLOUDBASE_SMOKE_ACKNOWLEDGE_STAGING !== '1') {
  throw new Error(
    'Set CLOUDBASE_SMOKE_ACKNOWLEDGE_STAGING=1 only for an approved staging environment',
  )
}

const phase = required('CLOUDBASE_SMOKE_PHASE')
if (phase !== 'expanded' && phase !== 'contracted') {
  throw new Error('CLOUDBASE_SMOKE_PHASE must be expanded or contracted')
}

resolveCloudBaseSmokeTarget()

const publishableKey = required('CLOUDBASE_ANON_KEY')
const apiKey = required('CLOUDBASE_ADMIN_KEY')
const baseUrl = new URL(cloudBaseGatewayUrl('/v1/rdb/rest/') ?? '')

async function rpc(name, token, payload) {
  const response = await fetch(new URL(`rpc/${name}`, baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { body, ok: response.ok, status: response.status }
}

function claimsDenied(result) {
  return !result.ok && (
    result.body?.code === '42501'
    || result.body?.message === 'RPC caller is not authorized'
  )
}

function endpointMissing(result) {
  return result.status === 404 || ['PGRST202', 'PGRST205'].includes(result.body?.code)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const slug = `security-smoke-${Date.now()}-${randomBytes(4).toString('hex')}`
const fingerprint = `v1:${randomBytes(32).toString('hex')}`

const publicStatus = await rpc('registration_status', publishableKey, { p_slug: slug })
assert(publicStatus.ok, `anon registration_status failed with HTTP ${publicStatus.status}`)

const anonGuarded = await rpc('submit_team_rate_limited', publishableKey, {
  p_fingerprint: fingerprint,
  p_payload: { slug },
})
assert(
  claimsDenied(anonGuarded),
  `anon guarded registration was not rejected by claims (HTTP ${anonGuarded.status})`,
)

const serviceGuarded = await rpc('submit_team_rate_limited', apiKey, {
  p_fingerprint: fingerprint,
  p_payload: { slug },
})
assert(
  serviceGuarded.ok
    && serviceGuarded.body?.ok === false
    && serviceGuarded.body?.code !== 'RATE_LIMITED',
  `service_role did not reach the guarded business path (HTTP ${serviceGuarded.status})`,
)

const anonLegacy = await rpc('submit_team', publishableKey, {
  payload: { slug },
})
const serviceLegacy = await rpc('submit_team', apiKey, {
  payload: { slug },
})
const anonLegacyLedger = await rpc('recent_registration_attempts', publishableKey, {
  p_fingerprint: fingerprint,
  p_minutes: 60,
})
const serviceLegacyLedger = await rpc('recent_registration_attempts', apiKey, {
  p_fingerprint: fingerprint,
  p_minutes: 60,
})

if (phase === 'expanded') {
  assert(
    claimsDenied(anonLegacy),
    `anon legacy registration was not rejected by claims (HTTP ${anonLegacy.status})`,
  )
  assert(
    serviceLegacy.ok && serviceLegacy.body?.ok === false,
    `service_role did not reach the guarded compatibility path (HTTP ${serviceLegacy.status})`,
  )
  assert(
    claimsDenied(anonLegacyLedger),
    `anon legacy ledger was not rejected by claims (HTTP ${anonLegacyLedger.status})`,
  )
  assert(
    serviceLegacyLedger.ok && Number.isInteger(serviceLegacyLedger.body),
    `service_role did not reach the legacy ledger path (HTTP ${serviceLegacyLedger.status})`,
  )
} else {
  assert(
    endpointMissing(anonLegacy) && endpointMissing(serviceLegacy),
    'legacy registration RPC remains reachable after contraction',
  )
  assert(
    endpointMissing(anonLegacyLedger) && endpointMissing(serviceLegacyLedger),
    'legacy registration ledger RPC remains reachable after contraction',
  )
}

console.log(`CloudBase ${phase} RPC staging smoke passed`)
