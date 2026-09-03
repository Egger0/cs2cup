import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/headers') {
      return {
        url: dataModule(`export async function cookies() { throw new Error('Unexpected read') }`),
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  ENROLLMENT_ACTIVATION_COOKIE,
  ENROLLMENT_BROWSER_COOKIE,
  ENROLLMENT_RECEIPT_COOKIE,
  clearEnrollmentCookies,
  setEnrollmentActivationCookie,
  setEnrollmentProofCookies,
} = await import('../lib/identity/internal/enrollment-cookie.ts')

const writes = []
const response = { cookies: { set: (...values) => writes.push(values) } }
setEnrollmentProofCookies(response, { receipt: 'A'.repeat(43), browserBinding: 'B'.repeat(43) })
setEnrollmentActivationCookie(response, 'C'.repeat(43))
clearEnrollmentCookies(response)
assert.deepEqual(
  writes.slice(0, 3).map(([name]) => name),
  [ENROLLMENT_RECEIPT_COOKIE, ENROLLMENT_BROWSER_COOKIE, ENROLLMENT_ACTIVATION_COOKIE],
)
for (const [, , cookieOptions] of writes) {
  assert.equal(cookieOptions.httpOnly, true)
  assert.equal(cookieOptions.secure, true)
  assert.equal(cookieOptions.sameSite, 'lax')
  assert.equal(cookieOptions.path, '/')
}
assert.deepEqual(
  writes.slice(-3).map(([name, value, cookieOptions]) => [name, value, cookieOptions.maxAge]),
  [
    [ENROLLMENT_RECEIPT_COOKIE, '', 0],
    [ENROLLMENT_BROWSER_COOKIE, '', 0],
    [ENROLLMENT_ACTIVATION_COOKIE, '', 0],
  ],
)

console.log('identity enrollment cookies passed')
