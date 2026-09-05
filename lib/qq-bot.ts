import 'server-only'

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { qqBotApiRequest, type QqBotApiConfig } from './qq-bot-api.ts'

export interface QqBotConfig extends QqBotApiConfig {
  allowedGroupOpenId: string | null
}

export interface QqGroupMessage {
  eventId: string
  messageId: string
  groupOpenId: string
  memberOpenId: string
  content: string
}

export interface QqGroupMemberAdd {
  eventId: string
  groupOpenId: string
  memberOpenId: string
}

export type QqCommand =
  | { kind: 'check_in' }
  | { kind: 'leaderboard' }
  | { kind: 'current_tournament' }
  | { kind: 'bind'; username: string }
  | { kind: 'unbind' }

interface UnknownRecord {
  [key: string]: unknown
}

interface QqBotEnvironment {
  QQ_BOT_APP_ID?: string
  QQ_BOT_APP_SECRET?: string
  QQ_BOT_ALLOWED_GROUP_OPEN_ID?: string
}

const FIVE_MINUTES_MS = 5 * 60 * 1000
const COMMAND_PANEL_REMARK = 'nbt-qq-group-commands'
const COMMAND_PANEL = {
  items: [
    { type: 'command', name: '/签到', desc: '完成今天的社团打卡' },
    { type: 'command', name: '/签到排行', desc: '查看连续签到排名' },
    { type: 'command', name: '/最近赛事', desc: '查看当前赛事安排' },
    { type: 'command', name: '/绑定 用户名', desc: '绑定网站用户名' },
    { type: 'command', name: '/解绑', desc: '解除当前 QQ 绑定' },
  ],
  remark: COMMAND_PANEL_REMARK,
}
function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null
}

function timestampValue(value: unknown) {
  if (typeof value === 'string') return value
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null
}

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function eventData(payload: UnknownRecord) {
  return recordValue(payload.d) ?? recordValue(payload.data) ?? recordValue(payload.msg)
}

function privateKey(secret: string) {
  const source = Buffer.from(secret, 'utf8')
  if (!source.length) throw new Error('QQ bot secret is empty')
  const seed = Buffer.alloc(32)
  for (let index = 0; index < seed.length; index += 1) {
    seed[index] = source[index % source.length] ?? 0
  }
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
  return createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
}

function parsedTimestamp(value: string | null, now: number) {
  if (!value || !/^\d{10,13}$/.test(value)) return false
  const source = Number(value)
  const milliseconds = value.length === 10 ? source * 1000 : source
  return Number.isSafeInteger(milliseconds) && Math.abs(now - milliseconds) <= FIVE_MINUTES_MS
}

export function qqBotConfig(
  environment: QqBotEnvironment = process.env as QqBotEnvironment,
): QqBotConfig | null {
  const appId = environment.QQ_BOT_APP_ID?.trim()
  const appSecret = environment.QQ_BOT_APP_SECRET?.trim()
  const allowedGroupOpenId = environment.QQ_BOT_ALLOWED_GROUP_OPEN_ID?.trim() || null
  return appId && appSecret ? { appId, appSecret, allowedGroupOpenId } : null
}

export function verifyQqWebhookSignature(
  headers: Headers,
  body: string,
  secret: string,
  now = Date.now(),
) {
  const timestamp = headers.get('x-signature-timestamp')
  const signature = headers.get('x-signature-ed25519')
  if (!parsedTimestamp(timestamp, now) || !signature || !/^[a-f0-9]{128}$/i.test(signature)) {
    return false
  }
  try {
    return verify(
      null,
      Buffer.from(`${timestamp}${body}`, 'utf8'),
      createPublicKey(privateKey(secret)),
      Buffer.from(signature, 'hex'),
    )
  } catch {
    return false
  }
}

export function qqWebhookVerification(payload: unknown, secret: string) {
  const source = recordValue(payload)
  const data = source ? eventData(source) : null
  const plainToken = data ? stringValue(data.plain_token) : null
  const eventTimestamp = data ? timestampValue(data.event_ts) : null
  if (!plainToken || !eventTimestamp) return null
  try {
    return {
      plain_token: plainToken,
      signature: sign(
        null,
        Buffer.from(`${eventTimestamp}${plainToken}`, 'utf8'),
        privateKey(secret),
      ).toString('hex'),
    }
  } catch {
    return null
  }
}

export function qqGroupMessage(payload: unknown): QqGroupMessage | null {
  const source = recordValue(payload)
  if (!source) return null
  const type = stringValue(source.t) ?? stringValue(source.type) ?? stringValue(source.eventType)
  if (type !== 'GROUP_AT_MESSAGE_CREATE') return null
  const data = eventData(source)
  const author = data ? recordValue(data.author) : null
  const eventId =
    stringValue(source.id) ?? stringValue(source.event_id) ?? stringValue(source.eventId)
  const messageId = data ? stringValue(data.id) : null
  const groupOpenId = data ? stringValue(data.group_openid) : null
  const memberOpenId = author ? stringValue(author.member_openid) : null
  const content = data ? stringValue(data.content) : null
  if (!eventId || !messageId || !groupOpenId || !memberOpenId || content === null) return null
  return { eventId, messageId, groupOpenId, memberOpenId, content }
}

export function qqGroupMemberAdd(payload: unknown): QqGroupMemberAdd | null {
  const source = recordValue(payload)
  if (!source) return null
  const type = stringValue(source.t) ?? stringValue(source.type) ?? stringValue(source.eventType)
  if (type !== 'GROUP_MEMBER_ADD') return null
  const data = eventData(source)
  const groupOpenId = data ? stringValue(data.group_openid) : null
  const memberOpenId = data ? stringValue(data.member_openid) : null
  const timestamp = data ? timestampValue(data.timestamp) : null
  const eventId =
    stringValue(source.id) ??
    stringValue(source.event_id) ??
    stringValue(source.eventId) ??
    (groupOpenId && memberOpenId && timestamp
      ? `GROUP_MEMBER_ADD:${groupOpenId}:${memberOpenId}:${timestamp}`
      : null)
  if (!eventId || !groupOpenId || !memberOpenId) return null
  return { eventId, groupOpenId, memberOpenId }
}

export function qqCommand(content: string): QqCommand | null {
  const normalized = content
    .replace(/<@!?[^>]+>/g, '')
    .trim()
    .replace(/\s+/g, ' ')
  const command = normalized.startsWith('/') ? normalized.slice(1) : normalized
  if (command === '签到') return { kind: 'check_in' }
  if (command === '签到排行') return { kind: 'leaderboard' }
  if (command === '最近赛事') return { kind: 'current_tournament' }
  const binding = /^\/绑定\s+(\S+)$/.exec(normalized)
  if (binding?.[1]) return { kind: 'bind', username: binding[1] }
  return normalized === '/解绑' ? { kind: 'unbind' } : null
}

async function postGroupReply(config: QqBotConfig, message: QqGroupMessage, content: string) {
  await qqBotApiRequest(
    config,
    `/groups/${encodeURIComponent(message.groupOpenId)}/messages`,
    'POST',
    { content, msg_type: 0, msg_id: message.messageId, msg_seq: 1 },
  )
}

export function replyToQqGroup(config: QqBotConfig, message: QqGroupMessage, content: string) {
  return postGroupReply(config, message, content)
}

interface QqCommandPanelRecord {
  panel_id?: unknown
  panel?: { remark?: unknown }
}

interface QqCommandPanelDetail {
  group_openids?: unknown
}

async function panelRequest(
  config: QqBotConfig,
  path: string,
  method: 'GET' | 'POST' | 'PUT',
  body?: unknown,
  retry = true,
) {
  return qqBotApiRequest(config, path, method, body, retry)
}

export { sendQqGroupMessage } from './qq-bot-api.ts'

export async function syncQqGroupCommandPanel(config: QqBotConfig) {
  if (!config.allowedGroupOpenId) throw new Error('QQ allowed group is not configured')
  const response = await panelRequest(config, '/panels?scope=group&limit=20', 'GET')
  const payload = (await response.json().catch(() => null)) as { records?: unknown } | null
  const records = Array.isArray(payload?.records) ? (payload.records as QqCommandPanelRecord[]) : []
  const existing = records.find(
    record => typeof record.panel_id === 'string' && record.panel?.remark === COMMAND_PANEL_REMARK,
  )
  if (existing && typeof existing.panel_id === 'string') {
    const panelId = encodeURIComponent(existing.panel_id)
    const detailResponse = await panelRequest(config, `/panels/${panelId}`, 'GET')
    const detail = (await detailResponse.json().catch(() => null)) as QqCommandPanelDetail | null
    const groups = Array.isArray(detail?.group_openids)
      ? detail.group_openids.filter((group): group is string => typeof group === 'string')
      : []
    await panelRequest(config, `/panels/${panelId}`, 'PUT', {
      panel: COMMAND_PANEL,
    })
    if (!groups.includes(config.allowedGroupOpenId)) {
      await panelRequest(config, `/panels/${panelId}/target`, 'PUT', {
        op: 'add',
        group_openids: [config.allowedGroupOpenId],
      })
    }
    const previousGroups = groups.filter(group => group !== config.allowedGroupOpenId)
    if (previousGroups.length) {
      await panelRequest(config, `/panels/${panelId}/target`, 'PUT', {
        op: 'del',
        group_openids: previousGroups,
      })
    }
    return 'updated'
  }
  await panelRequest(config, '/panels', 'POST', {
    scope: 'group',
    target_type: 'specific',
    group_openids: [config.allowedGroupOpenId],
    panel: COMMAND_PANEL,
  })
  return 'created'
}
