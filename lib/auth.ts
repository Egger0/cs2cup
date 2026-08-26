import 'server-only'
import { cookies } from 'next/headers'
import { selectRow } from './rdb'

export const SESSION_COOKIE = 'cs2cup_session'

export interface AdminIdentity {
  uid: string
}

interface JsonWebKeySet {
  keys: (JsonWebKey & { kid: string })[]
}

interface TokenClaims {
  sub: string
  iss: string
  aud: string
  exp: number
}

let cachedKeys: Map<string, CryptoKey> | null = null
let cachedAt = 0

const KEY_TTL = 10 * 60 * 1000

function issuer() {
  const explicit = process.env.CLOUDBASE_ISSUER
  if (explicit) return explicit.replace(/\/$/, '')
  const env = process.env.CLOUDBASE_ENV_ID
  const region = process.env.CLOUDBASE_REGION ?? 'ap-shanghai'
  if (!env) throw new Error('CLOUDBASE_ENV_ID or CLOUDBASE_ISSUER must be set')
  return `https://${env}.${region}.tcb-api.tencentcloudapi.com`
}

async function loadKeys() {
  if (cachedKeys && Date.now() - cachedAt < KEY_TTL) return cachedKeys

  const discovery = await fetch(`${issuer()}/.well-known/openid-configuration`)
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

function decode(segment: string) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString()) as Record<string, unknown>
}

export async function verifyToken(token: string): Promise<TokenClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerPart, payloadPart, signaturePart] = parts
  if (!headerPart || !payloadPart || !signaturePart) return null

  const header = decode(headerPart) as { alg?: string; kid?: string }
  if (header.alg !== 'RS256' || !header.kid) return null

  const key = (await loadKeys()).get(header.kid)
  if (!key) return null

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    Buffer.from(signaturePart, 'base64url'),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  )
  if (!valid) return null

  const claims = decode(payloadPart) as unknown as TokenClaims
  if (claims.iss !== issuer()) return null
  if (claims.aud !== process.env.CLOUDBASE_ENV_ID) return null
  if (claims.exp * 1000 <= Date.now()) return null
  if (!claims.sub || claims.sub === 'anon') return null

  return claims
}

async function isWhitelisted(uid: string) {
  const row = await selectRow<{ user_id: string }>('admin_user', {
    select: 'user_id',
    filters: { user_id: `eq.${uid}` },
    credential: 'admin',
    revalidate: false,
  })
  return row !== null
}

export async function getCurrentAdmin(): Promise<AdminIdentity | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null

  const claims = await verifyToken(token)
  if (!claims) return null
  if (!(await isWhitelisted(claims.sub))) return null

  return { uid: claims.sub }
}

export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getCurrentAdmin()
  if (!admin) throw new Error('unauthorized')
  return admin
}
