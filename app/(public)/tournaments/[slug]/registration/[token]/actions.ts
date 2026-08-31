'use server'

import { updateTag } from 'next/cache'
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

export async function updateManagedRegistration(
  slug: string,
  token: string,
  expectedRevision: number,
  form: FormData,
): Promise<ManagedRegistrationResult> {
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
