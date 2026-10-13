export const GRAPHICS_SETTINGS_LIMIT = 4000

export interface GraphicsSettingGroup {
  name: string
  items: [name: string, value: string][]
}

export type GraphicsSettingsResult =
  | { ok: true; groups: GraphicsSettingGroup[] }
  | { ok: false; line: string }

export function parseGraphicsSettings(text: string): GraphicsSettingsResult {
  const groups: GraphicsSettingGroup[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      const name = line.replace(/^#+/, '').trim()
      if (!name) return { ok: false, line }
      groups.push({ name, items: [] })
      continue
    }
    const pair = /^([^=:：]+)[=:：](.+)$/.exec(line)
    const name = pair?.[1]?.trim()
    const value = pair?.[2]?.trim()
    if (!name || !value) return { ok: false, line }
    if (!groups.length) groups.push({ name: '', items: [] })
    groups.at(-1)!.items.push([name, value])
  }
  const filled = groups.filter(group => group.items.length)
  return filled.length ? { ok: true, groups: filled } : { ok: false, line: '' }
}

export function graphicsSettingGroups(text: string) {
  const parsed = parseGraphicsSettings(text)
  return parsed.ok ? parsed.groups : []
}
