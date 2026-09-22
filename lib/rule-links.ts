const WEB_URL = /https?:\/\/[^\s<>"']+/g

export type RuleBodySegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'link'; readonly value: string; readonly href: string }

function externalUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function ruleBodySegments(body: string): RuleBodySegment[] {
  const segments: RuleBodySegment[] = []
  let cursor = 0
  for (const match of body.matchAll(WEB_URL)) {
    const value = match[0]
    const index = match.index ?? cursor
    const href = externalUrl(value)
    if (!href) continue
    if (index > cursor) segments.push({ kind: 'text', value: body.slice(cursor, index) })
    segments.push({ kind: 'link', value, href })
    cursor = index + value.length
  }
  if (cursor < body.length || !segments.length)
    segments.push({ kind: 'text', value: body.slice(cursor) })
  return segments
}
