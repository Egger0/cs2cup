import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { IdentityRequestError, readIdentityForm } from '@/lib/identity/internal/http'
import { getAuthContext } from '@/lib/identity/kernel'
import {
  createMembershipDraft,
  getMembershipState,
  recordMembershipReviewReminder,
  resubmitMembershipApplication,
  saveMembershipDraft,
  submitMembershipApplication,
  withdrawMembershipApplication,
  type MembershipMutationResult,
} from '@/lib/identity/membership-service'

const FIELDS = [
  'operation',
  'applicationId',
  'revision',
  'identityClaim',
  'contact',
  'reason',
] as const

function response(status: number, error: string) {
  return withPrivateNoStore(NextResponse.json({ ok: false, error }, { status }))
}

function revision(value: string) {
  return /^\d{1,10}$/.test(value) ? Number(value) : null
}

function mutationFailure(result: Extract<MembershipMutationResult, { ok: false }>) {
  if (result.reason === 'invalid_input' || result.reason === 'incomplete') {
    return response(400, '请完整填写身份与联系信息，并检查字数。')
  }
  if (result.reason === 'session_invalid') return response(401, '登录已失效，请重新登录。')
  if (result.reason === 'conflict') return response(409, '申请已在其他页面更新，请刷新后重试。')
  return response(409, '当前申请状态不支持这个操作，请刷新页面。')
}

async function createAndSubmit(
  database: ReturnType<typeof cloudflareBindings>['db'],
  context: Extract<Awaited<ReturnType<typeof getAuthContext>>, { kind: 'authenticated' }>,
  fields: { identityClaim: string; contact: string; applicationReason: string },
) {
  const created = await createMembershipDraft(database, context, fields)
  if (!created.ok) return created
  return submitMembershipApplication(database, context, {
    applicationId: created.application.id,
    revision: created.application.revision,
  })
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const fields = await readIdentityForm(request, FIELDS)
    const context = await getAuthContext({
      token: request.cookies.get('__Host-cs2cup_session')?.value ?? null,
    })
    if (context.kind === 'anonymous') return response(401, '请先登录后管理资格申请。')
    const parsedRevision = revision(fields.revision)
    if (parsedRevision === null) return response(400, '申请版本无效，请刷新页面。')
    const database = cloudflareBindings().db

    if (fields.operation === 'withdraw') {
      const result = await withdrawMembershipApplication(database, context, {
        applicationId: fields.applicationId,
        revision: parsedRevision,
      })
      return result.ok
        ? withPrivateNoStore(NextResponse.json({ ok: true, application: result.application }))
        : mutationFailure(result)
    }

    if (fields.operation === 'remind') {
      const result = await recordMembershipReviewReminder(database, context, fields.applicationId)
      if (result.ok) {
        return withPrivateNoStore(
          NextResponse.json({ ok: true, nextEligibleAt: result.nextEligibleAt }),
        )
      }
      if (result.reason === 'session_invalid') return response(401, '登录已失效，请重新登录。')
      if (result.reason === 'not_eligible') {
        return response(409, '提醒尚未开放，或最近已经提醒过审核员。')
      }
      return response(409, '当前申请状态不支持提醒，请刷新页面。')
    }

    if (fields.operation !== 'submit') return response(400, '不支持的资格申请操作。')
    const applicationFields = {
      identityClaim: fields.identityClaim,
      contact: fields.contact,
      applicationReason: fields.reason,
    }
    const state = await getMembershipState(database, context)
    if (!state.ok) return response(401, '登录已失效，请重新登录。')
    if (state.membership?.status === 'approved') return response(409, '成员资格已经生效。')
    const current = state.application

    let result: MembershipMutationResult
    if (!current || current.status === 'rejected' || current.status === 'withdrawn') {
      result = await createAndSubmit(database, context, applicationFields)
    } else if (current.id !== fields.applicationId || current.revision !== parsedRevision) {
      return response(409, '申请已在其他页面更新，请刷新后重试。')
    } else if (current.status === 'changes_requested') {
      result = await resubmitMembershipApplication(database, context, {
        ...applicationFields,
        applicationId: current.id,
        revision: current.revision,
      })
    } else if (current.status === 'draft') {
      const saved = await saveMembershipDraft(database, context, {
        ...applicationFields,
        applicationId: current.id,
        revision: current.revision,
      })
      result = saved.ok
        ? await submitMembershipApplication(database, context, {
            applicationId: saved.application.id,
            revision: saved.application.revision,
          })
        : saved
    } else {
      return response(409, '申请已经提交，无需重复操作。')
    }

    return result.ok
      ? withPrivateNoStore(NextResponse.json({ ok: true, application: result.application }))
      : mutationFailure(result)
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return response(403, '请求来源无法确认，请刷新页面后重试。')
    }
    console.error('[identity] membership application unavailable', error)
    return response(503, '资格申请服务暂时不可用，本次操作没有完成。')
  }
}
