const DEFAULT_SITE_ORIGIN = 'http://localhost:3000'

export function resolveSiteOrigin(configured = process.env.NEXT_PUBLIC_SITE_URL): string {
  const value = configured?.trim() || DEFAULT_SITE_ORIGIN

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('NEXT_PUBLIC_SITE_URL must be an absolute HTTP(S) origin')
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('NEXT_PUBLIC_SITE_URL must be an absolute HTTP(S) origin')
  }

  return url.origin
}
