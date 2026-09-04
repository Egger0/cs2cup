import 'server-only'

import { authorize } from './internal/authorization.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'

export interface PlatformAuditEvent {
  readonly id: string
  readonly label: string
  readonly actor: string
  readonly subject: string | null
  readonly resource: string
  readonly reason: string | null
  readonly createdAt: number
}

const EVENT_LABELS: Readonly<Record<string, string>> = {
  'identity.role.granted': '授予权限',
  'identity.role.revoked': '撤销权限',
  'membership.access.suspended': '暂停成员资格',
  'membership.access.restored': '恢复成员资格',
  'membership.access.revoked': '撤销成员资格',
  'membership.application.review_started': '领取资格申请',
  'membership.application.approved': '通过资格申请',
  'membership.application.changes_requested': '要求补充材料',
  'membership.application.rejected': '拒绝资格申请',
  'membership.application.transfer_offered': '发起审核转交',
  'membership.application.transfer_accepted': '接收审核转交',
  'registration.access.manager_accepted': '接受报名协作',
  'registration.access.ownership_transferred': '转让报名所有权',
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  identity_reviewer: '资格审核员',
  organizer: '赛事组织者',
  referee: '裁判',
  check_in_operator: '签到操作员',
}

function eventLabel(eventType: string, role: string | null) {
  const label = EVENT_LABELS[eventType] ?? '安全操作'
  return role && ROLE_LABELS[role] ? `${label} · ${ROLE_LABELS[role]}` : label
}

function resourceLabel(type: string | null, tournamentTitle: string | null) {
  if (type === 'tournament') return tournamentTitle ? `赛事 · ${tournamentTitle}` : '赛事权限'
  if (type === 'platform') return '平台权限'
  if (type === 'membership') return '成员资格'
  if (type === 'membership_application') return '资格申请'
  if (type === 'registration') return '赛事报名'
  if (type === 'account') return '统一账号'
  if (type === 'session') return '登录会话'
  return '账号安全'
}

export async function listPlatformAuditEvents(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  options: { readonly now?: number; readonly limit?: number; readonly offset?: number } = {},
) {
  const now = options.now ?? Date.now()
  const limit = options.limit ?? 20
  const offset = options.offset ?? 0
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return { ok: false, reason: 'invalid_input' } as const
  }
  const decision = await authorize(
    database,
    context,
    'platform.audit.view',
    { kind: 'platform' },
    undefined,
    now,
  )
  if (!decision.ok) {
    const reason =
      decision.reason === 'assurance_required'
        ? 'reauthentication_required'
        : decision.reason === 'session_invalid' || decision.reason === 'recovery_restricted'
          ? 'session_invalid'
          : 'forbidden'
    return { ok: false, reason } as const
  }
  const [count, events] = await Promise.all([
    database
      .prepare('SELECT COUNT(*) AS total FROM identity_security_event')
      .bind()
      .first<{ total: number }>(),
    database
      .prepare(
        `SELECT event.id, event.event_type,
                COALESCE(actor.display_name, event.actor_type) AS actor,
                target.display_name AS target, event.resource_type,
                tournament.title AS tournament_title,
                json_extract(event.details_json, '$.role') AS role,
                json_extract(event.details_json, '$.reason') AS reason,
                event.created_at
         FROM identity_security_event AS event
         LEFT JOIN identity_account AS actor ON actor.id = event.actor_account_id
         LEFT JOIN identity_account AS target ON target.id = event.target_account_id
         LEFT JOIN tournament ON event.resource_type = 'tournament'
           AND tournament.id = CAST(event.resource_id AS INTEGER)
         ORDER BY event.created_at DESC, event.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset)
      .all<{
        id: string
        event_type: string
        actor: string
        target: string | null
        resource_type: string | null
        tournament_title: string | null
        role: string | null
        reason: string | null
        created_at: number
      }>(),
  ])
  return {
    ok: true,
    total: Number(count?.total) || 0,
    events: events.results.map(
      row =>
        ({
          id: row.id,
          label: eventLabel(row.event_type, row.role),
          actor:
            row.actor === 'system' ? '系统' : row.actor === 'anonymous' ? '匿名访问' : row.actor,
          subject: row.target,
          resource: resourceLabel(row.resource_type, row.tournament_title),
          reason:
            row.event_type === 'identity.role.granted' || row.event_type === 'identity.role.revoked'
              ? row.reason
              : null,
          createdAt: row.created_at,
        }) satisfies PlatformAuditEvent,
    ),
    pagination: {
      offset,
      limit,
      hasPrevious: offset > 0,
      hasNext: offset + events.results.length < (Number(count?.total) || 0),
    },
  } as const
}
