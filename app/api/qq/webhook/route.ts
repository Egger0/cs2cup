import { NextResponse } from 'next/server'

import { cloudflareBindings, cloudflareEnvironment } from '@/lib/cloudflare-bindings'
import { formatSiteCompactDateTime } from '@/lib/datetime'
import { buildScheduleEntries } from '@/lib/schedule'
import { stardustBalance, stardustGrantedAt } from '@/lib/stardust'
import { loadoutDigest } from '@/lib/loadout-codes'
import { sendQqWelcome } from '@/lib/qq-automation'
import {
  checkInFromQq,
  linkQqAccountByUsername,
  qqAccountRegistrations,
  qqCheckInLeaderboard,
  qqLinkedAccountId,
  unlinkQqAccount,
} from '@/lib/qq-daily-check-in'
import {
  qqBotConfig,
  qqCommand,
  qqGroupMemberAdd,
  qqGroupMessage,
  qqWebhookVerification,
  replyToQqGroup,
  verifyQqWebhookSignature,
} from '@/lib/qq-bot'
import { getMatches, getPublicTeams } from '@/lib/queries/public/matches'
import { getCurrentTournament } from '@/lib/queries/public/tournaments'
import { accountNextMatchFromDatabase } from '@/lib/queries/participant-next-match'
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

function bindHint() {
  return '请先发送“/绑定 你的用户名”。'
}

function registrationStatus(status: 'pending' | 'approved' | 'rejected') {
  return status === 'approved' ? '已通过' : status === 'pending' ? '待审核' : '未通过'
}

function teamLabel(team: { name: string; tag: string } | null) {
  return team ? `[${team.tag}] ${team.name}` : '待定'
}

async function commandReply(
  command: NonNullable<ReturnType<typeof qqCommand>>,
  groupOpenId: string,
  memberOpenId: string,
) {
  const database = cloudflareBindings().db
  if (command.kind === 'bind') {
    const linked = await linkQqAccountByUsername(database, {
      groupOpenId,
      memberOpenId,
      username: command.username,
    })
    if (linked.ok) return '绑定成功。现在可以发送“签到”参加社团每日打卡。'
    if (linked.reason === 'already_bound') return '这个 QQ 已经绑定过网站账号，不能覆盖绑定。'
    if (linked.reason === 'account_bound')
      return '这个网站账号已经绑定过 QQ；如需换绑，请联系平台负责人。'
    if (linked.reason === 'username_not_found') return '该用户名未注册，请前往官网创建账号。'
    return '用户名格式不正确。请使用网站登录时的用户名。'
  }
  if (command.kind === 'unbind') {
    const unlinked = await unlinkQqAccount(database, { groupOpenId, memberOpenId })
    return unlinked.ok ? '已解除当前 QQ 的网站账号绑定。' : '当前 QQ 没有可解除的绑定。'
  }
  if (command.kind === 'check_in') {
    const result = await checkInFromQq(database, { groupOpenId, memberOpenId })
    if (result.kind === 'unbound') {
      return '请先发送“/绑定 你的用户名”。'
    }
    if (result.kind === 'already_checked_in') return `今天已经签到，当前连续 ${result.streak} 天。`
    const reward = result.reward ? `，获得 ${result.reward} 星尘` : ''
    return `签到成功：连续 ${result.streak} 天，当前第 ${result.rank} 名${reward}。`
  }
  const base = resolveSiteOrigin()
  if (command.kind === 'my_schedule') {
    const accountId = await qqLinkedAccountId(database, groupOpenId, memberOpenId)
    if (!accountId) return bindHint()
    const next = await accountNextMatchFromDatabase(database, accountId)
    if (!next) return `当前没有已安排的下一场比赛。\n${base}/me`
    const time = formatSiteCompactDateTime(next.match.scheduledAt ?? '') ?? '时间待定'
    return [
      '我的下一场',
      `${next.tournament.title} · ${next.match.roundLabel} · BO${next.match.bestOf}`,
      `${teamLabel(next.match.teamA)} vs ${teamLabel(next.match.teamB)}`,
      `时间：${time}`,
      `${base}/tournaments/${next.tournament.slug}/matches/${next.match.id}`,
    ].join('\n')
  }
  if (command.kind === 'my_registrations') {
    const accountId = await qqLinkedAccountId(database, groupOpenId, memberOpenId)
    if (!accountId) return bindHint()
    const registrations = await qqAccountRegistrations(database, accountId)
    if (!registrations.length) return `当前没有可查看的赛事报名。\n${base}/me`
    return [
      '我的报名',
      ...registrations.map(
        registration =>
          `[${registration.teamTag}] ${registration.teamName} · ${registration.tournamentTitle} · ${registrationStatus(registration.status)}${registration.checkedInAt ? ' · 已签到' : ''}`,
      ),
      `${base}/me`,
    ].join('\n')
  }
  if (command.kind === 'stardust') {
    const accountId = await qqLinkedAccountId(database, groupOpenId, memberOpenId)
    if (!accountId) return bindHint()
    const [balance, checkedInAt] = await Promise.all([
      stardustBalance(database, accountId),
      stardustGrantedAt(database, accountId, 'check_in', Date.now()),
    ])
    return `我的星尘：${balance}\n今日签到：${checkedInAt === null ? '未完成' : '已完成'}\n${base}/me#stardust-wallet`
  }
  if (command.kind === 'loadouts') return loadoutDigest(database, command.query, base)
  if (command.kind === 'schedule') {
    const tournament = await getCurrentTournament()
    if (!tournament) return `当前没有报名中、进行中或延期赛事。\n${base}/tournaments`
    const [matches, teams] = await Promise.all([
      getMatches(tournament.id),
      getPublicTeams(tournament.id),
    ])
    const schedule = buildScheduleEntries(matches, teams)
      .filter(entry => entry.status === 'upcoming')
      .slice(0, 3)
    const href = `${base}/tournaments/${tournament.slug}/schedule`
    if (!schedule.length) return `「${tournament.title}」暂时没有已排期的近期比赛。\n${href}`
    return [
      `近期赛程：${tournament.title}`,
      ...schedule.map(
        (entry, index) =>
          `${index + 1}. ${formatSiteCompactDateTime(entry.match.scheduledAt ?? '') ?? '时间待定'} · ${teamLabel(entry.a)} vs ${teamLabel(entry.b)}`,
      ),
      href,
    ].join('\n')
  }
  if (command.kind === 'leaderboard') {
    const ranking = await qqCheckInLeaderboard(database, groupOpenId)
    if (!ranking.length) return '还没有有效的连续签到记录。发送“签到”成为第一位打卡成员。'
    return `连续签到排行\n${ranking
      .map((entry, index) => `${index + 1}. ${entry.displayName} · ${entry.streak} 天`)
      .join('\n')}`
  }
  const tournament = await getCurrentTournament()
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
  const config = qqBotConfig(cloudflareEnvironment())
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
  const memberAdd = qqGroupMemberAdd(payload)
  if (memberAdd) {
    if (!config.allowedGroupOpenId || memberAdd.groupOpenId !== config.allowedGroupOpenId) {
      return new NextResponse(null, { status: 204 })
    }
    try {
      await sendQqWelcome(
        config,
        cloudflareBindings().db,
        memberAdd.groupOpenId,
        memberAdd.eventId,
        memberAdd.memberOpenId,
      )
      return new NextResponse(null, { status: 204 })
    } catch (error) {
      console.error('[qq-bot] welcome message unavailable', error)
      return new NextResponse('QQ bot unavailable', { status: 503 })
    }
  }
  const message = qqGroupMessage(payload)
  if (!message) return new NextResponse(null, { status: 204 })
  const command = qqCommand(message.content)
  if (!command) return new NextResponse(null, { status: 204 })
  if (!config.allowedGroupOpenId) {
    console.info('[qq-bot] allowed group OpenID needed', { groupOpenId: message.groupOpenId })
    if (command.kind === 'check_in') {
      try {
        await replyToQqGroup(
          config,
          message,
          `机器人正在完成官方群绑定。请将这串群标识发给平台负责人：${message.groupOpenId}`,
        )
      } catch (error) {
        console.error('[qq-bot] group binding reply unavailable', error)
        return new NextResponse('QQ bot unavailable', { status: 503 })
      }
    }
    return new NextResponse(null, { status: 204 })
  }
  if (message.groupOpenId !== config.allowedGroupOpenId)
    return new NextResponse(null, { status: 204 })
  try {
    const content = await commandReply(command, message.groupOpenId, message.memberOpenId)
    await replyToQqGroup(config, message, content)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[qq-bot] command handling unavailable', error)
    return new NextResponse('QQ bot unavailable', { status: 503 })
  }
}
