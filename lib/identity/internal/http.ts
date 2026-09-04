import 'server-only'

const DEFAULT_MAX_BODY_BYTES = 8 * 1024

export class IdentityRequestError extends Error {
  constructor() {
    super('Invalid identity request')
    this.name = 'IdentityRequestError'
  }
}

async function boundedRequestBytes(request: Request, maxBytes: number) {
  const contentLength = request.headers.get('content-length')
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)
  ) {
    throw new IdentityRequestError()
  }
  const reader = request.body?.getReader()
  if (!reader) throw new IdentityRequestError()

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        // Rejection does not depend on whether the incoming stream accepts cancellation.
      }
      throw new IdentityRequestError()
    }
    chunks.push(value)
  }
  if (!total) throw new IdentityRequestError()
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export async function readIdentityForm<const Field extends string>(
  request: Request,
  allowedFields: readonly Field[],
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<Record<Field, string>> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (
    contentType !== 'application/x-www-form-urlencoded' ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 64 * 1024 ||
    !allowedFields.length
  ) {
    throw new IdentityRequestError()
  }

  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(
      await boundedRequestBytes(request, maxBytes),
    )
    const form = new URLSearchParams(source)
    const allowed = new Set<string>(allowedFields)
    if ([...form.keys()].some(key => !allowed.has(key))) throw new IdentityRequestError()
    const result = {} as Record<Field, string>
    for (const field of allowedFields) {
      const values = form.getAll(field)
      if (values.length !== 1) throw new IdentityRequestError()
      result[field] = values[0] ?? ''
    }
    return result
  } catch (error) {
    if (error instanceof IdentityRequestError) throw error
    throw new IdentityRequestError()
  }
}

export async function readIdentityJson<Result extends Record<string, unknown>>(
  request: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<Result> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new IdentityRequestError()
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(
      await boundedRequestBytes(request, maxBytes),
    )
    const value: unknown = JSON.parse(source)
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new IdentityRequestError()
    }
    return value as Result
  } catch (error) {
    if (error instanceof IdentityRequestError) throw error
    throw new IdentityRequestError()
  }
}

export function identityWantsJson(request: Request) {
  return Boolean(
    request.headers
      .get('accept')
      ?.split(',')
      .some(value => value.trim() === 'application/json'),
  )
}
