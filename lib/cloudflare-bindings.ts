import 'server-only'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export interface CloudflareD1Statement {
  all<T>(): Promise<{ results: T[] }>
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}
interface CloudflareD1 {
  prepare(query: string): { bind(...values: unknown[]): CloudflareD1Statement }
  batch(statements: CloudflareD1Statement[]): Promise<unknown[]>
}

interface CloudflareR2 {
  get(key: string): Promise<unknown>
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
    options?: unknown,
  ): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
}

declare global {
  interface CloudflareEnv {
    CS2CUP_DB?: CloudflareD1
    CS2CUP_MEDIA?: CloudflareR2
    QQ_BOT_APP_ID?: string
    QQ_BOT_APP_SECRET?: string
    QQ_BOT_ALLOWED_GROUP_OPEN_ID?: string
  }
}

export function cloudflareEnvironment() {
  return getCloudflareContext().env
}

export function cloudflareBindings() {
  const env = cloudflareEnvironment()
  if (!env.CS2CUP_DB || !env.CS2CUP_MEDIA) {
    throw new Error('Cloudflare D1 and R2 bindings are not configured')
  }
  return { db: env.CS2CUP_DB, media: env.CS2CUP_MEDIA }
}
