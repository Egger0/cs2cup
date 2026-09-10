export type QqGroupContact =
  | { readonly kind: 'invite'; readonly href: string; readonly number: string | null }
  | { readonly kind: 'number'; readonly number: string }
  | null

const GROUP_NUMBER = /^\d{5,20}$/
const INVITE_HOSTS = new Set(['qm.qq.com', 'jq.qq.com', 'qun.qq.com'])

function inviteUrl(token: string) {
  let url: URL
  try {
    url = new URL(token)
  } catch {
    return null
  }
  return url.protocol === 'https:' && INVITE_HOSTS.has(url.hostname) ? url : null
}

export function qqGroupContact(value: string | null | undefined): QqGroupContact {
  const raw = value?.trim() ?? ''
  if (!raw) return null
  const compact = raw.replace(/\s+/gu, '')
  if (GROUP_NUMBER.test(compact)) return { kind: 'number', number: compact }
  const tokens = raw.split(/\s+/u).filter(Boolean)

  let href: URL | null = null
  let number: string | null = null
  for (const token of tokens) {
    if (!href) href = inviteUrl(token)
    if (!number && GROUP_NUMBER.test(token)) number = token
  }
  if (href) {
    const embedded = href.searchParams.get('group_code') ?? href.searchParams.get('groupCode')
    return {
      kind: 'invite',
      href: href.toString(),
      number: number ?? (embedded && GROUP_NUMBER.test(embedded) ? embedded : null),
    }
  }
  return number ? { kind: 'number', number } : null
}
