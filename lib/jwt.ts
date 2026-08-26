export interface TokenClaims {
  sub: string
}

function userInfoUrl() {
  const env = process.env.CLOUDBASE_ENV_ID
  if (!env) return null
  return `https://${env}.api.tcloudbasegateway.com/auth/v1/user/me`
}

function tokenSubject(token: string) {
  const payload = token.split('.')[1]
  if (!payload) return null

  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
    const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const claims = JSON.parse(text) as { sub?: unknown }
    return typeof claims.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

export async function verifyToken(token: string): Promise<TokenClaims | null> {
  const url = userInfoUrl()
  if (!url || !token) return null

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) return null

    const profile = (await response.json()) as { status?: string }
    const sub = tokenSubject(token)
    if (!sub || sub === 'anon' || profile.status !== 'ACTIVE') return null
    return { sub }
  } catch {
    return null
  }
}
