const CLIENT_CHUNK_PATH = /^\/_next\/static\/chunks\/.+\.js$/

export function isClientChunkUrl(input, base) {
  const url = input instanceof URL ? input : new URL(input)
  return url.origin === base && CLIENT_CHUNK_PATH.test(url.pathname)
}

export async function blockClientChunkContaining(context, base, marker) {
  if (typeof marker !== 'string' || !marker) throw new TypeError('Client chunk marker is required')
  let blocked = 0
  const listeners = new Set()

  await context.route(
    url => isClientChunkUrl(url, base),
    async route => {
      const request = route.request()
      if (request.resourceType() !== 'script') {
        await route.fallback()
        return
      }
      const response = await route.fetch()
      const source = await response.text()
      if (!source.includes(marker)) {
        await route.fulfill({ response, body: source })
        return
      }
      blocked += 1
      await route.abort('failed')
      listeners.forEach(listener => listener())
    },
  )

  return {
    count: () => blocked,
    async waitForBlocked(since = 0) {
      if (blocked > since) return
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check)
          reject(new Error('The marked client chunk was not requested within 15 seconds'))
        }, 15000)
        const check = () => {
          if (blocked <= since) return
          clearTimeout(timer)
          listeners.delete(check)
          resolve()
        }
        listeners.add(check)
        check()
      })
    },
    assertBlocked() {
      if (blocked === 0) throw new Error('Client degradation probe did not block its marked chunk')
    },
  }
}
