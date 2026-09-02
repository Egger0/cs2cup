const MAX_PASSKEY_BODY_BYTES = 64 * 1024

export class PasskeyRequestError extends Error {
  constructor() {
    super('Invalid passkey request')
    this.name = 'PasskeyRequestError'
  }
}

export async function readPasskeyJson<Type>(request: Request): Promise<Type> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim()
  if (contentType !== 'application/json') throw new PasskeyRequestError()

  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_PASSKEY_BODY_BYTES) {
      throw new PasskeyRequestError()
    }
  }

  const reader = request.body?.getReader()
  if (!reader) throw new PasskeyRequestError()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_PASSKEY_BODY_BYTES) {
      try {
        await reader.cancel()
      } catch {
        // The request is rejected even when the upstream stream cannot be cancelled.
      }
      throw new PasskeyRequestError()
    }
    chunks.push(value)
  }

  if (total === 0) throw new PasskeyRequestError()
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const value: unknown = JSON.parse(source)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PasskeyRequestError()
    return value as Type
  } catch (error) {
    if (error instanceof PasskeyRequestError) throw error
    throw new PasskeyRequestError()
  }
}
