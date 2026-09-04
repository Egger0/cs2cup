'use server'

import { updateTag } from 'next/cache'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { getAuthContext } from '@/lib/identity/kernel'
import {
  attachLegacyRegistration,
  RegistrationWorkflowError,
} from '@/lib/identity/registration-workflow'
import {
  RegistrationManagementError,
  saveManagedRegistration,
} from '@/lib/queries/registration-management'
import { parseRegistrationForm } from '@/lib/registration-form'

export interface ManagedRegistrationResult {
  ok: boolean
  error?: string
  revision?: number
}

export async function attachManagedRegistration(
  slug: string,
  token: string,
): Promise<ManagedRegistrationResult & { teamId?: number; reauthenticate?: boolean }> {
  const database = cloudflareBindings().db
  const context = await getAuthContext({ database })
  if (context.kind === 'anonymous') return { ok: false, error: '请先登录账号。' }
  try {
    const attached = await attachLegacyRegistration(database, context, { slug, token })
    return { ok: true, teamId: attached.teamId }
  } catch (error) {
    if (error instanceof RegistrationWorkflowError) {
      if (error.code === 'reauth_required') {
        return {
          ok: false,
          reauthenticate: true,
          error: '迁移报名需要最近 15 分钟内完成登录，请重新登录后再试。',
        }
      }
      if (error.code === 'already_has_access') {
        return { ok: false, error: '这份报名已经归属于另一个账号。' }
      }
      if (error.code === 'not_found') return { ok: false, error: '管理链接已失效。' }
      if (error.code === 'conflict') return { ok: false, error: '报名归属刚刚变化，请刷新后重试。' }
    }
    console.error('[registration] legacy link attachment unavailable', error)
    return { ok: false, error: '暂时无法迁移报名，请稍后重试。' }
  }
}

export async function updateManagedRegistration(
  slug: string,
  token: string,
  expectedRevision: number,
  form: FormData,
): Promise<ManagedRegistrationResult> {
  const database = cloudflareBindings().db
  const context = await getAuthContext({ database })
  if (context.kind === 'authenticated' && context.session.recoveryRestricted) {
    return { ok: false, error: '请先完成账号恢复，再修改报名资料。' }
  }
  const parsed = parseRegistrationForm(form)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  try {
    const result = await saveManagedRegistration(slug, token, expectedRevision, {
      ...parsed.values,
      dept: parsed.values.dept || null,
      note: parsed.values.note || null,
    })
    updateTag(`teams:${result.tournamentId}`)
    return { ok: true, revision: result.revision }
  } catch (error) {
    if (error instanceof RegistrationManagementError) {
      if (error.code === 'locked') {
        return { ok: false, error: '报名已经审核或截止，阵容现已锁定' }
      }
      if (error.code === 'duplicate') {
        return { ok: false, error: '战队名称或 TAG 已被占用' }
      }
      if (error.code === 'conflict') {
        return { ok: false, error: '报名信息已在其他页面更新，请刷新后重试' }
      }
      return { ok: false, error: '管理链接无效或已经失效' }
    }
    console.error('[registration] managed update unavailable', error)
    return { ok: false, error: '报名更新失败，请稍后再试' }
  }
}
