import assert from 'node:assert/strict'

import { ownedEntryRecoveryAction } from '../lib/participant-owner-recovery.ts'

assert.equal(ownedEntryRecoveryAction(false, false), 'login-and-confirm')
assert.equal(ownedEntryRecoveryAction(true, false), 'switch-participant')
assert.equal(ownedEntryRecoveryAction(true, true), 'switch-participant')
assert.equal(ownedEntryRecoveryAction(false, true), 'contact-organizer')

console.log('participant owner recovery tests passed')
