import assert from 'node:assert/strict'
import { createHmac, pbkdf2Sync, randomBytes as nodeRandomBytes } from 'node:crypto'

import {
  ADMIN_AUTH_PEPPER_BYTES,
  ADMIN_PASSWORD_HASH_BYTES,
  ADMIN_PASSWORD_ITERATIONS,
  ADMIN_PASSWORD_SALT_BYTES,
  ADMIN_SESSION_TOKEN_BYTES,
  adminAccountFingerprint,
  adminNetworkFingerprint,
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToHex,
  createAdminSessionToken,
  deriveAdminPasswordHash,
  digestAdminSessionToken,
  hexToBytes,
  normalizeAdminPassword,
  normalizeAdminUsername,
  parseAdminAuthPepper,
  sameBytes,
} from '../lib/admin-auth-crypto.ts'
import {
  adminSessionCookie,
  parseAdminSessionCookie,
} from '../lib/admin-session-cookie.ts'

const pepper = Uint8Array.from({ length: ADMIN_AUTH_PEPPER_BYTES }, (_, index) => index)
const salt = Uint8Array.from({ length: ADMIN_PASSWORD_SALT_BYTES }, (_, index) => 255 - index)
const decomposedPassword = `correct horse battery staple e\u0301`
const password = normalizeAdminPassword(decomposedPassword, true)

const peppered = createHmac('sha256', pepper)
  .update('cs2cup:admin-password:v1')
  .update('\0')
  .update(password)
  .digest()
const expected = pbkdf2Sync(
  peppered,
  salt,
  ADMIN_PASSWORD_ITERATIONS,
  ADMIN_PASSWORD_HASH_BYTES,
  'sha256',
)
const derived = await deriveAdminPasswordHash(
  decomposedPassword,
  salt,
  pepper,
)
await assert.rejects(
  deriveAdminPasswordHash(decomposedPassword, salt, pepper, 600_001),
  /work factor is invalid/i,
)
assert.equal(bytesToHex(derived), expected.toString('hex'))
assert.equal(sameBytes(derived, expected), true)
assert.equal(sameBytes(derived, nodeRandomBytes(ADMIN_PASSWORD_HASH_BYTES)), false)

assert.equal(normalizeAdminUsername('  管理员e\u0301  '), '管理员é')
assert.throws(() => normalizeAdminUsername(''), /username is invalid/i)
assert.throws(() => normalizeAdminUsername('bad\nname'), /username is invalid/i)
assert.throws(() => normalizeAdminPassword('short', true), /password is invalid/i)
assert.throws(() => normalizeAdminPassword('x'.repeat(1025)), /password is invalid/i)

const encodedPepper = bytesToBase64Url(pepper)
assert.deepEqual(parseAdminAuthPepper(encodedPepper), pepper)
assert.throws(() => parseAdminAuthPepper(`${encodedPepper}=`), /unpadded base64url/i)
assert.deepEqual(hexToBytes(bytesToHex(salt), ADMIN_PASSWORD_SALT_BYTES), salt)
assert.throws(() => hexToBytes('AA'), /hexadecimal value is invalid/i)

const token = createAdminSessionToken()
assert.equal(base64UrlToBytes(token, ADMIN_SESSION_TOKEN_BYTES).byteLength, 32)
assert.equal((await digestAdminSessionToken(token)).byteLength, 32)
assert.throws(() => base64UrlToBytes(`${token}=`, 32), /base64url value is invalid/i)

const account = await adminAccountFingerprint('admin', pepper)
const otherAccount = await adminAccountFingerprint('other', pepper)
const network = await adminNetworkFingerprint('203.0.113.0', pepper)
assert.equal(account.byteLength, 32)
assert.notEqual(bytesToHex(account), bytesToHex(otherAccount))
assert.notEqual(bytesToHex(account), bytesToHex(network))

assert.deepEqual(parseAdminSessionCookie('a=1; cs2cup_admin=token; b=2', 'cs2cup_admin'), {
  value: 'token',
  duplicate: false,
})
assert.deepEqual(
  parseAdminSessionCookie('cs2cup_admin=first; cs2cup_admin=second', 'cs2cup_admin'),
  { value: null, duplicate: true },
)

assert.deepEqual(
  adminSessionCookie.options({
    NODE_ENV: 'production',
    NEXT_PUBLIC_SITE_URL: 'https://cup.example',
  }),
  {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    priority: 'high',
  },
)
assert.equal(
  adminSessionCookie.options({
    NODE_ENV: 'production',
    NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
  }).secure,
  false,
)
assert.throws(
  () => adminSessionCookie.options({
    NODE_ENV: 'production',
    NEXT_PUBLIC_SITE_URL: 'http://cup.example',
  }),
  /require an HTTPS site origin/i,
)

console.log('administrator authentication crypto tests passed')
