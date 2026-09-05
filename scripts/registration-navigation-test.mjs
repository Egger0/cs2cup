import assert from 'node:assert/strict'
import {
  registrationAccountHref,
  registrationAuthHref,
  registrationDestination,
  registrationSlug,
} from '../lib/registration-navigation.ts'

const slug = '2026-nlc'
for (const route of ['login', 'register', 'recover']) {
  const url = new URL(registrationAuthHref(route, slug), 'https://example.test')
  assert.equal(url.pathname, `/${route}`)
  assert.equal(url.searchParams.get('tournamentSlug'), slug)
  assert.equal(url.searchParams.get('redirectKey'), route === 'login' ? 'registration' : null)
}
assert.equal(registrationDestination(slug), '/tournaments/2026-nlc/register')
assert.equal(registrationAccountHref(slug, true), '/account?welcome=1&tournamentSlug=2026-nlc')
assert.equal(registrationAccountHref(undefined, true), '/account?welcome=1')
assert.equal(registrationAccountHref(slug), '/account?tournamentSlug=2026-nlc')
for (const invalid of [
  undefined,
  null,
  ['2026-nlc'],
  '',
  '../admin',
  '//example.test',
  'https://example.test',
  'a?redirect=x',
  'a#x',
  'a/b',
  'a%2Fb',
  'a'.repeat(101),
]) {
  assert.equal(registrationSlug(invalid), null)
  assert.equal(registrationDestination(invalid), '/tournaments')
  assert.equal(registrationAccountHref(invalid), '/account')
  for (const route of ['login', 'register', 'recover']) {
    assert.equal(registrationAuthHref(route, invalid), `/${route}`)
  }
}
console.log('Registration continuation links and unsafe destination rejection passed')
