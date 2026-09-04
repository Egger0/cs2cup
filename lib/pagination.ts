const POSITIVE_DECIMAL = /^[1-9]\d*$/

export function parsePageNumber(value: string | string[] | undefined, pageSize: number) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) return 1
  const source = Array.isArray(value) ? value[0] : value
  if (!source || !POSITIVE_DECIMAL.test(source)) return 1
  const parsed = Number(source)
  if (!Number.isSafeInteger(parsed)) return 1
  return Math.min(parsed, Math.floor(Number.MAX_SAFE_INTEGER / pageSize) + 1)
}
