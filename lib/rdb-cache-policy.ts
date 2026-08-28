export const MAX_CACHE_TAGS = 128
export const MAX_CACHE_TAG_LENGTH = 256

export type PublicDataCache =
  | { mode: 'no-store' }
  | {
      mode: 'revalidate'
      seconds: number
      tags?: readonly string[]
    }

export type PublicDataFetchOptions =
  | { cache: 'no-store' }
  | {
      next: {
        revalidate: number
        tags?: string[]
      }
    }

function validatedTags(tags: readonly string[] | undefined) {
  if (tags === undefined || tags.length === 0) return undefined
  if (tags.length > MAX_CACHE_TAGS) {
    throw new RangeError(`public cache policy supports at most ${MAX_CACHE_TAGS} tags`)
  }

  const copy = [...tags]
  for (const tag of copy) {
    if (tag.length === 0 || tag.length > MAX_CACHE_TAG_LENGTH) {
      throw new RangeError(
        `public cache tags must contain between 1 and ${MAX_CACHE_TAG_LENGTH} characters`,
      )
    }
  }
  return copy
}

export function publicDataFetchOptions(policy: PublicDataCache): PublicDataFetchOptions {
  if (policy.mode === 'no-store') return { cache: 'no-store' }
  if (!Number.isSafeInteger(policy.seconds) || policy.seconds <= 0) {
    throw new RangeError('public cache revalidation must be a positive safe integer')
  }

  const tags = validatedTags(policy.tags)
  return {
    next: {
      revalidate: policy.seconds,
      ...(tags ? { tags } : {}),
    },
  }
}
