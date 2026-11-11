'use server'

import { updateTag } from 'next/cache'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { getAuthContext } from '@/lib/identity/kernel'
import {
  deleteOwnedRegistration,
  RegistrationWorkflowError,
} from '@/lib/identity/registration-workflow'
import {
  RegistrationManagementError,
  saveAccountManagedRegistration,
} from '@/lib/queries/registration-management'
import { parseRegistrationForm } from '@/lib/registration-form'
import { tournamentRosterSize } from '@/lib/queries/roster-size'

export interface RegistrationActionResult {
  ok: boolean
  error?: string
  revision?: number
  teamId?: number
  reauthenticate?: boolean
}

function workflowFailure(error: unknown): RegistrationActionResult {
  const code =
    error instanceof RegistrationWorkflowError || error instanceof RegistrationManagementError
      ? error.code
      : null
  if (code === 'reauth_required') {
    return {
      ok: false,
      reauthenticate: true,
      error: '这项操作需要最近 15 分钟内完成登录，请重新登录后再试。',
    }
  }
  if (code === 'locked') return { ok: false, error: '报名已经锁定，当前操作不可用。' }
  if (code === 'duplicate') return { ok: false, error: '战队名称或 TAG 已被占用。' }
  if (code === 'conflict') return { ok: false, error: '状态刚刚发生变化，请刷新后重试。' }
  if (code === 'not_found') return { ok: false, error: '报名不存在或已经处理。' }
  if (code === 'forbidden') return { ok: false, error: '当前账号没有执行这项操作的权限。' }
  console.error('[registration] account operation unavailable', error)
  return { ok: false, error: '操作暂时不可用，请稍后重试。' }
}

async function authenticated() {
  const database = cloudflareBindings().db
  const context = await getAuthContext({ database })
  if (context.kind === 'anonymous') return null
  return { database, context }
}

export async function updateAccountRegistration(
  teamId: number,
  expectedRevision: number,
  form: FormData,
): Promise<RegistrationActionResult> {
  const session = await authenticated()
  if (!session) return { ok: false, error: '登录已失效，请重新登录。' }
  const parsed = parseRegistrationForm(
    form,
    await tournamentRosterSize(session.database, { teamId }),
  )
  if (!parsed.ok) return { ok: false, error: parsed.error }
  try {
    const saved = await saveAccountManagedRegistration(
      session.database,
      session.context,
      teamId,
      expectedRevision,
      {
        ...parsed.values,
        dept: parsed.values.dept || null,
        note: parsed.values.note || null,
      },
    )
    updateTag(`teams:${saved.tournamentId}`)
    return { ok: true, revision: saved.revision, teamId: saved.teamId }
  } catch (error) {
    return workflowFailure(error)
  }
}

export async function deleteAccountRegistration(teamId: number): Promise<RegistrationActionResult> {
  const session = await authenticated()
  if (!session) return { ok: false, error: '登录已失效，请重新登录。' }
  try {
    await deleteOwnedRegistration(session.database, session.context, teamId)
    return { ok: true, teamId }
  } catch (error) {
    return workflowFailure(error)
  }
}
