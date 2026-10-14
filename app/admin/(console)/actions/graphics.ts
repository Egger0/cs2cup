'use server'

import { requirePlatformConsole } from '@/lib/auth'
import {
  deleteGraphicsPreset,
  insertGraphicsPreset,
  updateGraphicsPreset,
} from '@/lib/graphics-presets'
import { GRAPHICS_SETTINGS_LIMIT, parseGraphicsSettings } from '@/lib/graphics-settings'

const validId = (id: number) => Number.isSafeInteger(id) && id > 0

export async function saveGraphicsPreset(id: number | null, form: FormData) {
  await requirePlatformConsole()

  const text = (name: string) => String(form.get(name) ?? '').trim()
  const preset = {
    gameId: Number(form.get('gameId')),
    title: text('title'),
    hardware: text('hardware'),
    target: text('target'),
    author: text('author'),
    note: text('note'),
    settings: text('settings').replaceAll('\r\n', '\n'),
  }

  if (id !== null && !validId(id)) return { ok: false as const, error: '方案编号无效' }
  if (!validId(preset.gameId)) return { ok: false as const, error: '请选择项目' }
  if (!preset.title || preset.title.length > 60) {
    return { ok: false as const, error: '方案名需要 1 到 60 个字' }
  }
  if (!preset.hardware || preset.hardware.length > 80) {
    return { ok: false as const, error: '适用配置需要 1 到 80 个字' }
  }
  if (preset.target.length > 40 || preset.author.length > 30 || preset.note.length > 300) {
    return { ok: false as const, error: '目标帧数、署名或说明超出了长度上限' }
  }
  if (preset.settings.length > GRAPHICS_SETTINGS_LIMIT) {
    return { ok: false as const, error: `设置清单不能超过 ${GRAPHICS_SETTINGS_LIMIT} 个字符` }
  }
  const parsed = parseGraphicsSettings(preset.settings)
  if (!parsed.ok) {
    return {
      ok: false as const,
      error: parsed.line
        ? `这一行看不懂：「${parsed.line}」。每行写成「设置项 = 取值」。`
        : '至少写一行「设置项 = 取值」',
    }
  }

  try {
    await (id === null ? insertGraphicsPreset(preset) : updateGraphicsPreset(id, preset))
  } catch (error) {
    console.error('graphics preset save failed', error)
    return { ok: false as const, error: '方案保存失败，请确认项目仍然存在' }
  }
  return { ok: true as const }
}

export async function removeGraphicsPreset(id: number) {
  await requirePlatformConsole()
  if (!validId(id)) return { ok: false as const, error: '方案编号无效' }
  await deleteGraphicsPreset(id)
  return { ok: true as const }
}
