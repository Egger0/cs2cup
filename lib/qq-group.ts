export type QqGroupContact =
  | { readonly kind: 'invite'; readonly href: string; readonly number: string | null }
  | { readonly kind: 'number'; readonly number: string }
  | null

const GROUP_NUMBER = /^\d{5,20}$/
const INVITE_HOSTS = new Set(['qm.qq.com', 'jq.qq.com', 'qun.qq.com'])

export function qqGroupContact(value: string | null | undefined): QqGroupContact {
  const raw = value?.trim()
  if (!raw) return null
  const compact = raw.replace(/\s+/gu, '')
  if (GROUP_NUMBER.test(compact)) return { kind: 'number', number: compact }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !INVITE_HOSTS.has(url.hostname)) return null
  const embedded = url.searchParams.get('group_code') ?? url.searchParams.get('groupCode')
  return {
    kind: 'invite',
    href: url.toString(),
    number: embedded && GROUP_NUMBER.test(embedded) ? embedded : null,
  }
}
