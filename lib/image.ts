export interface ImageSize {
  width: number
  height: number
}

export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

function ascii(buffer: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...buffer.subarray(start, end))
}

function view(buffer: Uint8Array) {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

function dimensions(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null
}

const MAX_JPEG_MARKERS = 128
const MAX_JPEG_FILL_BYTES = 16

function jpegSize(buffer: Uint8Array): ImageSize | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null
  }
  const data = view(buffer)
  let offset = 2
  for (let markerCount = 0; markerCount < MAX_JPEG_MARKERS; markerCount += 1) {
    if (buffer[offset] !== 0xff) return null

    let fillBytes = 0
    while (buffer[offset] === 0xff) {
      offset += 1
      fillBytes += 1
      if (fillBytes > MAX_JPEG_FILL_BYTES) return null
    }

    const marker = buffer[offset]
    if (marker === undefined || marker === 0x00 || marker === 0xd8) return null
    offset += 1
    if (marker === 0xd9 || marker === 0xda) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) return null

    if (offset + 2 > buffer.length) return null
    const segmentLength = data.getUint16(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null

    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (segmentLength < 8) return null
      return dimensions(data.getUint16(offset + 5), data.getUint16(offset + 3))
    }

    offset += segmentLength
  }
  return null
}

function pngSize(buffer: Uint8Array): ImageSize | null {
  if (
    buffer.length < 24
    || buffer[0] !== 0x89
    || ascii(buffer, 1, 4) !== 'PNG'
    || ascii(buffer, 12, 16) !== 'IHDR'
  ) return null
  const data = view(buffer)
  return dimensions(data.getUint32(16), data.getUint32(20))
}

function webpSize(buffer: Uint8Array): ImageSize | null {
  if (
    buffer.length < 30
    || ascii(buffer, 0, 4) !== 'RIFF'
    || ascii(buffer, 8, 12) !== 'WEBP'
  ) return null
  const data = view(buffer)
  const format = ascii(buffer, 12, 16)
  if (format === 'VP8 ') {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null
    return dimensions(
      data.getUint16(26, true) & 0x3fff,
      data.getUint16(28, true) & 0x3fff,
    )
  }
  if (format === 'VP8L') {
    if (buffer[20] !== 0x2f) return null
    const bits = data.getUint32(21, true)
    return dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (format === 'VP8X') {
    return dimensions(
      (data.getUint8(24) | (data.getUint8(25) << 8) | (data.getUint8(26) << 16)) + 1,
      (data.getUint8(27) | (data.getUint8(28) << 8) | (data.getUint8(29) << 16)) + 1,
    )
  }
  return null
}

export function imageSize(mime: string, buffer: Uint8Array): ImageSize | null {
  if (mime === 'image/jpeg') return jpegSize(buffer)
  if (mime === 'image/png') return pngSize(buffer)
  if (mime === 'image/webp') return webpSize(buffer)
  return null
}

export function sniffMime(buffer: Uint8Array): string | null {
  if (buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (
    buffer[0] === 0x89
    && ascii(buffer, 1, 4) === 'PNG'
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) return 'image/png'
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return null
}
