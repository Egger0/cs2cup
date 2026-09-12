import assert from 'node:assert/strict'

import { httpsRedirect, resolveSiteOrigin } from '../lib/site-config.ts'

assert.equal(resolveSiteOrigin(undefined), 'http://localhost:3000')
assert.equal(resolveSiteOrigin(''), 'http://localhost:3000')
assert.equal(resolveSiteOrigin('   '), 'http://localhost:3000')
assert.equal(resolveSiteOrigin(' https://example.com '), 'https://example.com')
assert.equal(resolveSiteOrigin('http://127.0.0.1:3100/'), 'http://127.0.0.1:3100')

for (const value of [
  'example.com',
  'ftp://example.com',
  'https://user@example.com',
  'https://example.com/path',
  'https://example.com?preview=1',
  'https://example.com#section',
]) {
  assert.throws(() => resolveSiteOrigin(value), /must be an absolute HTTP\(S\) origin/)
}

const production = 'https://cup.example'

const upgraded = httpsRedirect(new Request('http://cup.example/register?a=1'), production)
assert.equal(upgraded?.status, 301)
assert.equal(upgraded?.headers.get('location'), 'https://cup.example/register?a=1')

assert.equal(
  httpsRedirect(new Request('http://cup.example:8080/register'), production)?.headers.get(
    'location',
  ),
  'https://cup.example/register',
)
assert.equal(
  httpsRedirect(new Request('http://cup.example/api/auth/register', { method: 'POST' }), production)
    ?.status,
  301,
)
assert.equal(httpsRedirect(new Request('https://cup.example/register'), production), null)
assert.equal(httpsRedirect(new Request('http://localhost:3000/register'), undefined), null)
assert.equal(
  httpsRedirect(new Request('http://localhost:3000/register'), 'http://localhost:3000'),
  null,
)

console.log('site configuration tests passed')
