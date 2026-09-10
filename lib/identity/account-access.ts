import 'server-only'

import { cloudflareBindings } from '../cloudflare-bindings.ts'
import type { AccountAccess } from '../account-navigation.ts'
import { accountHasWorkAccess } from './account-security-state.ts'
import { getAuthContext } from './kernel.ts'

export async function currentAccountAccess(): Promise<AccountAccess | null> {
  try {
    const database = cloudflareBindings().db
    const context = await getAuthContext({ database })
    if (context.kind === 'anonymous') return null
    if (context.session.recoveryRestricted)
      return { hasWorkAccess: false, recoveryRestricted: true }
    return {
      hasWorkAccess: await accountHasWorkAccess(database, context.account.id),
      recoveryRestricted: false,
    }
  } catch {
    return null
  }
}
