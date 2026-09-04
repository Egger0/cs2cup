import 'server-only'

import { createOpaqueToken } from '../../opaque-token.ts'
import type { RegistrationDraftValues } from '../../registration-form.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from '../internal/contracts.ts'
import {
  REGISTRATION_SLUG,
  requireActiveRegistrationSession,
  validRegistrationTime,
} from './shared.ts'
import type { RegistrationDraft } from './types.ts'
import { RegistrationWorkflowError } from './types.ts'

interface DraftRow {
  tournament_id: number
  tournament_slug: string
  tournament_title: string
  payload_json: string
  updated_at: number
  revision: number
}

function validDraftValues(value: unknown): value is RegistrationDraftValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const draft = value as Partial<RegistrationDraftValues>
  return (
    ['name', 'tag', 'captain', 'contact', 'dept', 'note'].every(
      key => typeof draft[key as keyof RegistrationDraftValues] === 'string',
    ) &&
    Array.isArray(draft.players) &&
    draft.players.length === 6 &&
    draft.players.every(player => typeof player === 'string')
  )
}

function mapDraft(row: DraftRow | null) {
  if (!row) return null
  try {
    const values: unknown = JSON.parse(row.payload_json)
    if (!validDraftValues(values)) return null
    return {
      tournament: {
        id: row.tournament_id,
        slug: row.tournament_slug,
        title: row.tournament_title,
      },
      values,
      updatedAt: row.updated_at,
      revision: row.revision,
    } satisfies RegistrationDraft
  } catch {
    return null
  }
}

export async function getRegistrationDraft(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  slug: string,
  now = Date.now(),
) {
  if (!REGISTRATION_SLUG.test(slug)) return null
  await requireActiveRegistrationSession(database, context, now)
  const row = await database
    .prepare(
      `SELECT draft.tournament_id, tournament.slug AS tournament_slug,
              tournament.title AS tournament_title, draft.payload_json,
              draft.updated_at, draft.revision
       FROM identity_registration_draft AS draft
       JOIN tournament ON tournament.id = draft.tournament_id
       WHERE draft.account_id = ? AND tournament.slug = ? LIMIT 1`,
    )
    .bind(context.account.id, slug)
    .first<DraftRow>()
  return mapDraft(row)
}

export async function listRegistrationDrafts(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
) {
  await requireActiveRegistrationSession(database, context, now)
  const rows = (
    await database
      .prepare(
        `SELECT draft.tournament_id, tournament.slug AS tournament_slug,
                tournament.title AS tournament_title, draft.payload_json,
                draft.updated_at, draft.revision
         FROM identity_registration_draft AS draft
         JOIN tournament ON tournament.id = draft.tournament_id
         WHERE draft.account_id = ?
         ORDER BY draft.updated_at DESC, draft.tournament_id DESC`,
      )
      .bind(context.account.id)
      .all<DraftRow>()
  ).results
  return rows.map(mapDraft).filter((draft): draft is RegistrationDraft => draft !== null)
}

export async function saveRegistrationDraft(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { tournamentId: number; values: RegistrationDraftValues; now?: number },
) {
  const now = input.now ?? Date.now()
  const payload = JSON.stringify(input.values)
  if (
    !Number.isSafeInteger(input.tournamentId) ||
    input.tournamentId <= 0 ||
    !validRegistrationTime(now) ||
    !validDraftValues(input.values) ||
    payload.length > 8192
  ) {
    throw new RegistrationWorkflowError('invalid')
  }
  await requireActiveRegistrationSession(database, context, now)
  const row = await database
    .prepare(
      `INSERT INTO identity_registration_draft
        (account_id, tournament_id, payload_json, created_at, updated_at, write_nonce)
       SELECT account.id, tournament.id, ?, ?, ?, ?
       FROM identity_account AS account, tournament
       WHERE account.id = ? AND account.status = 'active' AND tournament.id = ?
         AND tournament.status IN ('registration', 'postponed')
         AND (tournament.reg_deadline IS NULL
           OR unixepoch(tournament.reg_deadline) * 1000 > ?)
       ON CONFLICT(account_id, tournament_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at,
         revision = identity_registration_draft.revision + 1,
         write_nonce = excluded.write_nonce
       RETURNING revision, updated_at`,
    )
    .bind(payload, now, now, createOpaqueToken(), context.account.id, input.tournamentId, now)
    .first<{ revision: number; updated_at: number }>()
  if (!row) throw new RegistrationWorkflowError('locked')
  return { revision: row.revision, updatedAt: row.updated_at }
}
