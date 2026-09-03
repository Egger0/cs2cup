import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import type { IdentityDatabase, IdentityStatement } from './contracts.ts'

const EVENT_TYPE = /^[a-z][a-z0-9_.-]{2,95}$/
const RESOURCE_TYPE = /^[a-z][a-z0-9_.-]{0,63}$/
const CORRELATION_ID = /^[A-Za-z0-9_.:-]{16,128}$/

type SecurityEventActor =
  | { readonly type: 'account'; readonly accountId: string; readonly sessionId?: string }
  | { readonly type: 'anonymous' | 'system' }

export interface SecurityEventInput {
  readonly eventType: string
  readonly severity?: 'info' | 'warning' | 'high' | 'critical'
  readonly actor: SecurityEventActor
  readonly targetAccountId?: string
  readonly resource?: { readonly type: string; readonly id?: string }
  readonly correlationId?: string
  readonly deduplicationScope: string
  readonly networkContext?: Readonly<Record<string, unknown>>
  readonly details?: Readonly<Record<string, unknown>>
  readonly retentionClass?: 'account_security' | 'access_control' | 'anonymous_sampled'
  readonly retentionUntil?: number
  readonly createdAt: number
}

function jsonObject(value: Readonly<Record<string, unknown>> | undefined, maxLength: number) {
  const serialized = JSON.stringify(value ?? {})
  if (serialized.length > maxLength) throw new RangeError('Security event metadata is too large')
  return serialized
}

function opaqueOrNull(value: string | undefined) {
  if (value === undefined) return null
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new TypeError('Invalid security event identity')
  return value
}

export async function securityEventStatement(
  database: IdentityDatabase,
  input: SecurityEventInput,
): Promise<IdentityStatement> {
  const severity = input.severity ?? 'info'
  const retentionClass = input.retentionClass ?? 'account_security'
  const correlationId = input.correlationId ?? createOpaqueToken()
  if (
    !EVENT_TYPE.test(input.eventType) ||
    !['info', 'warning', 'high', 'critical'].includes(severity) ||
    !CORRELATION_ID.test(correlationId) ||
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt < 0 ||
    !input.deduplicationScope ||
    input.deduplicationScope.length > 500
  ) {
    throw new TypeError('Invalid security event')
  }
  const actorAccountId = input.actor.type === 'account' ? opaqueOrNull(input.actor.accountId) : null
  const actorSessionId = input.actor.type === 'account' ? opaqueOrNull(input.actor.sessionId) : null
  const targetAccountId = opaqueOrNull(input.targetAccountId)
  const resourceType = input.resource?.type ?? null
  const resourceId = input.resource?.id ?? null
  if (
    (resourceType !== null && !RESOURCE_TYPE.test(resourceType)) ||
    (resourceType !== 'platform' && (resourceType === null) !== (resourceId === null)) ||
    (resourceId !== null && (resourceId.length < 1 || resourceId.length > 500))
  ) {
    throw new TypeError('Invalid security event resource')
  }
  const anonymous = retentionClass === 'anonymous_sampled'
  if (
    anonymous !== (input.actor.type === 'anonymous') ||
    (anonymous &&
      (!input.eventType.startsWith('anonymous.') ||
        targetAccountId !== null ||
        actorSessionId !== null ||
        !Number.isSafeInteger(input.retentionUntil) ||
        (input.retentionUntil ?? 0) < input.createdAt + 7 * 24 * 60 * 60 * 1000)) ||
    (!anonymous && input.retentionUntil !== undefined)
  ) {
    throw new TypeError('Invalid security event retention')
  }
  return database
    .prepare(
      `INSERT INTO identity_security_event
        (id, event_type, severity, actor_type, actor_account_id, target_account_id,
         actor_session_id, resource_type, resource_id, request_correlation_id,
         deduplication_key, network_context_json, details_json, retention_class,
         retention_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      createOpaqueToken(),
      input.eventType,
      severity,
      input.actor.type,
      actorAccountId,
      targetAccountId,
      actorSessionId,
      resourceType,
      resourceId,
      correlationId,
      await hashOpaqueToken(`security-event\0${input.eventType}\0${input.deduplicationScope}`),
      jsonObject(input.networkContext, 2048),
      jsonObject(input.details, 8192),
      retentionClass,
      input.retentionUntil ?? null,
      input.createdAt,
    )
}
