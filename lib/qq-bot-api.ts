export interface QqBotApiConfig {
  appId: string
  appSecret: string
}

interface QqAccessToken {
  value: string
  expiresAt: number
}

const TOKEN_ENDPOINT = 'https://bots.qq.com/app/getAppAccessToken'
const API_BASE = 'https://api.sgroup.qq.com/v2'
let cachedAccessToken: QqAccessToken | null = null

async function accessToken(config: QqBotApiConfig, forceRefresh = false) {
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

export async function qqBotApiRequest(
  config: QqBotApiConfig,
  path: string,
  method: 'GET' | 'POST' | 'PUT',
  body?: unknown,
  retry = true,
) {
  const token = await accessToken(config, !retry)
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      authorization: `QQBot ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (response.status === 401 && retry) return qqBotApiRequest(config, path, method, body, false)
  if (!response.ok) throw new Error(`QQ bot API request failed with ${response.status}`)
  return response
}

export function sendQqGroupMessage(
  config: QqBotApiConfig,
  groupOpenId: string,
  content: string,
  eventId?: string,
) {
  return qqBotApiRequest(config, `/groups/${encodeURIComponent(groupOpenId)}/messages`, 'POST', {
    content,
    msg_type: 0,
    ...(eventId ? { event_id: eventId } : {}),
  })
}

export function sendQqGroupMarkdown(
  config: QqBotApiConfig,
  groupOpenId: string,
  content: string,
  eventId?: string,
) {
  return qqBotApiRequest(config, `/groups/${encodeURIComponent(groupOpenId)}/messages`, 'POST', {
    msg_type: 2,
    markdown: { content },
    ...(eventId ? { event_id: eventId } : {}),
  })
}
