import { sendQqGroupMessage, type QqBotApiConfig } from './qq-bot-api.ts'

export interface QqAutomationStatement {
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

export interface QqAutomationDatabase {
  prepare(query: string): { bind(...values: unknown[]): QqAutomationStatement }
}

export const QQ_WELCOME_MESSAGE = '欢迎加入宁理电竞社！请前往群公告或机器人菜单打开官网注册成员。'
export const QQ_MORNING_MESSAGE = '早安，宁理电竞社！今天记得签到哦'

function deliveryKey(kind: 'welcome' | 'morning', groupOpenId: string, value: string) {
  return `${kind}:${groupOpenId}:${value}`
}

export function shanghaiDate(value: number | Date = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value instanceof Date ? value : new Date(value))
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

async function claimDelivery(
  database: QqAutomationDatabase,
  key: string,
  kind: 'welcome' | 'morning',
  groupOpenId: string,
) {
  const row = await database
    .prepare(
      `INSERT OR IGNORE INTO qq_bot_delivery_log (delivery_key, kind, group_openid)
       VALUES (?, ?, ?)
       RETURNING delivery_key`,
    )
    .bind(key, kind, groupOpenId)
    .first<{ delivery_key: string }>()
  return Boolean(row?.delivery_key)
}

async function releaseDelivery(database: QqAutomationDatabase, key: string) {
  await database.prepare('DELETE FROM qq_bot_delivery_log WHERE delivery_key = ?').bind(key).run()
}

export async function sendQqWelcome(
  config: QqBotApiConfig,
  database: QqAutomationDatabase,
  groupOpenId: string,
  eventId: string,
) {
  const key = deliveryKey('welcome', groupOpenId, eventId)
  if (!(await claimDelivery(database, key, 'welcome', groupOpenId))) return false
  try {
    await sendQqGroupMessage(config, groupOpenId, QQ_WELCOME_MESSAGE, eventId)
    return true
  } catch (error) {
    await releaseDelivery(database, key)
    throw error
  }
}

export async function sendQqMorning(
  config: QqBotApiConfig,
  database: QqAutomationDatabase,
  groupOpenId: string,
  now = Date.now(),
) {
  const date = shanghaiDate(now)
  const key = deliveryKey('morning', groupOpenId, date)
  if (!(await claimDelivery(database, key, 'morning', groupOpenId))) return false
  try {
    await sendQqGroupMessage(config, groupOpenId, QQ_MORNING_MESSAGE)
    return true
  } catch (error) {
    await releaseDelivery(database, key)
    throw error
  }
}
