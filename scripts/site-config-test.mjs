import assert from 'node:assert/strict'

import { resolveSiteOrigin } from '../lib/site-config.ts'

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

console.log('site configuration tests passed')
