import 'server-only'
import { getCloudflareContext } from '@opennextjs/cloudflare'

type R2Binding = NonNullable<CloudflareEnv['NEXT_INC_CACHE_R2_BUCKET']>

interface HyperdriveBinding {
  connectionString: string
}

declare global {
  interface CloudflareEnv {
    CS2CUP_DATABASE?: HyperdriveBinding
    CS2CUP_MEDIA?: R2Binding
  }
}

export class MissingCloudflareBindingError extends Error {
  readonly binding: 'CS2CUP_DATABASE' | 'CS2CUP_MEDIA'

  constructor(binding: 'CS2CUP_DATABASE' | 'CS2CUP_MEDIA') {
    super(`Cloudflare binding ${binding} is not configured`)
    this.binding = binding
    this.name = 'MissingCloudflareBindingError'
  }
}

function environment() {
  const { env } = getCloudflareContext()
  return env
}

export function requireMediaBucket() {
  const bucket = environment().CS2CUP_MEDIA
  if (!bucket) throw new MissingCloudflareBindingError('CS2CUP_MEDIA')
  return bucket
}
