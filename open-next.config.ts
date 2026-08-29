import { defineCloudflareConfig } from '@opennextjs/cloudflare'

export default defineCloudflareConfig({
  // Dynamic content must stay correct before dedicated cache resources exist.
  // The static-assets cache is read-only and cannot honor runtime revalidation.
  incrementalCache: 'dummy',
  tagCache: 'dummy',
  queue: 'dummy',
})
