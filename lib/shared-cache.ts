import 'server-only'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export async function sharedCache<T>(key: string, seconds: number, load: () => Promise<T>) {
  const store = (globalThis as { caches?: { default?: Cache } }).caches?.default
  if (!store) return load()
  const request = new Request(`https://shared-cache.invalid/${encodeURIComponent(key)}`)
  const hit = await store.match(request)
  if (hit) return (await hit.json()) as T
  const value = await load()
  getCloudflareContext().ctx.waitUntil(
    store.put(
      request,
      new Response(JSON.stringify(value), {
        headers: { 'Cache-Control': `public, max-age=${seconds}` },
      }),
    ),
  )
  return value
}
