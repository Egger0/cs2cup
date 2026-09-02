import assert from 'node:assert/strict'

import { WEBAUTHN_RP_NAME, resolveWebAuthnConfig } from '../lib/webauthn-config.ts'

assert.deepEqual(resolveWebAuthnConfig('https://cn.nbtesportsclub.online'), {
  rpName: '宁波理工电竞社',
  origin: 'https://cn.nbtesportsclub.online',
  rpID: 'cn.nbtesportsclub.online',
})
assert.equal(WEBAUTHN_RP_NAME, '宁波理工电竞社')

assert.deepEqual(resolveWebAuthnConfig('https://cup.example:8443'), {
  rpName: '宁波理工电竞社',
  origin: 'https://cup.example:8443',
  rpID: 'cup.example',
})

for (const origin of ['http://localhost', 'http://localhost:3000', 'http://localhost:65535']) {
  const config = resolveWebAuthnConfig(origin)
  assert.equal(config.origin, origin)
  assert.equal(config.rpID, 'localhost')
}

const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
try {
  delete process.env.NEXT_PUBLIC_SITE_URL
  assert.throws(() => resolveWebAuthnConfig(), /must be an exact HTTPS production origin/)

  process.env.NEXT_PUBLIC_SITE_URL = 'https://identity.example'
  assert.equal(resolveWebAuthnConfig().origin, 'https://identity.example')
} finally {
  if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl
}

for (const value of [
  '',
  ' ',
  ' https://cup.example',
  'https://cup.example ',
  'https://cup.example\n',
  'cup.example',
  'ftp://cup.example',
  'http://cup.example',
  'http://sub.localhost:3000',
  'https://localhost',
  'https://sub.localhost',
  'http://127.0.0.1:3000',
  'https://127.0.0.1',
  'https://[::1]',
  'https://user@cup.example',
  'https://user:password@cup.example',
  'https://cup.example/',
  'https://cup.example/account',
  'https://cup.example?preview=1',
  'https://cup.example#security',
  'https://cup.example:443',
  'https://CUP.example',
  'https://cup.example.',
  'https://-cup.example',
  'https://cup-.example',
  'https://cup_name.example',
  'https://cup..example',
  'https://internal',
  'http://localhost/',
  'http://localhost:0',
  'http://LOCALHOST:3000',
  'https://workers.dev',
  'https://identity.workers.dev',
  'https://pages.dev',
  'https://identity.pages.dev',
]) {
  assert.throws(
    () => resolveWebAuthnConfig(value),
    /must be an exact HTTPS production origin or http:\/\/localhost\[:port\]/,
    `unsafe WebAuthn origin was accepted: ${String(value)}`,
  )
}

assert.equal(
  resolveWebAuthnConfig('https://workers.dev.example').rpID,
  'workers.dev.example',
  'preview-host text outside the hostname suffix must not cause a false positive',
)

console.log('WebAuthn configuration tests passed')
