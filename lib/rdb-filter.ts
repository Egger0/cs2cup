export function splitFilter(value: string) {
  const separator = value.indexOf('.')
  if (separator === -1) return [value, ''] as const
  return [value.slice(0, separator), value.slice(separator + 1)] as const
}
