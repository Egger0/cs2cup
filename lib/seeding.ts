export interface PlannedRound {
  round: number
  label: string
  matches: number
  bestOf: number
}

const LABELS: Record<number, string> = {
  1: '总决赛',
  2: '半决赛',
  4: '八强',
  8: '16 强',
  16: '32 强',
}

export function planRounds(capacity: number, openingBestOf = 3, finalBestOf = 5): PlannedRound[] {
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, capacity)))
  const rounds: PlannedRound[] = []
  let matches = size / 2
  let round = 0

  while (matches >= 1) {
    rounds.push({
      round,
      label: LABELS[matches] ?? `第 ${round + 1} 轮`,
      matches,
      bestOf: matches === 1 ? finalBestOf : openingBestOf,
    })
    matches /= 2
    round += 1
  }

  return rounds
}

export function firstRoundPairs(size: number): [number, number][] {
  const pairs: [number, number][] = []
  for (let slot = 0; slot < size / 2; slot += 1) {
    pairs.push([slot + 1, size - slot])
  }
  return pairs
}
