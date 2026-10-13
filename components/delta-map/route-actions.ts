'use server'

import { currentTimeMillis } from '@/lib/current-time'
import { DELTA_MAPS } from '@/lib/delta-maps'
import { getAuthContext } from '@/lib/identity/kernel'
import { insertSandRoute } from '@/lib/sand-route-store'
import { ROUTE_PENDING_LIMIT, ROUTE_TITLE_LIMIT, parseWaypoints } from '@/lib/sand-routes'

export type SandRouteSubmission = { ok: true } | { ok: false; error: string; signIn?: boolean }

export async function submitSandRoute(input: {
  mapId: string
  level: number
  title: string
  waypoints: unknown
}): Promise<SandRouteSubmission> {
  const context = await getAuthContext()
  if (context.kind === 'anonymous' || context.session.recoveryRestricted) {
    return { ok: false, error: '登录后才能投稿路线。', signIn: true }
  }
  const map = DELTA_MAPS.find(entry => entry.id === input.mapId)
  const title = String(input.title ?? '').trim()
  const waypoints = parseWaypoints(input.waypoints)
  if (!map || !Number.isInteger(input.level) || !map.levels[input.level]) {
    return { ok: false, error: '没认出这张地图或难度。' }
  }
  if (!title || title.length > ROUTE_TITLE_LIMIT) {
    return { ok: false, error: `路线名需要 1 到 ${ROUTE_TITLE_LIMIT} 个字。` }
  }
  if (!waypoints) return { ok: false, error: '路线需要 2 到 40 个途经点，每站思路最多 120 个字。' }
  if (!waypoints.some(([, , note]) => note)) {
    return { ok: false, error: '至少给一站写上思路，别人才知道这条路线怎么跑。' }
  }

  try {
    await insertSandRoute(
      context.account.id,
      { mapId: map.id, level: input.level, title, waypoints },
      currentTimeMillis(),
    )
  } catch (error) {
    if (error instanceof Error && /sand route submission rejected/.test(error.message)) {
      return { ok: false, error: `你已有 ${ROUTE_PENDING_LIMIT} 条路线在等审核，通过后再投。` }
    }
    throw error
  }
  return { ok: true }
}
