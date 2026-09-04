import 'server-only'

import { hashRegistrationToken } from '../registration-access.ts'

interface EntryAttachmentStatement {
  first<Type>(): Promise<Type | null>
}

export interface ParticipantEntryAttachmentDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): EntryAttachmentStatement
  }
}

interface OwnerRow {
  team_id: number
  principal_id: string
}

interface EntryRow {
  team_id: number
  principal_id: string | null
}

export class ParticipantEntryAttachmentError extends Error {
  readonly code: 'invalid_entry' | 'invalid_session' | 'entry_owned_elsewhere' | 'conflict'

  constructor(code: ParticipantEntryAttachmentError['code']) {
    super(code)
    this.name = 'ParticipantEntryAttachmentError'
    this.code = code
  }
}

const SESSION_HASH_PATTERN = /^[0-9a-f]{64}$/
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/
const PRINCIPAL_PATTERN = /^p_[A-Za-z0-9_-]{43}$/

function validNow(now: number) {
  return Number.isSafeInteger(now) && now >= 0
}

function validOwner(row: OwnerRow | null): row is OwnerRow {
  return Boolean(
    row &&
    Number.isSafeInteger(row.team_id) &&
    row.team_id > 0 &&
    PRINCIPAL_PATTERN.test(row.principal_id),
  )
}

export async function attachParticipantEntry(
  db: ParticipantEntryAttachmentDatabase,
  input: {
    sessionTokenHash: string
    slug: string
    managementToken: string
    now: number
  },
) {
  if (!SESSION_HASH_PATTERN.test(input.sessionTokenHash) || !validNow(input.now)) {
    throw new ParticipantEntryAttachmentError('invalid_session')
  }
  if (!SLUG_PATTERN.test(input.slug)) {
    throw new ParticipantEntryAttachmentError('invalid_entry')
  }
  const managementTokenHash = await hashRegistrationToken(input.managementToken)
  if (!managementTokenHash) throw new ParticipantEntryAttachmentError('invalid_entry')

  const attached = await db
    .prepare(
      `INSERT INTO tournament_entry_owner (team_id, principal_id, claim_method)
      SELECT team.id, session.principal_id, 'management_token'
      FROM team
      JOIN tournament ON tournament.id = team.tournament_id
      JOIN participant_session AS session
        ON session.token_hash = ? AND session.expires_at > ?
      WHERE tournament.slug = ? AND team.management_token_hash = ?
        AND NOT EXISTS (
          SELECT 1 FROM identity_legacy_subject_map AS migrated
          WHERE migrated.subject_type = 'participant_principal'
            AND migrated.subject_id = session.principal_id
        )
      ON CONFLICT(team_id) DO UPDATE SET
        principal_id = tournament_entry_owner.principal_id
      WHERE tournament_entry_owner.principal_id = excluded.principal_id
      RETURNING team_id, principal_id`,
    )
    .bind(input.sessionTokenHash, input.now, input.slug, managementTokenHash)
    .first<OwnerRow>()
  if (validOwner(attached)) return { teamId: attached.team_id, principalId: attached.principal_id }
  if (attached) throw new ParticipantEntryAttachmentError('conflict')

  const session = await db
    .prepare(
      `SELECT session.principal_id FROM participant_session AS session
       WHERE session.token_hash = ? AND session.expires_at > ?
         AND NOT EXISTS (
           SELECT 1 FROM identity_legacy_subject_map AS migrated
           WHERE migrated.subject_type = 'participant_principal'
             AND migrated.subject_id = session.principal_id
         )`,
    )
    .bind(input.sessionTokenHash, input.now)
    .first<{ principal_id: string }>()
  if (!session || !PRINCIPAL_PATTERN.test(session.principal_id)) {
    throw new ParticipantEntryAttachmentError('invalid_session')
  }

  const entry = await db
    .prepare(
      `SELECT team.id AS team_id, owner.principal_id
      FROM team
      JOIN tournament ON tournament.id = team.tournament_id
      LEFT JOIN tournament_entry_owner AS owner ON owner.team_id = team.id
      WHERE tournament.slug = ? AND team.management_token_hash = ?`,
    )
    .bind(input.slug, managementTokenHash)
    .first<EntryRow>()
  if (!entry) throw new ParticipantEntryAttachmentError('invalid_entry')
  if (entry.principal_id === session.principal_id) {
    return { teamId: entry.team_id, principalId: session.principal_id }
  }
  if (entry.principal_id) throw new ParticipantEntryAttachmentError('entry_owned_elsewhere')
  throw new ParticipantEntryAttachmentError('conflict')
}

export async function participantEntryOwnerPrincipal(
  db: ParticipantEntryAttachmentDatabase,
  teamId: number,
) {
  if (!Number.isSafeInteger(teamId) || teamId <= 0) return null
  const owner = await db
    .prepare('SELECT principal_id FROM tournament_entry_owner WHERE team_id = ?')
    .bind(teamId)
    .first<{ principal_id: string }>()
  return owner && PRINCIPAL_PATTERN.test(owner.principal_id) ? owner.principal_id : null
}
