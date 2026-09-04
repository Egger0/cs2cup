export async function blockClientChunkContaining(context, base, marker) {
  if (typeof marker !== 'string' || !marker) throw new TypeError('Client chunk marker is required')
  let blocked = 0

  await context.route('**/_next/static/chunks/*.js', async route => {
    const request = route.request()
    if (request.resourceType() !== 'script' || new URL(request.url()).origin !== base) {
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
  })

  return { count: () => blocked }
}
