const MAX_IMAGE_EDGE = 2560

export function fittedImageSize(width: number, height: number) {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export async function normalizeImageFile(file: File) {
  const image = await createImageBitmap(file)
  try {
    const size = fittedImageSize(image.width, image.height)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.drawImage(image, 0, 0, size.width, size.height)

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/webp', 0.9)
    })
    if (!blob) throw new Error('WebP encoding failed')
    return new File([blob], 'upload.webp', { type: 'image/webp' })
  } finally {
    image.close()
  }
}
