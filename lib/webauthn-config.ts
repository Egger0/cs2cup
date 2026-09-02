export const WEBAUTHN_RP_NAME = '宁波理工电竞社'

export interface WebAuthnConfig {
  rpName: typeof WEBAUTHN_RP_NAME
  origin: string
  rpID: string
}

const PREVIEW_HOST_SUFFIXES = ['workers.dev', 'pages.dev'] as const
const CONFIGURATION_ERROR =
  'NEXT_PUBLIC_SITE_URL must be an exact HTTPS production origin or http://localhost[:port]'

function invalidConfiguration(): never {
  throw new Error(CONFIGURATION_ERROR)
}

function isIpAddress(hostname: string) {
  if (hostname.startsWith('[') || hostname.includes(':')) return true

  const parts = hostname.split('.')
  return (
    parts.length === 4 &&
    parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  )
}

function isPreviewHost(hostname: string) {
  return PREVIEW_HOST_SUFFIXES.some(
    suffix => hostname === suffix || hostname.endsWith(`.${suffix}`),
  )
}

function isDnsHostname(hostname: string) {
  if (hostname.length > 253) return false
  const labels = hostname.split('.')
  return (
    labels.length > 1 &&
    labels.every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  )
}

/** Resolve only deployment-owned configuration, never request Host headers. */
export function resolveWebAuthnConfig(
  trustedOrigin = process.env.NEXT_PUBLIC_SITE_URL,
): WebAuthnConfig {
  if (!trustedOrigin || trustedOrigin !== trustedOrigin.trim()) invalidConfiguration()

  let url: URL
  try {
    url = new URL(trustedOrigin)
  } catch {
    invalidConfiguration()
  }

  if (
    url.origin !== trustedOrigin ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    invalidConfiguration()
  }

  const hostname = url.hostname
  const isLocalhost = hostname === 'localhost'

  if (isLocalhost) {
    if (url.protocol !== 'http:' || (url.port && Number(url.port) === 0)) invalidConfiguration()
  } else if (
    url.protocol !== 'https:' ||
    hostname.endsWith('.localhost') ||
    !isDnsHostname(hostname) ||
    isIpAddress(hostname) ||
    isPreviewHost(hostname)
  ) {
    invalidConfiguration()
  }

  return {
    rpName: WEBAUTHN_RP_NAME,
    origin: url.origin,
    rpID: hostname,
  }
}
