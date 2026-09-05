const DEFAULT_E2E_BASE_URL = 'http://127.0.0.1:3000'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost'])

function parseNetworkUrl(value, protocols) {
  if (typeof value !== 'string' || !value || value !== value.trim()) return null

  try {
    const url = new URL(value)
    if (!protocols.has(url.protocol)) return null
    if (url.username || url.password || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return null
    return url
  } catch {
    return null
  }
}

export function resolveE2EBaseUrl(value = process.env.E2E_BASE_URL) {
  const candidate = value === undefined ? DEFAULT_E2E_BASE_URL : value
  const url = parseNetworkUrl(candidate, new Set(['http:', 'https:']))

  if (!url || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('E2E_BASE_URL must be a loopback HTTP(S) origin')
  }

  return url.origin
}

function isLoopbackRequest(value, protocols) {
  return parseNetworkUrl(value, protocols) !== null
}

export async function installLoopbackRequestGuard(context) {
  const blocked = new Set()

  await context.route('**/*', async route => {
    const url = route.request().url()
    // WebKit routes local object URLs through the request guard as well.
    const source = url.startsWith('blob:') ? url.slice(5) : url
    if (isLoopbackRequest(source, new Set(['http:', 'https:']))) {
      await route.continue()
      return
    }

    blocked.add(url)
    await route.abort('blockedbyclient')
  })

  if (typeof context.routeWebSocket === 'function') {
    await context.routeWebSocket('**/*', async socket => {
      const url = socket.url()
      if (isLoopbackRequest(url, new Set(['ws:', 'wss:']))) {
        socket.connectToServer()
        return
      }

      blocked.add(url)
      await socket.close({ code: 1008, reason: 'Non-loopback request blocked' })
    })
  }

  return {
    assertSafe() {
      if (!blocked.size) return
      throw new Error(`Blocked non-loopback E2E requests: ${[...blocked].sort().join(', ')}`)
    },
  }
}
