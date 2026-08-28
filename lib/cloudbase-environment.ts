export interface CloudBaseEnvironment {
  [name: string]: string | undefined
  CLOUDBASE_ENV_ID?: string
  CLOUDBASE_REGION?: string
  CLOUDBASE_SMOKE_EXPECT_ENV_ID?: string
}

const DNS_LABEL_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/

export function resolveCloudBaseEnvironmentId(
  environment: CloudBaseEnvironment = process.env,
) {
  const environmentId = environment.CLOUDBASE_ENV_ID?.trim()
  if (!environmentId) return null
  if (!DNS_LABEL_PATTERN.test(environmentId)) {
    throw new Error('CLOUDBASE_ENV_ID contains unsupported URL characters')
  }
  return environmentId
}

export function resolveCloudBaseRegion(
  environment: CloudBaseEnvironment = process.env,
) {
  const region = environment.CLOUDBASE_REGION?.trim()
  if (!region) return undefined
  if (!DNS_LABEL_PATTERN.test(region)) {
    throw new Error('CLOUDBASE_REGION contains unsupported URL characters')
  }
  return region
}

export function resolveCloudBaseSmokeTarget(
  environment: CloudBaseEnvironment = process.env,
) {
  const environmentId = resolveCloudBaseEnvironmentId(environment)
  if (!environmentId) throw new Error('CLOUDBASE_ENV_ID is required')

  const expectedEnvironmentId = environment.CLOUDBASE_SMOKE_EXPECT_ENV_ID?.trim()
  if (!expectedEnvironmentId) {
    throw new Error('CLOUDBASE_SMOKE_EXPECT_ENV_ID is required')
  }
  const validatedExpectedEnvironmentId = resolveCloudBaseEnvironmentId({
    CLOUDBASE_ENV_ID: expectedEnvironmentId,
  })
  if (validatedExpectedEnvironmentId !== environmentId) {
    throw new Error('CLOUDBASE_SMOKE_EXPECT_ENV_ID does not match CLOUDBASE_ENV_ID')
  }
  return environmentId
}

export function cloudBaseGatewayUrl(
  path: string,
  environment: CloudBaseEnvironment = process.env,
) {
  const environmentId = resolveCloudBaseEnvironmentId(environment)
  if (!environmentId) return null

  const origin = new URL(`https://${environmentId}.api.tcloudbasegateway.com`)
  const url = new URL(path, origin)
  if (!path.startsWith('/') || path.startsWith('//') || url.origin !== origin.origin) {
    throw new Error('CloudBase gateway path must stay on the official origin')
  }
  return url.toString()
}

export async function fetchCloudBaseGateway(
  path: string,
  init: RequestInit,
  environment: CloudBaseEnvironment = process.env,
  gatewayFetch: typeof fetch = fetch,
) {
  const url = cloudBaseGatewayUrl(path, environment)
  if (!url) return null
  return gatewayFetch(url, init)
}
