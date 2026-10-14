'use server'

import { requireSandRouteManagement } from '@/lib/project-content-access'
import { approveSandRoute, deleteSandRoute } from '@/lib/sand-route-store'

export async function reviewSandRoute(id: number, verdict: 'approve' | 'delete') {
  await requireSandRouteManagement()
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false as const, error: '路线编号无效' }
  if (verdict !== 'approve' && verdict !== 'delete')
    return { ok: false as const, error: '审核操作无效' }
  await (verdict === 'approve' ? approveSandRoute(id) : deleteSandRoute(id))
  return { ok: true as const }
}
