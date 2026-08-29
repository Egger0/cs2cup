import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import { PRIVATE_NO_STORE } from './lib/http-cache'

if (
  process.env.NEXT_PHASE === 'phase-development-server' &&
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_CS2CUP_DATABASE
) {
  void initOpenNextCloudflareForDev()
}

const PRIVATE_ROUTE_SOURCES = ['/admin/:path*', '/media/:path*', '/photos/:path*']

const config: NextConfig = {
  output: 'standalone',
  expireTime: 600,
  async headers() {
    return PRIVATE_ROUTE_SOURCES.map(source => ({
      source,
      headers: [{ key: 'Cache-Control', value: PRIVATE_NO_STORE }],
    }))
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
