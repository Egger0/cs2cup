export interface TokenClaims {
  sub: string
}

interface OidcClaims {
  sub?: unknown
  iss?: unknown
  aud?: unknown
  exp?: unknown
}

interface JsonWebKeySet {
  keys: (JsonWebKey & { kid?: string })[]
}

const KEY_TTL = 10 * 60 * 1000
let cachedIssuer = ''
let cachedKeys: Map<string, CryptoKey> | null = null
let cachedAt = 0

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

function base64UrlToBytes(segment: string) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(text, character => character.charCodeAt(0))
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as Record<string, unknown>
  } catch {
    return null
  }
}

async function loadOidcKeys(issuer: string) {
  if (cachedIssuer === issuer && cachedKeys && Date.now() - cachedAt < KEY_TTL) {
    return cachedKeys
  }

  const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, {
    cache: 'no-store',
  })
  if (!discovery.ok) throw new Error(`OIDC discovery failed: ${discovery.status}`)
  const metadata = (await discovery.json()) as { jwks_uri?: unknown }
  if (typeof metadata.jwks_uri !== 'string') throw new Error('OIDC discovery omitted jwks_uri')

  const response = await fetch(metadata.jwks_uri, { cache: 'no-store' })
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`)
  const { keys } = (await response.json()) as JsonWebKeySet

  const imported = new Map<string, CryptoKey>()
  for (const key of keys) {
    if (!key.kid || key.alg !== 'RS256') continue
    imported.set(
      key.kid,
      await crypto.subtle.importKey(
        'jwk',
        key,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    )
  }

  cachedIssuer = issuer
  cachedKeys = imported
  cachedAt = Date.now()
  return imported
}

async function verifyOidcToken(token: string, issuer: string): Promise<TokenClaims | null> {
  const expectedAudience = process.env.CLOUDBASE_ENV_ID
  if (!expectedAudience) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerPart, payloadPart, signaturePart] = parts
  if (!headerPart || !payloadPart || !signaturePart) return null

  const header = decodeSegment(headerPart)
  const claims = decodeSegment(payloadPart) as OidcClaims | null
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !claims) return null

  try {
    const key = (await loadOidcKeys(issuer)).get(header.kid)
    if (!key) return null
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    )
    if (!valid) return null
  } catch {
    return null
  }

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== issuer || !audience.includes(expectedAudience)) return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null
  if (typeof claims.sub !== 'string' || claims.sub === 'anon') return null
  return { sub: claims.sub }
}

export async function verifyToken(token: string): Promise<TokenClaims | null> {
  const issuer = process.env.CLOUDBASE_ISSUER?.replace(/\/$/, '')
  if (issuer) return verifyOidcToken(token, issuer)

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
