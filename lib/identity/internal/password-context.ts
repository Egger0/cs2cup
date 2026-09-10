function comparable(value: string) {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('en-US')
    .replaceAll(/[^\p{L}\p{N}]+/gu, '')
}

export function accountPasswordContextTerms(username: string, displayName: string) {
  return [username, displayName, 'cs2cup', '宁波理工电竞社', '宁理电竞社'] as const
}

export function containsPasswordContext(normalizedPassword: string, terms: readonly string[]) {
  const password = comparable(normalizedPassword)
  return terms.some(term => {
    const candidate = comparable(term)
    return candidate.length >= 4 && password.includes(candidate)
  })
}
