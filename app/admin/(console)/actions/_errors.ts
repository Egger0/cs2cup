import { RdbError } from '@/lib/rdb'

function readRdbPayload(error: RdbError) {
  const raw = error.message.slice(error.message.indexOf(':') + 1).trim()
  try {
    return JSON.parse(raw) as { code?: unknown; message?: unknown }
  } catch {
    return null
  }
}

export function writeError(error: unknown, fallback: string) {
  if (!(error instanceof RdbError)) {
    console.error(fallback, error)
    return fallback
  }
  if (error.status >= 500) console.error(fallback, error)

  const payload = readRdbPayload(error)
  return typeof payload?.message === 'string' ? payload.message : fallback
}

export function scheduleError(error: unknown) {
  if (!(error instanceof RdbError)) return writeError(error, '发布赛程失败')
  const payload = readRdbPayload(error)
  if (payload?.code === '40001') return '赛程已被其他管理员或新签表更新，请刷新后重试'
  if (payload?.code === '22023') return '赛程时间顺序或场次范围无效，请检查后重试'
  return writeError(error, '发布赛程失败')
}
