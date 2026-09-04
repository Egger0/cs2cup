'use server'

import { updateTag } from 'next/cache'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { getAuthContext } from '@/lib/identity/kernel'
import {
  acceptRegistrationInvitation,
  createRegistrationInvitation,
  deleteOwnedRegistration,
  RegistrationWorkflowError,
  removeRegistrationManager,
  revokeRegistrationInvitation,
} from '@/lib/identity/registration-workflow'
import {
  RegistrationManagementError,
  saveAccountManagedRegistration,
} from '@/lib/queries/registration-management'
import { parseRegistrationForm } from '@/lib/registration-form'

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
  if (code === 'account_not_found') {
    return { ok: false, error: '没有找到这个用户名对应的有效账号。' }
  }
  if (code === 'already_has_access') {
    return { ok: false, error: '该账号已经拥有权限，或已有一份待处理邀请。' }
  }
  if (code === 'locked') return { ok: false, error: '报名已经锁定，当前操作不可用。' }
  if (code === 'duplicate') return { ok: false, error: '战队名称或 TAG 已被占用。' }
  if (code === 'conflict') return { ok: false, error: '状态刚刚发生变化，请刷新后重试。' }
  if (code === 'not_found') return { ok: false, error: '邀请不存在、已过期或已经处理。' }
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
  const parsed = parseRegistrationForm(form)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const session = await authenticated()
  if (!session) return { ok: false, error: '登录已失效，请重新登录。' }
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

export async function inviteRegistrationAccount(
  teamId: number,
  relationship: 'owner' | 'manager',
  form: FormData,
): Promise<RegistrationActionResult> {
  const session = await authenticated()
  if (!session) return { ok: false, error: '登录已失效，请重新登录。' }
  try {
    const created = await createRegistrationInvitation(session.database, session.context, {
      teamId,
      relationship,
      username: form.get('username'),
    })
    return { ok: true, teamId: created.teamId }
  } catch (error) {
    return workflowFailure(error)
  }
}

export async function acceptRegistrationAccessInvitation(
  invitationId: string,
): Promise<RegistrationActionResult> {
  const session = await authenticated()
  if (!session) return { ok: false, error: '登录已失效，请重新登录。' }
  try {
    const accepted = await acceptRegistrationInvitation(
      session.database,
      session.context,
      invitationId,
    )
    return { ok: true, teamId: accepted.teamId }
  } catch (error) {
    return workflowFailure(error)
  }
}

export async function removeRegistrationCollaborator(
  teamId: number,
  membershipId: string,
): Promise<RegistrationActionResult> {
  const session = await authenticated()
  if (!session) return { ok: false, error: '登录已失效，请重新登录。' }
  try {
    await removeRegistrationManager(session.database, session.context, {
      teamId,
      membershipId,
    })
    return { ok: true, teamId }
  } catch (error) {
    return workflowFailure(error)
  }
}

export async function cancelRegistrationInvitation(
  teamId: number,
  invitationId: string,
): Promise<RegistrationActionResult> {
  const session = await authenticated()
  if (!session) return { ok: false, error: '登录已失效，请重新登录。' }
  try {
    await revokeRegistrationInvitation(session.database, session.context, {
      teamId,
      invitationId,
    })
    return { ok: true, teamId }
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
