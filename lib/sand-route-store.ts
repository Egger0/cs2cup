import 'server-only'

import { cloudflareBindings } from './cloudflare-bindings'
import { parseWaypoints, type SandPlan, type Waypoint } from './sand-routes'

interface SandRouteRow {
  id: number
  mapId: string
  level: number
  title: string
  author: string | null
  status: string
  waypoints: string
}

const SELECT = `SELECT route.id, route.map_id AS mapId, route.level, route.title, route.status,
  route.waypoints, account.display_name AS author
  FROM sand_route AS route
  LEFT JOIN identity_account AS account ON account.id = route.account_id`

function toPlan(row: SandRouteRow): SandPlan[] {
  let waypoints: Waypoint[] | null = null
  try {
    waypoints = parseWaypoints(JSON.parse(row.waypoints))
  } catch {}
  return waypoints
    ? [
        {
          id: row.id,
          mapId: row.mapId,
          level: row.level,
          title: row.title,
          author: row.author ?? '社员',
          approved: row.status === 'approved',
          waypoints,
        },
      ]
    : []
}

export async function listSandPlans(scope: 'approved' | 'all') {
  const { results } = await cloudflareBindings()
    .db.prepare(
      `${SELECT} WHERE ?1 = 'all' OR route.status = 'approved'
       ORDER BY route.status DESC, route.created_at DESC, route.id DESC`,
    )
    .bind(scope)
    .all<SandRouteRow>()
  return results.flatMap(toPlan)
}

export async function findSandPlan(id: number) {
  const row = await cloudflareBindings()
    .db.prepare(`${SELECT} WHERE route.id = ?`)
    .bind(id)
    .first<SandRouteRow>()
  return row ? (toPlan(row)[0] ?? null) : null
}

export function insertSandRoute(
  accountId: string,
  route: Pick<SandPlan, 'mapId' | 'level' | 'title' | 'waypoints'>,
  now: number,
) {
  return cloudflareBindings()
    .db.prepare(
      `INSERT INTO sand_route (account_id, map_id, level, title, waypoints, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(accountId, route.mapId, route.level, route.title, JSON.stringify(route.waypoints), now)
    .run()
}

export function approveSandRoute(id: number) {
  return cloudflareBindings()
    .db.prepare("UPDATE sand_route SET status = 'approved' WHERE id = ?")
    .bind(id)
    .run()
}

export function deleteSandRoute(id: number) {
  return cloudflareBindings().db.prepare('DELETE FROM sand_route WHERE id = ?').bind(id).run()
}
