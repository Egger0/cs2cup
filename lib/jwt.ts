export interface TokenClaims {
  sub: string
  iss: string
  aud: string
  exp: number
}

interface JsonWebKeySet {
  keys: (JsonWebKey & { kid: string })[]
}

const KEY_TTL = 10 * 60 * 1000

let cachedKeys: Map<string, CryptoKey> | null = null
let cachedAt = 0

export function issuerUrl() {
  const explicit = process.env.CLOUDBASE_ISSUER
  if (explicit) return explicit.replace(/\/$/, '')
  const env = process.env.CLOUDBASE_ENV_ID
  const region = process.env.CLOUDBASE_REGION ?? 'ap-shanghai'
  if (!env) return null
  return `https://${env}.${region}.tcb-api.tencentcloudapi.com`
}

async function loadKeys(issuer: string) {
  if (cachedKeys && Date.now() - cachedAt < KEY_TTL) return cachedKeys

  const discovery = await fetch(`${issuer}/.well-known/openid-configuration`)
  if (!discovery.ok) throw new Error(`oidc discovery failed: ${discovery.status}`)
  const { jwks_uri: jwksUri } = (await discovery.json()) as { jwks_uri: string }

  const response = await fetch(jwksUri)
  if (!response.ok) throw new Error(`jwks fetch failed: ${response.status}`)
  const { keys } = (await response.json()) as JsonWebKeySet

  const imported = new Map<string, CryptoKey>()
  for (const key of keys) {
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

  cachedKeys = imported
  cachedAt = Date.now()
  return imported
}

function decodeSegment(segment: string) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return JSON.parse(
    decodeURIComponent(
      Array.from(text, c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    ),
  ) as Record<string, unknown>
}

function base64UrlToBytes(segment: string) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(text, c => c.charCodeAt(0))
}

export async function verifyToken(token: string): Promise<TokenClaims | null> {
  const issuer = issuerUrl()
  if (!issuer) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerPart, payloadPart, signaturePart] = parts
  if (!headerPart || !payloadPart || !signaturePart) return null

  let header: { alg?: string; kid?: string }
  let claims: TokenClaims
  try {
    header = decodeSegment(headerPart) as { alg?: string; kid?: string }
    claims = decodeSegment(payloadPart) as unknown as TokenClaims
  } catch {
    return null
  }

  if (header.alg !== 'RS256' || !header.kid) return null

  let key: CryptoKey | undefined
  try {
    key = (await loadKeys(issuer)).get(header.kid)
  } catch {
    return null
  }
  if (!key) return null

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  )
  if (!valid) return null

  if (claims.iss !== issuer) return null
  if (claims.aud !== process.env.CLOUDBASE_ENV_ID) return null
  if (claims.exp * 1000 <= Date.now()) return null
  if (!claims.sub || claims.sub === 'anon') return null

  return claims
}
