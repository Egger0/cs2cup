const ZIP = [0x50, 0x4b, 0x03, 0x04]
const PDF = [0x25, 0x50, 0x44, 0x46]
const OFFICE = 'application/vnd.openxmlformats-officedocument'

export const HANDBOOK_MAX_BYTES = 10 * 1024 * 1024

export const HANDBOOK_FILE_TYPES = {
  pdf: { label: 'PDF', mime: 'application/pdf', magic: PDF },
  docx: { label: 'Word', mime: `${OFFICE}.wordprocessingml.document`, magic: ZIP },
  xlsx: { label: 'Excel', mime: `${OFFICE}.spreadsheetml.sheet`, magic: ZIP },
  pptx: { label: 'PowerPoint', mime: `${OFFICE}.presentationml.presentation`, magic: ZIP },
  zip: { label: 'ZIP', mime: 'application/zip', magic: ZIP },
  md: { label: 'Markdown', mime: 'text/markdown; charset=utf-8', magic: null },
  txt: { label: 'TXT', mime: 'text/plain; charset=utf-8', magic: null },
} as const

export type HandbookFileType = keyof typeof HANDBOOK_FILE_TYPES

export const HANDBOOK_ACCEPT = Object.keys(HANDBOOK_FILE_TYPES)
  .map(extension => `.${extension}`)
  .join(',')

export function handbookFileType(name: string): HandbookFileType | null {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  return extension in HANDBOOK_FILE_TYPES ? (extension as HandbookFileType) : null
}

function isText(bytes: Uint8Array) {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

export function handbookFileMatches(type: HandbookFileType, bytes: Uint8Array) {
  const { magic } = HANDBOOK_FILE_TYPES[type]
  return magic ? magic.every((byte, index) => bytes[index] === byte) : isText(bytes)
}

export function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
