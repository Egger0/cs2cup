import { NextResponse, type NextRequest } from 'next/server'

import { clearAdminSessionCookie } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { registerAccount } from '@/lib/identity/account-registration'
import {
  AuthAttemptRateLimitError,
  chargeAuthAttempts,
} from '@/lib/identity/internal/auth-attempts'
import { activeAuthFingerprintKey } from '@/lib/identity/internal/auth-fingerprint-config'
import { networkAuthAttemptCharge } from '@/lib/identity/internal/auth-network'
import {
  IdentityRequestError,
  identityWantsJson,
  readIdentityForm,
} from '@/lib/identity/internal/http'
import { passwordPepperSet } from '@/lib/identity/internal/password-config'
import { clientSessionLabel } from '@/lib/identity/internal/session-display'
import { getAuthContext, setIdentitySessionCookie } from '@/lib/identity/kernel'
import { legacySessionStateFromRequest } from '@/lib/legacy-session-state'
import { clearParticipantSessionCookie } from '@/lib/participant-auth'
import { resolveSiteOrigin } from '@/lib/site-config'
import { registrationAccountHref, registrationAuthHref } from '@/lib/registration-navigation'

const ACCOUNTS_PER_NETWORK_WINDOW = 40

const FIELDS = [
  'username',
  'displayName',
  'password',
  'passwordConfirmation',
  'identityClaim',
  'contact',
  'applicationReason',
] as const

interface Failure {
  status: number
  code: string
  error: string
  field?: string
  retryAfter?: number
}

function failureResponse(request: NextRequest, failure: Failure) {
  const retry = new URL(
    registrationAuthHref('register', request.nextUrl.searchParams.get('tournamentSlug')),
    resolveSiteOrigin(),
  )
  retry.searchParams.set('error', failure.code)
  const response = identityWantsJson(request)
    ? NextResponse.json({ ok: false, ...failure }, { status: failure.status })
    : NextResponse.redirect(retry, 303)
  if (failure.retryAfter) response.headers.set('Retry-After', String(failure.retryAfter))
  return withPrivateNoStore(response)
}

function policyMessage(field: string, reason: string) {
  if (['identityClaim', 'contact', 'applicationReason'].includes(field)) {
    const label =
      field === 'identityClaim' ? '身份与参与依据' : field === 'contact' ? '联系信息' : '补充说明'
    return reason === 'invalid_characters'
      ? `${label}含有不支持的字符，请删除后重试。`
      : `${label}请填写 ${field === 'applicationReason' ? '1–500' : '3–160'} 个字符。`
  }
  if (field === 'username') {
    return reason === 'reserved'
      ? '这个用户名不可用，请换一个再试。'
      : '用户名需为 3–32 位小写字母、数字、点、短横线或下划线。'
  }
  if (field === 'displayName') return '请填写 1–80 个字符的显示名称。'
  if (field === 'passwordConfirmation') return '两次输入的密码不一致。'
  if (reason === 'too_short') return '密码至少需要 6 个字符。'
  if (reason === 'contains_account_context') {
    return '密码不能包含用户名、显示名称或社团名称，请换一个。'
  }
  return '密码不符合要求，请换一个易记的长密码。'
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const [fields, context, legacy] = await Promise.all([
      readIdentityForm(request, FIELDS),
      getAuthContext({ token: request.cookies.get('__Host-cs2cup_session')?.value ?? null }),
      legacySessionStateFromRequest(request),
    ])
    if (context.kind === 'authenticated' || legacy.adminActive || legacy.participantActive) {
      return failureResponse(request, {
        status: 409,
        code: 'signed_in',
        error: '当前浏览器已有登录账号，请先退出后再创建新账号。',
      })
    }

    const database = cloudflareBindings().db
    const registrationFields = {
      ...fields,
      displayName: fields.displayName.trim() || fields.username.trim(),
    }
    const result = await registerAccount(database, registrationFields, await passwordPepperSet(), {
      clientLabel: clientSessionLabel(request.headers),
      beforeCreate: async () =>
        chargeAuthAttempts(database, 'enrollment', [
          await networkAuthAttemptCharge(
            request.headers,
            'enrollment',
            await activeAuthFingerprintKey(),
            ACCOUNTS_PER_NETWORK_WINDOW,
          ),
        ]),
      membership: {
        identityClaim: fields.identityClaim,
        contact: fields.contact,
        applicationReason: fields.applicationReason,
      },
    })

    if (!result.ok) {
      if (result.reason === 'invalid_input') {
        return failureResponse(request, {
          status: 400,
          code: result.issue.reason,
          field: result.issue.field,
          error: policyMessage(result.issue.field, result.issue.reason),
        })
      }
      if (result.reason === 'username_unavailable') {
        return failureResponse(request, {
          status: 409,
          code: result.reason,
          field: 'username',
          error: '这个用户名不可用，请换一个再试。',
        })
      }
      return failureResponse(request, {
        status: 503,
        code: 'unavailable',
        error: '注册暂时不可用，请稍后重试。',
      })
    }

    const destination = registrationAccountHref(
      request.nextUrl.searchParams.get('tournamentSlug'),
      true,
    )
    const response = withPrivateNoStore(
      identityWantsJson(request)
        ? NextResponse.json({ ok: true, redirectTo: destination })
        : NextResponse.redirect(new URL(destination, resolveSiteOrigin()), 303),
    )
    clearParticipantSessionCookie(clearAdminSessionCookie(response))
    return setIdentitySessionCookie(response, result.token, result.absoluteExpiresAt)
  } catch (error) {
    if (error instanceof AuthAttemptRateLimitError) {
      return failureResponse(request, {
        status: 429,
        code: 'rate',
        error: '这个网络刚刚创建了太多账号，请稍后再试。',
        retryAfter: error.retryAfterSeconds,
      })
    }
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return failureResponse(request, {
        status: 403,
        code: 'request',
        error: '这次提交未完成，请刷新页面后重试。',
      })
    }
    console.error('[identity] account registration unavailable', error)
    return failureResponse(request, {
      status: 503,
      code: 'setup',
      error: '注册暂时不可用，请稍后重试。',
    })
  }
}
