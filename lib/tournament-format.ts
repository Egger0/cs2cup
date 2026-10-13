export const POINTS_FORMAT = 'group_points'

export const playsHeadToHead = (tournament: { format: string }) =>
  tournament.format !== POINTS_FORMAT

export const fixturesEntry = (tournament: { format: string }) =>
  playsHeadToHead(tournament)
    ? ({ path: '/schedule', label: '比赛日程' } as const)
    : ({ path: '/bracket', label: '对阵表' } as const)
