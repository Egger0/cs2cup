import assert from 'node:assert/strict'

import { accountHeaderLinks, accountSections } from '../lib/account-navigation.ts'

const member = { hasWorkAccess: false, recoveryRestricted: false }
const staff = { hasWorkAccess: true, recoveryRestricted: false }
const recovering = { hasWorkAccess: true, recoveryRestricted: true }

const hrefs = links => links.map(link => link.href)

assert.deepEqual(hrefs(accountSections(member)), ['/me', '/account', '/account/security'])
assert.deepEqual(hrefs(accountHeaderLinks(member)), ['/me', '/account', '/account/security'])

assert.deepEqual(hrefs(accountSections(staff)), ['/me', '/account', '/account/security', '/admin'])
assert.deepEqual(
  hrefs(accountHeaderLinks(staff)),
  ['/me', '/account', '/account/security', '/admin'],
  'the account tabs and the star map must offer the same workbench entry',
)
assert.equal(accountSections(staff).at(-1)?.label, '工作台')

assert.deepEqual(hrefs(accountSections(recovering)), ['/account/security'])
assert.deepEqual(hrefs(accountHeaderLinks(recovering)), ['/account/security'])

assert.deepEqual(hrefs(accountHeaderLinks(null)), ['/login', '/register'])

console.log('account navigation tests passed')
