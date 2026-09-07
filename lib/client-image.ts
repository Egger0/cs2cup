import { plannedVariantWidths } from './photo-variants.ts'

const MAX_IMAGE_EDGE = 2560
const BLUR_EDGE = 16

export function fittedImageSize(width: number, height: number) {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function scaledImageSize(width: number, height: number, target: number) {
  const scale = Math.min(1, target / width)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function encode(image: ImageBitmap, width: number, height: number, quality: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.drawImage(image, 0, 0, width, height)

  const blob = await new Promise<Blob | null>(resolve => {
    canvas.toBlob(resolve, 'image/webp', quality)
  })
  if (!blob) throw new Error('WebP encoding failed')
  return { blob, canvas }
}

export async function normalizeImageFile(file: File) {
  const image = await createImageBitmap(file)
  try {
    const size = fittedImageSize(image.width, image.height)
    const rendered = await encode(image, size.width, size.height, 0.9)
    return new File([rendered.blob], 'upload.webp', { type: 'image/webp' })
  } finally {
    image.close()
  }
}

export async function renderImageVariants(file: File) {
  const image = await createImageBitmap(file)
  try {
    const fitted = fittedImageSize(image.width, image.height)
    const base = await encode(image, fitted.width, fitted.height, 0.9)

    const variants = []
    for (const width of plannedVariantWidths(fitted.width)) {
      const size = scaledImageSize(fitted.width, fitted.height, width)
      const rendered = await encode(image, size.width, size.height, 0.82)
      variants.push({
        width,
        file: new File([rendered.blob], `variant-${width}.webp`, { type: 'image/webp' }),
      })
    }

    const blurSize = scaledImageSize(fitted.width, fitted.height, BLUR_EDGE)
    const blur = await encode(image, blurSize.width, blurSize.height, 0.5)

    return {
      base: new File([base.blob], 'upload.webp', { type: 'image/webp' }),
      variants,
      blurDataUrl: blur.canvas.toDataURL('image/webp', 0.5),
      width: fitted.width,
      height: fitted.height,
    }
  } finally {
    image.close()
  }
}
