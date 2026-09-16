'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'
import { imageSize, sniffMime } from '@/lib/image'
import { getCurrentUnifiedPlatformOwner } from '@/lib/auth'
import {
  parseLoadoutComment,
  postLoadoutComment,
  removeLoadoutComment,
  reportLoadoutCode,
  setLoadoutLike,
} from '@/lib/loadout-community'
import { recordLoadoutCopy, submitLoadoutCode } from '@/lib/loadout-codes'
import { parseLoadoutInput, type LoadoutField } from '@/lib/loadout-input'
import { putObject, removeObject, uploadsEnabled } from '@/lib/storage'

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

  const shot = form.get('shot')
  let shotKey: string | null = null
  if (shot instanceof File && shot.size > 0) {
    if (!uploadsEnabled()) return { ok: false, error: '暂时无法上传截图，请先不带截图投稿。' }
    const buffer = Buffer.from(await shot.arrayBuffer())
    const size = sniffMime(buffer) === 'image/webp' ? imageSize('image/webp', buffer) : null
    if (
      shot.size > 2 * 1024 * 1024 ||
      !size ||
      Math.min(size.width, size.height) < 320 ||
      Math.max(size.width, size.height) > 2560
    ) {
      return { ok: false, error: FIELD_ERROR.shot, field: 'shot' }
    }
    shotKey = `loadouts/${randomUUID()}.webp`
    await putObject(shotKey, buffer, 'image/webp')
  }

  const result = await submitLoadoutCode(
    db,
    { accountId, gameId: game.id, value: parsed.value, shotKey },
    currentTimeMillis(),
  ).catch(async error => {
    if (shotKey) await removeObject(shotKey).catch(() => {})
    throw error
  })
  if (!result.ok) {
    if (shotKey) await removeObject(shotKey).catch(() => {})
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
