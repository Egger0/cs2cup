export interface ParticipantEntryAttachmentBody {
  slug: string
  managementToken: string
}

export function exactParticipantEntryAttachmentBody(
  value: unknown,
): ParticipantEntryAttachmentBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (
    keys.length !== 2 ||
    !Object.hasOwn(value, 'slug') ||
    !Object.hasOwn(value, 'managementToken')
  ) {
    return null
  }
  const body = value as Record<string, unknown>
  return typeof body.slug === 'string' && typeof body.managementToken === 'string'
    ? { slug: body.slug, managementToken: body.managementToken }
    : null
}
