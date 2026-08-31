import { requireAdmin } from '@/lib/auth'
import { encodeCsv, type CsvValue } from '@/lib/csv'
import { d1UtcTimestampToIso, formatSiteNumericDateTime } from '@/lib/datetime'
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/http-cache'
import { listTeamsWithContact } from '@/lib/queries/admin'
import { adminListTournaments } from '@/lib/queries/content'
import type { TeamStatus } from '@/lib/types'

const STATUS_LABEL: Record<TeamStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
}

const RESPONSE_HEADERS = {
  ...PRIVATE_NO_STORE_HEADERS,
  'X-Content-Type-Options': 'nosniff',
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()

  const tournamentId = Number((await params).id)
  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) {
    return new Response('Invalid tournament', { status: 400, headers: RESPONSE_HEADERS })
  }

  const tournaments = await adminListTournaments()
  if (!tournaments.some(tournament => tournament.id === tournamentId)) {
    return new Response('Tournament not found', { status: 404, headers: RESPONSE_HEADERS })
  }

  const teams = await listTeamsWithContact(tournamentId)
  const rows: CsvValue[][] = [
    [
      '种子',
      '状态',
      '签到状态',
      'TAG',
      '战队名称',
      '队长',
      '联系方式',
      '学院',
      '首发队员',
      '替补队员',
      '备注',
      '签到时间（北京时间）',
      '报名时间（北京时间）',
    ],
    ...teams.map(team => [
      team.seed,
      STATUS_LABEL[team.status],
      team.checkedInAt ? '已签到' : '未签到',
      team.tag,
      team.name,
      team.captain,
      team.contact,
      team.dept,
      team.players
        .filter(player => !player.isSubstitute)
        .map(player => player.nickname)
        .join(' / '),
      team.players
        .filter(player => player.isSubstitute)
        .map(player => player.nickname)
        .join(' / '),
      team.note,
      team.checkedInAt ? formatSiteNumericDateTime(team.checkedInAt) : null,
      formatSiteNumericDateTime(d1UtcTimestampToIso(team.createdAt) ?? '') ?? team.createdAt,
    ]),
  ]

  return new Response(`\uFEFF${encodeCsv(rows)}`, {
    headers: {
      ...RESPONSE_HEADERS,
      'Content-Disposition': `attachment; filename="tournament-${tournamentId}-teams.csv"`,
      'Content-Type': 'text/csv; charset=utf-8',
    },
  })
}
