export function bracketSize(teamCount: number): number {
  if (!Number.isInteger(teamCount) || teamCount < 2) {
    throw new RangeError('teamCount must be an integer greater than or equal to 2')
  }

  return 2 ** Math.ceil(Math.log2(teamCount))
}

export function seedPositions(size: number): number[] {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    throw new RangeError('size must be a power of two greater than or equal to 2')
  }

  let positions = [1, 2]
  for (let currentSize = 4; currentSize <= size; currentSize *= 2) {
    positions = positions.flatMap(seed => [seed, currentSize + 1 - seed])
  }
  return positions
}

export function orderBySeed<T extends { seed: number | null }>(entries: readonly T[]): T[] {
  const ordered: (T | undefined)[] = Array(entries.length)
  const unseeded: T[] = []

  for (const entry of entries) {
    if (entry.seed === null) {
      unseeded.push(entry)
      continue
    }
    if (!Number.isInteger(entry.seed) || entry.seed < 1 || entry.seed > entries.length) {
      throw new RangeError(`seed must be between 1 and ${entries.length}`)
    }
    if (ordered[entry.seed - 1]) throw new RangeError(`duplicate seed ${entry.seed}`)
    ordered[entry.seed - 1] = entry
  }

  let nextUnseeded = 0
  return Array.from(
    { length: entries.length },
    (_, index) => ordered[index] ?? unseeded[nextUnseeded++]!,
  )
}
