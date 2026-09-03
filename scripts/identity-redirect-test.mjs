import assert from 'node:assert/strict'

import { isIdentityRedirectKey, resolveIdentityRedirect } from '../lib/identity/redirects.ts'

assert.equal(isIdentityRedirectKey('account'), true)
assert.equal(isIdentityRedirectKey('workspaces'), true)
assert.equal(isIdentityRedirectKey('/admin'), false)
assert.equal(isIdentityRedirectKey('https://attacker.example'), false)
assert.equal(resolveIdentityRedirect('account'), '/account')
assert.equal(resolveIdentityRedirect('account_security'), '/account/security')
assert.equal(resolveIdentityRedirect('workspaces'), '/admin')
assert.equal(resolveIdentityRedirect('tournaments'), '/tournaments')
assert.equal(
  resolveIdentityRedirect('registration', { tournamentSlug: 'autumn-cup-2026' }),
  '/tournaments/autumn-cup-2026/register',
)
assert.equal(
  resolveIdentityRedirect('registration', { tournamentSlug: '//attacker.example' }),
  '/tournaments',
)
assert.equal(resolveIdentityRedirect('registration', null), '/tournaments')

console.log('identity redirect tests passed')
