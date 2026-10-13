'use server'

import { requireAdmin } from '@/lib/auth'
import { approveSandRoute, deleteSandRoute } from '@/lib/sand-route-store'

export async function reviewSandRoute(id: number, verdict: 'approve' | 'delete') {
  await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false as const, error: '路线编号无效' }
  await (verdict === 'approve' ? approveSandRoute(id) : deleteSandRoute(id))
  return { ok: true as const }
}
