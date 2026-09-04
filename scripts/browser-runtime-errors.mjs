function matches(rules, message) {
  return rules.some(rule => {
    if (typeof rule === 'string') return message.includes(rule)
    rule.lastIndex = 0
    return rule.test(message)
  })
}

export function captureBrowserRuntimeErrors(
  page,
  { allowedConsoleErrors = [], allowedPageErrors = [] } = {},
) {
  const failures = []
  page.on('pageerror', error => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    if (!matches(allowedPageErrors, message)) failures.push(`pageerror: ${message}`)
  })
  page.on('console', message => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (!matches(allowedConsoleErrors, text)) failures.push(`console.error: ${text}`)
  })
  return {
    assertClean(label) {
      if (failures.length) throw new Error(`${label} runtime errors:\n${failures.join('\n')}`)
    },
  }
}
