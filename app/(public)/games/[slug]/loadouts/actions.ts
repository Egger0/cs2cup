'use server'

import { revalidatePath } from 'next/cache'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'
import { parseLoadoutInput, submitLoadoutCode, type LoadoutField } from '@/lib/loadout-codes'

const FIELD_ERROR: Record<LoadoutField, string> = {
  weapon: '武器名称需为 1–30 个字符。',
  title: '标题需为 1–40 个字符。',
  code: '改枪码需为 4–200 个字符。',
  note: '说明最多 200 个字符。',
}

export type LoadoutSubmission =
  | { ok: true }
  | { ok: false; error: string; field?: LoadoutField; signIn?: boolean }

export async function submitLoadoutCodeAction(
  slug: string,
  form: FormData,
): Promise<LoadoutSubmission> {
  const context = await getAuthContext()
  if (context.kind === 'anonymous' || context.session.recoveryRestricted) {
    return { ok: false, error: '登录后才能投稿。', signIn: true }
  }
  const parsed = parseLoadoutInput(Object.fromEntries(form))
  if (!parsed.ok) return { ok: false, error: FIELD_ERROR[parsed.field], field: parsed.field }
  const db = cloudflareBindings().db
  const game = await db
    .prepare('SELECT id FROM game WHERE slug = ? AND active = 1 AND loadout_codes = 1')
    .bind(slug)
    .first<{ id: number }>()
  if (!game) return { ok: false, error: '这个项目暂未开放改枪码投稿。' }
  const result = await submitLoadoutCode(
    db,
    { accountId: context.account.id, gameId: game.id, value: parsed.value },
    currentTimeMillis(),
  )
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === 'duplicate'
          ? '这条改枪码已经有人投过了。'
          : result.reason === 'limit'
            ? '你已有 5 条改枪码在审核中，审核完成后再投稿吧。'
            : '这个项目暂未开放改枪码投稿。',
      field: result.reason === 'duplicate' ? 'code' : undefined,
    }
  }
  revalidatePath(`/games/${slug}/loadouts`)
  return { ok: true }
}
