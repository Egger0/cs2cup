import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: {
      bodySizeLimit: '12mb',
    },
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: '**.tcloudbasegateway.com' }],
    // `/media/**` is authorization-sensitive and must never enter the shared
    // image optimizer cache. Media components opt out of optimization and read
    // the guarded route directly.
    localPatterns: [{ pathname: '/brand/**' }],
  },
}

export default config
