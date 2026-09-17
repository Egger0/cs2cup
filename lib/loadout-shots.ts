import 'server-only'

import { randomUUID } from 'node:crypto'
import type { IdentityDatabase } from './identity/internal/contracts.ts'
import { imageSize, sniffMime } from './image.ts'
import { putObject, removeObject, uploadsEnabled } from './storage.ts'

export type StoredShot =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly reason: 'missing' | 'invalid' | 'unavailable' }

export async function storeLoadoutShot(file: FormDataEntryValue | null): Promise<StoredShot> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, reason: 'missing' }
  if (!uploadsEnabled()) return { ok: false, reason: 'unavailable' }
  const buffer = Buffer.from(await file.arrayBuffer())
  const size = sniffMime(buffer) === 'image/webp' ? imageSize('image/webp', buffer) : null
  if (
    file.size > 2 * 1024 * 1024 ||
    !size ||
    Math.min(size.width, size.height) < 320 ||
    Math.max(size.width, size.height) > 2560
  ) {
    return { ok: false, reason: 'invalid' }
  }
  const key = `loadouts/${randomUUID()}.webp`
  await putObject(key, buffer, 'image/webp')
  return { ok: true, key }
}

export function discardLoadoutShots(...keys: (string | null | undefined)[]) {
  return Promise.all(
    keys.filter((key): key is string => Boolean(key)).map(key => removeObject(key).catch(() => {})),
  )
}

interface ShotRow {
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  shotKey: string | null
  pendingShotKey: string | null
  gameSlug: string
}

export async function replaceLoadoutShot(
  database: IdentityDatabase,
  input: { id: number; accountId: string; key: string },
): Promise<{ ok: true; review: boolean; gameSlug: string; stale: string | null } | { ok: false }> {
  const row = await database
    .prepare(
      `SELECT code.status, code.shot_key AS shotKey, code.pending_shot_key AS pendingShotKey,
              game.slug AS gameSlug
       FROM loadout_code AS code JOIN game ON game.id = code.game_id
       WHERE code.id = ? AND code.account_id = ? AND code.status != 'rejected'`,
    )
    .bind(input.id, input.accountId)
    .first<ShotRow>()
  if (!row) return { ok: false }
  const review = row.status !== 'pending'
  const updated = await database
    .prepare(
      review
        ? `UPDATE loadout_code SET pending_shot_key = ?1
           WHERE id = ?2 AND status = ?3 AND pending_shot_key IS ?4 RETURNING id`
        : `UPDATE loadout_code SET shot_key = ?1
           WHERE id = ?2 AND status = ?3 AND shot_key IS ?4 RETURNING id`,
    )
    .bind(input.key, input.id, row.status, review ? row.pendingShotKey : row.shotKey)
    .first()
  if (!updated) return { ok: false }
  return {
    ok: true,
    review,
    gameSlug: row.gameSlug,
    stale: review ? row.pendingShotKey : row.shotKey,
  }
}

export async function reviewLoadoutShot(
  database: IdentityDatabase,
  input: { id: number; approve: boolean },
): Promise<{ ok: true; gameSlug: string; stale: string | null } | { ok: false }> {
  const row = await database
    .prepare(
      `SELECT code.status, code.shot_key AS shotKey, code.pending_shot_key AS pendingShotKey,
              game.slug AS gameSlug
       FROM loadout_code AS code JOIN game ON game.id = code.game_id
       WHERE code.id = ? AND code.pending_shot_key IS NOT NULL`,
    )
    .bind(input.id)
    .first<ShotRow>()
  if (!row) return { ok: false }
  const updated = await database
    .prepare(
      `UPDATE loadout_code
       SET shot_key = CASE WHEN ?1 THEN pending_shot_key ELSE shot_key END, pending_shot_key = NULL
       WHERE id = ?2 AND pending_shot_key = ?3 RETURNING id`,
    )
    .bind(input.approve ? 1 : 0, input.id, row.pendingShotKey)
    .first()
  if (!updated) return { ok: false }
  return {
    ok: true,
    gameSlug: row.gameSlug,
    stale: input.approve ? row.shotKey : row.pendingShotKey,
  }
}

export async function loadoutShotAccess(
  database: IdentityDatabase,
  key: string,
): Promise<{ published: boolean; accountId: string } | null> {
  const row = await database
    .prepare(
      `SELECT status, account_id AS accountId, shot_key = ?1 AS current
       FROM loadout_code WHERE shot_key = ?1 OR pending_shot_key = ?1 LIMIT 1`,
    )
    .bind(key)
    .first<{ status: ShotRow['status']; accountId: string; current: number }>()
  if (!row) return null
  return {
    published: Boolean(row.current) && (row.status === 'approved' || row.status === 'expired'),
    accountId: row.accountId,
  }
}
