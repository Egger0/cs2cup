const CLIENT_CHUNK_PATH = /^\/_next\/static\/chunks\/.+\.js$/

export function isClientChunkUrl(input, base) {
  const url = input instanceof URL ? input : new URL(input)
  return url.origin === base && CLIENT_CHUNK_PATH.test(url.pathname)
}

export async function blockClientChunkContaining(context, base, marker) {
  if (typeof marker !== 'string' || !marker) throw new TypeError('Client chunk marker is required')
  let blocked = 0

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
    },
  )

  return {
    count: () => blocked,
    assertBlocked() {
      if (blocked === 0) throw new Error('Client degradation probe did not block its marked chunk')
    },
  }
}
