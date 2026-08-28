import { resolveCloudBaseEnvironmentId } from './cloudbase-environment.ts'

export type RdbCredential = 'anon' | 'admin'

export interface ResolvedRdbEndpoint {
  baseUrl: string
  cloudbaseGateway: boolean
}

function validatedOverride(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('RDB endpoint override must be an absolute URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('RDB endpoint override must use HTTP or HTTPS')
  }
  if (url.username || url.password) {
    throw new Error('RDB endpoint override must not contain user information')
  }
  if (url.search || url.hash) {
    throw new Error('RDB endpoint override must not contain a query or fragment')
  }
  return url.toString().replace(/\/$/, '')
}

export function resolveRdbEndpoint(
  credential: RdbCredential,
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedRdbEndpoint {
  const override = credential === 'admin'
    ? (environment.RDB_ADMIN_BASE_URL ?? environment.RDB_BASE_URL)
    : environment.RDB_BASE_URL
  if (override?.trim()) {
    return { baseUrl: validatedOverride(override.trim()), cloudbaseGateway: false }
  }

  const environmentId = resolveCloudBaseEnvironmentId(environment)
  if (!environmentId) throw new Error('CLOUDBASE_ENV_ID or RDB_BASE_URL must be set')
  return {
    baseUrl: `https://${environmentId}.api.tcloudbasegateway.com/v1/rdb/rest`,
    cloudbaseGateway: true,
  }
}

export function rdbAuthorizationHeader(
  endpoint: ResolvedRdbEndpoint,
  credential: RdbCredential,
  environment: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (!endpoint.cloudbaseGateway) return {}
  const key = credential === 'admin'
    ? environment.CLOUDBASE_ADMIN_KEY
    : environment.CLOUDBASE_ANON_KEY
  return key ? { Authorization: `Bearer ${key}` } : {}
}
