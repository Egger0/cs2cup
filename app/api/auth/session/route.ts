import { NextResponse, type NextRequest } from 'next/server'

import { clearAdminSessionCookie } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { activeAuthFingerprintKey } from '@/lib/identity/internal/auth-fingerprint-config'
import { createAuthAttemptFingerprint } from '@/lib/identity/internal/auth-fingerprint'
import {
  AuthAttemptRateLimitError,
  chargeAuthAttempts,
} from '@/lib/identity/internal/auth-attempts'
import { networkAuthAttemptCharge } from '@/lib/identity/internal/auth-network'
import {
  IdentityRequestError,
  identityWantsJson,
  readIdentityForm,
} from '@/lib/identity/internal/http'
import { authenticatePassword } from '@/lib/identity/internal/password-authentication'
import { passwordPepperSet } from '@/lib/identity/internal/password-config'
import { normalizeUsername } from '@/lib/identity/internal/username-policy'
import { clearIdentitySessionCookie, setIdentitySessionCookie } from '@/lib/identity/kernel'
import { isIdentityRedirectKey, resolveIdentityRedirect } from '@/lib/identity/redirects'
import { legacySessionStateFromRequest } from '@/lib/legacy-session-state'
import { createOpaqueToken, hashOpaqueToken } from '@/lib/opaque-token'
import { clearParticipantSessionCookie } from '@/lib/participant-auth'
import { resolveSiteOrigin } from '@/lib/site-config'

const FIELDS = ['username', 'password', 'redirectKey', 'tournamentSlug'] as const

function destination(redirectKey: string, tournamentSlug: string) {
  return isIdentityRedirectKey(redirectKey)
    ? resolveIdentityRedirect(redirectKey, { tournamentSlug })
    : resolveIdentityRedirect('account')
}

function responseFor(
  request: NextRequest,
  target: string,
  result: { status: number; code: string; message: string; retryAfter?: number },
) {
  const response = identityWantsJson(request)
    ? NextResponse.json(
        { ok: false, code: result.code, error: result.message },
        { status: result.status },
      )
    : NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(result.code)}`, resolveSiteOrigin()),
        303,
      )
  if (result.retryAfter) response.headers.set('Retry-After', String(result.retryAfter))
  response.headers.set('X-Identity-Next', target)
  return withPrivateNoStore(response)
}

function successResponse(request: NextRequest, target: string) {
  return withPrivateNoStore(
    identityWantsJson(request)
      ? NextResponse.json({ ok: true, redirectTo: target })
      : NextResponse.redirect(new URL(target, resolveSiteOrigin()), 303),
  )
}

export async function POST(request: NextRequest) {
  let target = resolveIdentityRedirect('account')
  try {
    assertCsrfRequest(request)
    const fields = await readIdentityForm(request, FIELDS)
    target = destination(fields.redirectKey, fields.tournamentSlug)
    const username = normalizeUsername(fields.username) ?? fields.username.trim().toLowerCase()
    const fingerprintKey = await activeAuthFingerprintKey()
    const [networkCharge, usernameCharge] = await Promise.all([
      networkAuthAttemptCharge(request.headers, 'sign_in', fingerprintKey, 50),
      createAuthAttemptFingerprint(fingerprintKey, 'sign_in', 'identity', username).then(value => ({
        dimension: 'identity' as const,
        ...value,
        limit: 10,
      })),
    ])
    const db = cloudflareBindings().db
    await chargeAuthAttempts(db, 'sign_in', [networkCharge, usernameCharge])
    const currentToken = request.cookies.get('__Host-cs2cup_session')?.value ?? null
    const [currentTokenHash, legacy] = await Promise.all([
      currentToken ? hashOpaqueToken(currentToken) : null,
      legacySessionStateFromRequest(request),
    ])
    const result = await authenticatePassword(
      db,
      { username: fields.username, password: fields.password },
      await passwordPepperSet(),
      Date.now(),
      {
        unifiedTokenHash: currentTokenHash,
        legacyAdminTokenHash: legacy.adminTokenHash,
        legacyParticipantTokenHash: legacy.participantTokenHash,
      },
    )
    if (!result.ok) {
      const locked = result.reason === 'temporarily_locked'
      return responseFor(request, target, {
        status: locked ? 429 : result.reason === 'configuration_unavailable' ? 503 : 401,
        code: locked
          ? 'locked'
          : result.reason === 'configuration_unavailable'
            ? 'setup'
            : 'invalid',
        message: locked
          ? '尝试次数较多，请稍后再试；现有账号和资料不会改变。'
          : result.reason === 'configuration_unavailable'
            ? '登录服务暂时不可用，请稍后重试。'
            : '用户名或密码不正确，请重新输入。',
      })
    }

    const response = clearParticipantSessionCookie(
      clearAdminSessionCookie(successResponse(request, target)),
    )
    return setIdentitySessionCookie(response, result.token, result.absoluteExpiresAt)
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return responseFor(request, target, {
        status: 403,
        code: 'request',
        message: '请求来源无法确认，请刷新页面后重试。',
      })
    }
    if (error instanceof AuthAttemptRateLimitError) {
      return responseFor(request, target, {
        status: 429,
        code: 'rate',
        message: '尝试过于频繁，请稍后再试。',
        retryAfter: error.retryAfterSeconds,
      })
    }
    console.error('[identity] password sign-in unavailable', error)
    return responseFor(request, target, {
      status: 503,
      code: 'setup',
      message: '登录服务暂时不可用，请稍后重试。',
    })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const token = request.cookies.get('__Host-cs2cup_session')?.value ?? null
    const [tokenHash, legacy] = await Promise.all([
      token ? hashOpaqueToken(token) : null,
      legacySessionStateFromRequest(request),
    ])
    const db = cloudflareBindings().db
    const statements = []
    if (tokenHash) {
      statements.push(
        db
          .prepare(
            `UPDATE identity_session SET revoked_at = ?, revoke_reason = 'signed_out',
                    revision = revision + 1, write_nonce = ?
             WHERE token_hash = ? AND revoked_at IS NULL`,
          )
          .bind(Date.now(), createOpaqueToken(), tokenHash),
      )
    }
    if (legacy.adminTokenHash) {
      statements.push(
        db.prepare('DELETE FROM admin_session WHERE token_hash = ?').bind(legacy.adminTokenHash),
      )
    }
    if (legacy.participantTokenHash) {
      statements.push(
        db
          .prepare('DELETE FROM participant_session WHERE token_hash = ?')
          .bind(legacy.participantTokenHash),
      )
    }
    if (statements.length) await db.batch(statements)
    return clearParticipantSessionCookie(
      clearAdminSessionCookie(
        clearIdentitySessionCookie(withPrivateNoStore(new NextResponse(null, { status: 204 }))),
      ),
    )
  } catch (error) {
    const status = error instanceof CsrfError ? 403 : 503
    return withPrivateNoStore(
      NextResponse.json({ error: '暂时无法退出，请稍后重试。' }, { status }),
    )
  }
}
