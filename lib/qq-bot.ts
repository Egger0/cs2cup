import 'server-only'

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

export interface QqBotConfig {
  appId: string
  appSecret: string
  allowedGroupOpenId: string | null
}

export interface QqGroupMessage {
  eventId: string
  messageId: string
  groupOpenId: string
  memberOpenId: string
  content: string
}

export type QqCommand =
  | { kind: 'check_in' }
  | { kind: 'leaderboard' }
  | { kind: 'current_tournament' }
  | { kind: 'bind'; code: string }

interface QqAccessToken {
  value: string
  expiresAt: number
}

interface UnknownRecord {
  [key: string]: unknown
}

interface QqBotEnvironment {
  QQ_BOT_APP_ID?: string
  QQ_BOT_APP_SECRET?: string
  QQ_BOT_ALLOWED_GROUP_OPEN_ID?: string
}

const TOKEN_ENDPOINT = 'https://bots.qq.com/app/getAppAccessToken'
const API_BASE = 'https://api.sgroup.qq.com/v2'
const FIVE_MINUTES_MS = 5 * 60 * 1000
const COMMAND_PANEL_REMARK = 'nbt-qq-group-commands'
const COMMAND_PANEL = {
  items: [
    { type: 'command', name: '签到', desc: '完成今天的社团打卡' },
    { type: 'command', name: '签到排行', desc: '查看连续签到排名' },
    { type: 'command', name: '最近赛事', desc: '查看当前赛事安排' },
  ],
  remark: COMMAND_PANEL_REMARK,
}
let cachedAccessToken: QqAccessToken | null = null

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

export function qqCommand(content: string): QqCommand | null {
  const normalized = content
    .replace(/<@!?[^>]+>/g, '')
    .trim()
    .replace(/\s+/g, ' ')
  if (normalized === '签到') return { kind: 'check_in' }
  if (normalized === '签到排行') return { kind: 'leaderboard' }
  if (normalized === '最近赛事') return { kind: 'current_tournament' }
  const binding = /^\/绑定\s+([A-HJ-NP-Z2-9]{8})$/i.exec(normalized)
  return binding?.[1] ? { kind: 'bind', code: binding[1].toUpperCase() } : null
}

async function accessToken(config: QqBotConfig, forceRefresh = false) {
  const now = Date.now()
  if (!forceRefresh && cachedAccessToken && cachedAccessToken.expiresAt > now + 60_000) {
    return cachedAccessToken.value
  }
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId: config.appId, clientSecret: config.appSecret }),
  })
  const payload = (await response.json().catch(() => null)) as {
    access_token?: unknown
    expires_in?: unknown
  } | null
  if (!response.ok || !payload || typeof payload.access_token !== 'string') {
    throw new Error('QQ bot access token request failed')
  }
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 300
  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: now + Math.max(60, expiresIn) * 1000,
  }
  return cachedAccessToken.value
}

async function postGroupReply(
  config: QqBotConfig,
  message: QqGroupMessage,
  content: string,
  retry = true,
) {
  const token = await accessToken(config, !retry)
  const response = await fetch(
    `${API_BASE}/groups/${encodeURIComponent(message.groupOpenId)}/messages`,
    {
      method: 'POST',
      headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content, msg_type: 0, msg_id: message.messageId, msg_seq: 1 }),
    },
  )
  if (response.status === 401 && retry) return postGroupReply(config, message, content, false)
  if (!response.ok) throw new Error(`QQ group reply failed with ${response.status}`)
}

export function replyToQqGroup(config: QqBotConfig, message: QqGroupMessage, content: string) {
  return postGroupReply(config, message, content)
}

interface QqCommandPanelRecord {
  panel_id?: unknown
  panel?: { remark?: unknown }
}

async function panelRequest(
  config: QqBotConfig,
  path: string,
  method: 'GET' | 'POST' | 'PUT',
  body?: unknown,
  retry = true,
) {
  const token = await accessToken(config, !retry)
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { authorization: `QQBot ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (response.status === 401 && retry) return panelRequest(config, path, method, body, false)
  if (!response.ok) throw new Error(`QQ command panel request failed with ${response.status}`)
  return response
}

export async function syncQqGroupCommandPanel(config: QqBotConfig) {
  if (!config.allowedGroupOpenId) throw new Error('QQ allowed group is not configured')
  const response = await panelRequest(config, '/panels?scope=group&limit=20', 'GET')
  const payload = (await response.json().catch(() => null)) as { records?: unknown } | null
  const records = Array.isArray(payload?.records) ? (payload.records as QqCommandPanelRecord[]) : []
  const existing = records.find(
    record =>
      typeof record.panel_id === 'string' && record.panel?.remark === COMMAND_PANEL_REMARK,
  )
  if (existing && typeof existing.panel_id === 'string') {
    await panelRequest(config, `/panels/${encodeURIComponent(existing.panel_id)}`, 'PUT', {
      panel: COMMAND_PANEL,
    })
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
