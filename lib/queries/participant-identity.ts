import 'server-only'

import { hashRegistrationToken } from '../registration-access.ts'

interface IdentityStatement {
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

export interface ParticipantIdentityDatabase {
  prepare(query: string): { bind(...values: unknown[]): IdentityStatement }
  batch(statements: IdentityStatement[]): Promise<unknown[]>
}

export interface ExternalIdentityInput {
  provider: string
  issuer: string
  subject: string
}

export interface ParticipantPrincipal {
  id: string
  webauthnUserHandle: string
}

interface PrincipalRow {
  id: string
  webauthn_user_handle: string
}

interface OwnerRow {
  team_id: number
  principal_id: string
}

interface EntryRow {
  team_id: number
}

const PRINCIPAL_PATTERN = /^p_[A-Za-z0-9_-]{43}$/
const PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/

export class ParticipantIdentityError extends Error {
  readonly code: 'invalid_identity' | 'invalid_claim' | 'entry_already_claimed'

  constructor(code: ParticipantIdentityError['code']) {
    super(code)
    this.name = 'ParticipantIdentityError'
    this.code = code
  }
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function randomBase64Url() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

function exactIdentityPart(value: string, maximum: number) {
  if (
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ParticipantIdentityError('invalid_identity')
  }
  return value
}

export function canonicalExternalIdentity(input: ExternalIdentityInput) {
  const provider = exactIdentityPart(input.provider, 32)
  const issuer = exactIdentityPart(input.issuer, 500)
  const subject = exactIdentityPart(input.subject, 500)
  if (!PROVIDER_PATTERN.test(provider)) throw new ParticipantIdentityError('invalid_identity')
  return { provider, issuer, subject }
}

async function initialPrincipalId(identity: ExternalIdentityInput) {
  const canonical = canonicalExternalIdentity(identity)
  const namespace = JSON.stringify([
    'participant-identity-v1',
    canonical.provider,
    canonical.issuer,
    canonical.subject,
  ])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(namespace))
  return `p_${base64Url(new Uint8Array(digest))}`
}

function mapPrincipal(row: PrincipalRow): ParticipantPrincipal {
  return { id: row.id, webauthnUserHandle: row.webauthn_user_handle }
}

async function principalByIdentity(
  db: ParticipantIdentityDatabase,
  identity: ExternalIdentityInput,
) {
  return db
    .prepare(
      'SELECT principal.id, principal.webauthn_user_handle FROM participant_external_identity AS identity JOIN participant_principal AS principal ON principal.id = identity.principal_id WHERE identity.provider = ? AND identity.issuer = ? AND identity.subject = ?',
    )
    .bind(identity.provider, identity.issuer, identity.subject)
    .first<PrincipalRow>()
}

export async function resolveParticipantIdentity(
  db: ParticipantIdentityDatabase,
  input: ExternalIdentityInput,
) {
  const identity = canonicalExternalIdentity(input)
  const existing = await principalByIdentity(db, identity)
  if (existing) return mapPrincipal(existing)

  const principalId = await initialPrincipalId(identity)
  await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)',
      )
      .bind(principalId, randomBase64Url()),
    db
      .prepare(
        'INSERT OR IGNORE INTO participant_external_identity (principal_id, provider, issuer, subject) VALUES (?, ?, ?, ?)',
      )
      .bind(principalId, identity.provider, identity.issuer, identity.subject),
  ])

  const resolved = await principalByIdentity(db, identity)
  if (!resolved) throw new ParticipantIdentityError('invalid_identity')
  return mapPrincipal(resolved)
}

export async function claimTournamentEntryOwnership(
  db: ParticipantIdentityDatabase,
  input: { principalId: string; slug: string; managementToken: string },
) {
  if (!PRINCIPAL_PATTERN.test(input.principalId) || !SLUG_PATTERN.test(input.slug)) {
    throw new ParticipantIdentityError('invalid_claim')
  }
  const tokenHash = await hashRegistrationToken(input.managementToken)
  if (!tokenHash) throw new ParticipantIdentityError('invalid_claim')

  const entry = await db
    .prepare(
      'SELECT team.id AS team_id FROM team JOIN tournament ON tournament.id = team.tournament_id WHERE tournament.slug = ? AND team.management_token_hash = ?',
    )
    .bind(input.slug, tokenHash)
    .first<EntryRow>()
  if (!entry) throw new ParticipantIdentityError('invalid_claim')

  await db
    .prepare(
      "INSERT OR IGNORE INTO tournament_entry_owner (team_id, principal_id, claim_method) SELECT team.id, ?, 'management_token' FROM team JOIN tournament ON tournament.id = team.tournament_id WHERE team.id = ? AND tournament.slug = ? AND team.management_token_hash = ? AND EXISTS (SELECT 1 FROM participant_principal WHERE id = ?)",
    )
    .bind(input.principalId, entry.team_id, input.slug, tokenHash, input.principalId)
    .run()

  const owner = await db
    .prepare('SELECT team_id, principal_id FROM tournament_entry_owner WHERE team_id = ?')
    .bind(entry.team_id)
    .first<OwnerRow>()
  if (!owner) throw new ParticipantIdentityError('invalid_claim')
  if (owner.principal_id !== input.principalId) {
    throw new ParticipantIdentityError('entry_already_claimed')
  }
  return { teamId: owner.team_id, principalId: owner.principal_id }
}
