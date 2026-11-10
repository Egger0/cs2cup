const CACHEABLE_PATH =
  /^\/(?:|news(?:\/[^/]+)?|tournaments(?:\/[^/]+(?:\/(?:bracket|results|rules|teams|schedule)|\/teams\/[^/]+|\/matches\/\d+)?)?|archive(?:\/merit)?|games(?:\/[^/]+)?|about|leaderboard|handbook|players\/[^/]+)$/
const ACTION_HEADERS = ['next-action']
const SESSION_COOKIE = /cs2cup|session/i

export const EDGE_FRESH_SECONDS = 30
export const EDGE_STALE_SECONDS = 600

interface CacheStore {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

function isFlight(request: Request) {
  return request.headers.has('rsc')
}

export function isEdgeCacheable(request: Request) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  if (!CACHEABLE_PATH.test(url.pathname) || url.search.length > 100) return false
  if (ACTION_HEADERS.some(name => request.headers.has(name))) return false
  if (SESSION_COOKIE.test(request.headers.get('cookie') ?? '')) return false
  if (isFlight(request)) return url.searchParams.has('_rsc')
  return (
    !url.searchParams.has('_rsc') && (request.headers.get('accept') ?? '').includes('text/html')
  )
}

function storable(response: Response) {
  return (
    response.status === 200 &&
    !response.headers.has('set-cookie') &&
    /^text\/(?:html|x-component)/.test(response.headers.get('content-type') ?? '')
  )
}

function keyOf(request: Request, version: string) {
  const url = new URL(request.url)
  url.searchParams.set('__v', version)
  if (isFlight(request)) url.searchParams.set('__k', 'flight')
  return new Request(url, { method: 'GET' })
}

function store(
  request: Request,
  response: Response,
  cache: CacheStore,
  version: string,
  now: () => number,
) {
  const stored = new Response(response.clone().body, response)
  stored.headers.set('cache-control', `public, s-maxage=${EDGE_STALE_SECONDS + EDGE_FRESH_SECONDS}`)
  stored.headers.set('x-edge-stored-at', String(now()))
  stored.headers.delete('vary')
  return cache.put(keyOf(request, version), stored)
}

function served(response: Response, state: 'hit' | 'stale' | 'miss') {
  const copy = new Response(response.body, response)
  copy.headers.set('cache-control', 'public, max-age=0, must-revalidate')
  copy.headers.set('x-edge-cache', state)
  return copy
}

export async function edgeCached(
  request: Request,
  context: { waitUntil(promise: Promise<unknown>): void },
  render: (request: Request) => Promise<Response>,
  cache: CacheStore,
  version: string,
  now: () => number = Date.now,
) {
  if (!isEdgeCacheable(request)) return render(request)
  const hit = await cache.match(keyOf(request, version))
  if (hit) {
    const stale =
      (now() - Number(hit.headers.get('x-edge-stored-at') ?? 0)) / 1000 > EDGE_FRESH_SECONDS
    if (stale) {
      context.waitUntil(
        render(request).then(fresh =>
          storable(fresh) ? store(request, fresh, cache, version, now) : undefined,
        ),
      )
    }
    return served(hit, stale ? 'stale' : 'hit')
  }
  const response = await render(request)
  if (!storable(response)) return response
  context.waitUntil(store(request, response, cache, version, now))
  return served(response, 'miss')
}
