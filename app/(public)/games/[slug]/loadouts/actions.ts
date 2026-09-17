'use server'

import { revalidatePath } from 'next/cache'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'
import { getCurrentUnifiedPlatformOwner } from '@/lib/auth'
import {
  parseLoadoutComment,
  postLoadoutComment,
  removeLoadoutComment,
  reportLoadoutCode,
  setLoadoutFavorite,
  setLoadoutFeatured,
  setLoadoutLike,
} from '@/lib/loadout-community'
import { recordLoadoutCopy, submitLoadoutCode } from '@/lib/loadout-codes'
import { findLoadoutByCode } from '@/lib/loadout-queries'
import { parsePastedLoadout } from '@/lib/delta-loadouts'
import { parseLoadoutInput, type LoadoutField } from '@/lib/loadout-input'
import {
  discardLoadoutShots,
  replaceLoadoutShot,
  storeLoadoutShot,
  type StoredShot,
} from '@/lib/loadout-shots'

const FIELD_ERROR: Record<LoadoutField | 'shot', string> = {
  code: '没认出改枪码：需要游戏里复制的完整串，或末尾 21 位码。',
  mode: '请选择这套方案所属的模式。',
  weapon: '请选择武器。',
  title: '方案名需为 1–40 个字符。',
  note: '说明最多 200 个字符。',
  tags: '标签最多选 3 个。',
  price: '价格按「万哈夫币」填写，例如 32.5。',
  stats: '属性要么全部填写（0–999 的整数），要么全部留空。',
  shot: '截图需为 2 MB 以内、边长 320–2560 像素的图片。',
}

function shotError(reason: Extract<StoredShot, { ok: false }>['reason']): LoadoutSubmission {
  return reason === 'unavailable'
    ? { ok: false, error: '截图存储暂时不可用，请稍后再试。' }
    : {
        ok: false,
        error:
          reason === 'missing' ? '请上传改枪台截图，让大家看到改装后的样子。' : FIELD_ERROR.shot,
        field: 'shot',
      }
}

export type LoadoutSubmission =
  | { ok: true }
  | { ok: false; error: string; field?: LoadoutField | 'shot'; signIn?: boolean }

async function signedInAccount() {
  const context = await getAuthContext()
  return context.kind === 'anonymous' || context.session.recoveryRestricted
    ? null
    : context.account.id
}

export async function submitLoadoutCodeAction(
  slug: string,
  form: FormData,
): Promise<LoadoutSubmission> {
  const accountId = await signedInAccount()
  if (!accountId) return { ok: false, error: '登录后才能投稿。', signIn: true }
  const parsed = parseLoadoutInput(form)
  if (!parsed.ok) return { ok: false, error: FIELD_ERROR[parsed.field], field: parsed.field }
  const db = cloudflareBindings().db
  const game = await db
    .prepare('SELECT id FROM game WHERE slug = ? AND active = 1 AND loadout_codes = 1')
    .bind(slug)
    .first<{ id: number }>()
  if (!game) return { ok: false, error: '这个项目暂未开放改枪码投稿。' }
  const existing = await findLoadoutByCode(db, game.id, parsed.value.code)
  if (existing) {
    return {
      ok: false,
      error:
        existing.source === 'official'
          ? `这套码已收录在官方精选：「${existing.title}」。`
          : '这条改枪码已经有人投过了。',
      field: 'code',
    }
  }

  const shot = await storeLoadoutShot(form.get('shot'))
  if (!shot.ok) return shotError(shot.reason)
  const shotKey = shot.key

  const result = await submitLoadoutCode(
    db,
    { accountId, gameId: game.id, value: parsed.value, shotKey },
    currentTimeMillis(),
  ).catch(async error => {
    await discardLoadoutShots(shotKey)
    throw error
  })
  if (!result.ok) {
    await discardLoadoutShots(shotKey)
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

export async function recordLoadoutCopyAction(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) return
  await recordLoadoutCopy(cloudflareBindings().db, id)
}

type Outcome = { ok: true } | { ok: false; error: string; signIn?: boolean }

async function asMember(
  id: number,
  run: (accountId: string) => Promise<Outcome>,
): Promise<Outcome> {
  const accountId = await signedInAccount()
  if (!accountId) return { ok: false, error: '登录后才能参与。', signIn: true }
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: '编号无效。' }
  return run(accountId)
}

export async function reportLoadoutCodeAction(id: number) {
  return asMember(id, async accountId =>
    (await reportLoadoutCode(cloudflareBindings().db, { id, accountId }, currentTimeMillis()))
      ? { ok: true }
      : { ok: false, error: '这套方案已经处理过了。' },
  )
}

export async function setLoadoutLikeAction(id: number, liked: boolean) {
  return asMember(id, async accountId =>
    (await setLoadoutLike(
      cloudflareBindings().db,
      { id, accountId, liked: liked === true },
      currentTimeMillis(),
    ))
      ? { ok: true }
      : { ok: false, error: '这套方案暂时不能点「好用」。' },
  )
}

export async function setLoadoutFavoriteAction(id: number, saved: boolean) {
  return asMember(id, async accountId =>
    (await setLoadoutFavorite(
      cloudflareBindings().db,
      { id, accountId, saved: saved === true },
      currentTimeMillis(),
    ))
      ? { ok: true }
      : { ok: false, error: '这套方案暂时不能收藏。' },
  )
}

export async function setLoadoutFeaturedAction(id: number, featured: boolean) {
  return asMember(id, async () => {
    if (!(await getCurrentUnifiedPlatformOwner().catch(() => null))) {
      return { ok: false, error: '只有社团管理员可以设置精选。' }
    }
    const slug = await setLoadoutFeatured(
      cloudflareBindings().db,
      { id, featured: featured === true },
      currentTimeMillis(),
    )
    if (!slug) return { ok: false, error: '只有已展示的方案可以设为精选。' }
    revalidatePath(`/games/${slug}`)
    revalidatePath(`/games/${slug}/loadouts`)
    revalidatePath(`/games/${slug}/loadouts/${id}`)
    return { ok: true }
  })
}

export async function postLoadoutCommentAction(slug: string, id: number, body: string) {
  return asMember(id, async accountId => {
    const text = parseLoadoutComment(body)
    if (!text) return { ok: false, error: '留言需为 1–300 个字符。' }
    const result = await postLoadoutComment(
      cloudflareBindings().db,
      { id, accountId, body: text },
      currentTimeMillis(),
    )
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.reason === 'limit' ? '留言太频繁了，歇一会儿再来。' : '这套方案暂时不能留言。',
      }
    }
    revalidatePath(`/games/${slug}/loadouts/${id}`)
    return { ok: true }
  })
}

export async function removeLoadoutCommentAction(slug: string, codeId: number, commentId: number) {
  return asMember(commentId, async accountId => {
    const moderator = Boolean(await getCurrentUnifiedPlatformOwner().catch(() => null))
    const removed = await removeLoadoutComment(
      cloudflareBindings().db,
      { commentId, accountId, moderator },
      currentTimeMillis(),
    )
    if (!removed) return { ok: false, error: '这条留言已经处理过了。' }
    revalidatePath(`/games/${slug}/loadouts/${codeId}`)
    return { ok: true }
  })
}

export async function replaceLoadoutShotAction(
  id: number,
  form: FormData,
): Promise<LoadoutSubmission> {
  const accountId = await signedInAccount()
  if (!accountId) return { ok: false, error: '登录后才能上传截图。', signIn: true }
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: '方案编号无效。' }
  const shot = await storeLoadoutShot(form.get('shot'))
  if (!shot.ok) return shotError(shot.reason)
  const result = await replaceLoadoutShot(cloudflareBindings().db, { id, accountId, key: shot.key })
  if (!result.ok) {
    await discardLoadoutShots(shot.key)
    return { ok: false, error: '这套方案现在不能更换截图，刷新后再试。' }
  }
  await discardLoadoutShots(result.stale)
  revalidatePath(`/games/${result.gameSlug}/loadouts`)
  return { ok: true }
}

export async function lookupLoadoutCodeAction(slug: string, raw: string) {
  const pasted = typeof raw === 'string' ? parsePastedLoadout(raw.slice(0, 300)) : null
  if (!pasted) return null
  const db = cloudflareBindings().db
  const game = await db
    .prepare('SELECT id FROM game WHERE slug = ? AND active = 1 AND loadout_codes = 1')
    .bind(slug)
    .first<{ id: number }>()
  if (!game) return null
  const found = await findLoadoutByCode(db, game.id, pasted.code)
  return found && (found.status === 'approved' || found.status === 'expired') ? found : null
}
