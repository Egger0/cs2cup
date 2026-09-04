import { NextResponse } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { checkInFromQq, linkQqAccount, qqCheckInLeaderboard } from '@/lib/qq-daily-check-in'
import {
  qqBotConfig,
  qqCommand,
  qqGroupMessage,
  qqWebhookVerification,
  replyToQqGroup,
  verifyQqWebhookSignature,
} from '@/lib/qq-bot'
import { getCurrentTournament } from '@/lib/queries/public/tournaments'
import { resolveSiteOrigin } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

function tournamentTime(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

async function commandReply(
  command: NonNullable<ReturnType<typeof qqCommand>>,
  groupOpenId: string,
  memberOpenId: string,
) {
  const database = cloudflareBindings().db
  if (command.kind === 'bind') {
    const linked = await linkQqAccount(database, { groupOpenId, memberOpenId, code: command.code })
    if (linked.ok) return '绑定成功。现在可以发送“签到”参加社团每日打卡。'
    if (linked.reason === 'already_bound') return '这个 QQ 已经绑定过网站账号，不能覆盖绑定。'
    if (linked.reason === 'account_bound')
      return '这个网站账号已经绑定过 QQ；如需换绑，请联系平台负责人。'
    return '绑定码无效或已过期。请登录网站，在“我的账号”重新获取一次性绑定码。'
  }
  if (command.kind === 'check_in') {
    const result = await checkInFromQq(database, { groupOpenId, memberOpenId })
    if (result.kind === 'unbound') {
      return '请先登录网站，在“我的账号”获取绑定码，再发送“/绑定 绑定码”。'
    }
    if (result.kind === 'already_checked_in') return `今天已经签到，当前连续 ${result.streak} 天。`
    return `签到成功：连续 ${result.streak} 天，当前第 ${result.rank} 名。`
  }
  if (command.kind === 'leaderboard') {
    const ranking = await qqCheckInLeaderboard(database, groupOpenId)
    if (!ranking.length) return '还没有有效的连续签到记录。发送“签到”成为第一位打卡成员。'
    return `连续签到排行\n${ranking
      .map((entry, index) => `${index + 1}. ${entry.displayName} · ${entry.streak} 天`)
      .join('\n')}`
  }
  const tournament = await getCurrentTournament()
  const base = resolveSiteOrigin()
  if (!tournament) return `当前没有报名中、进行中或延期赛事。\n${base}/tournaments`
  const status =
    tournament.status === 'registration'
      ? '报名阶段'
      : tournament.status === 'running'
        ? '进行中'
        : '延期中'
  const detail =
    tournament.status === 'registration'
      ? tournamentTime(tournament.regDeadline)
        ? `报名截止：${tournamentTime(tournament.regDeadline)}`
        : null
      : tournamentTime(tournament.startsAt)
        ? `开始时间：${tournamentTime(tournament.startsAt)}`
        : null
  return [
    `最近赛事：${tournament.title}`,
    `状态：${status}`,
    detail,
    `${base}/tournaments/${tournament.slug}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function POST(request: Request) {
  const config = qqBotConfig()
  if (!config) return new NextResponse('QQ bot is not configured', { status: 503 })
  const body = await request.text()
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 })
  }
  const verification = qqWebhookVerification(payload, config.appSecret)
  if (verification) return NextResponse.json(verification)
  if (request.headers.get('x-bot-appid') !== config.appId)
    return new NextResponse('Forbidden', { status: 403 })
  if (!verifyQqWebhookSignature(request.headers, body, config.appSecret)) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  const message = qqGroupMessage(payload)
  if (!message || !config.allowedGroupOpenId || message.groupOpenId !== config.allowedGroupOpenId)
    return new NextResponse(null, { status: 204 })
  const command = qqCommand(message.content)
  if (!command) return new NextResponse(null, { status: 204 })
  try {
    const content = await commandReply(command, message.groupOpenId, message.memberOpenId)
    await replyToQqGroup(config, message, content)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[qq-bot] command handling unavailable', error)
    return new NextResponse('QQ bot unavailable', { status: 503 })
  }
}
