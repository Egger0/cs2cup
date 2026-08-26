import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: '**.tcloudbasegateway.com' }],
    localPatterns: [{ pathname: '/media/**' }, { pathname: '/photos/**' }, { pathname: '/brand/**' }],
  },
}

export default config
