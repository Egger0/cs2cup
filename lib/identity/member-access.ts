import 'server-only'

import { cloudflareBindings } from '../cloudflare-bindings.ts'
import { getAuthContext } from './kernel.ts'

export async function isApprovedMember(accountId: string) {
  const row = await cloudflareBindings()
    .db.prepare(
      `SELECT 1 AS ok FROM identity_membership WHERE account_id = ? AND status = 'approved'`,
    )
    .bind(accountId)
    .first()
  return Boolean(row)
}

export async function currentUserIsMember() {
  const context = await getAuthContext()
  return (
    context.kind === 'authenticated' &&
    !context.session.recoveryRestricted &&
    isApprovedMember(context.account.id)
  )
}
