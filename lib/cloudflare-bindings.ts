import 'server-only'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export interface CloudflareD1 {
  prepare(query: string): unknown
  batch(statements: unknown[]): Promise<unknown[]>
}

export interface CloudflareR2 {
  get(key: string): Promise<unknown>
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null, options?: unknown): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
}

declare global {
  interface CloudflareEnv {
    CS2CUP_DB?: CloudflareD1
    CS2CUP_MEDIA?: CloudflareR2
  }
}

export function cloudflareBindings() {
  const { env } = getCloudflareContext()
  if (!env.CS2CUP_DB || !env.CS2CUP_MEDIA) {
    throw new Error('Cloudflare D1 and R2 bindings are not configured')
  }
  return { db: env.CS2CUP_DB, media: env.CS2CUP_MEDIA }
}
