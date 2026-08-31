import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import { PRIVATE_NO_STORE } from './lib/http-cache'

const PRIVATE_ROUTE_SOURCES = ['/admin/:path*', '/media/:path*', '/photos/:path*']
const REGISTRATION_MANAGEMENT_SOURCE = '/tournaments/:slug/registration/:token'

if (process.env.NODE_ENV === 'development') {
  void initOpenNextCloudflareForDev({
    configPath: './wrangler.local.jsonc',
    envFiles: ['wrangler.local.env'],
    persist: { path: './.local/cloudflare/v3' },
    remoteBindings: false,
  })
}

const config: NextConfig = {
  agentRules: false,
  expireTime: 600,
  async headers() {
    return [
      ...PRIVATE_ROUTE_SOURCES.map(source => ({
        source,
        headers: [{ key: 'Cache-Control', value: PRIVATE_NO_STORE }],
      })),
      {
        source: REGISTRATION_MANAGEMENT_SOURCE,
        headers: [
          { key: 'Cache-Control', value: PRIVATE_NO_STORE },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ]
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '12mb',
    },
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    // `/media/**` is authorization-sensitive and must never enter the shared
    // image optimizer cache. Media components opt out of optimization and read
    // the guarded route directly.
    localPatterns: [{ pathname: '/brand/**' }],
  },
}

export default config
