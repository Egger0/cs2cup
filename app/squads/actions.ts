'use server'

import { revalidatePath } from 'next/cache'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'
import { clientFingerprint } from '@/lib/ratelimit'
import { createRegistrationAccess } from '@/lib/registration-access'
import { parseSquadRegistrationDetails, registerSquad } from '@/lib/squad-registration'
import {
  disbandSquad,
  removeSquadMember,
  respondToSquadInvitation,
  revokeSquadInvitation,
} from '@/lib/squad-roster'
import { createSquad, inviteToSquad, parseSquadIdentity } from '@/lib/squads'

export type SquadActionResult = { ok: true; message?: string } | { ok: false; error: string }

const COPY = {
  taken: '这个名称或 TAG 已被占用，换一个试试。',
  already_in_squad: '你在这个项目里已经有小队了。',
  unavailable: '这个项目暂时不能组队。',
  not_captain: '只有队长可以这样做。',
  not_found: '没有找到这个账号，请确认对方的用户名或公开主页地址。',
  self: '不能邀请自己。',
  full: '小队已经满员。',
  pending: '已经向对方发出过邀请，等待回应中。',
  limit: '待回应的邀请太多了，先撤回一些再邀请。',
  not_allowed: '队长不能离开小队，可以选择解散。',
  not_full: '小队满员后才能报名。',
  closed: '这场赛事当前不接受报名。',
  duplicate_nicknames: '有队员的显示名称重复，请其中一人修改显示名称后再报名。',
  authorization_changed: '报名需要通过成员资格审核且登录状态有效，请前往账号中心查看。',
  invalid_details: '请填写 1–40 个字符的联系方式，学院与备注不要超长。',
} as const

async function signedIn() {
  const database = cloudflareBindings().db
  const context = await getAuthContext({ database })
  if (context.kind === 'anonymous' || context.session.recoveryRestricted) return null
  return { database, context, accountId: context.account.id, now: currentTimeMillis() }
}

function done(result: { ok: true } | { ok: false; reason: keyof typeof COPY }, message?: string) {
  if (!result.ok) return { ok: false as const, error: COPY[result.reason] }
  revalidatePath('/squads')
  revalidatePath('/me')
  return { ok: true as const, message }
}

const SIGNED_OUT = { ok: false as const, error: '登录已失效，请重新登录。' }

export async function createSquadAction(form: FormData): Promise<SquadActionResult> {
  const session = await signedIn()
  if (!session) return SIGNED_OUT
  const identity = parseSquadIdentity(form.get('name'), form.get('tag'))
  const gameId = Number(form.get('gameId'))
  if (!identity || !Number.isSafeInteger(gameId)) {
    return { ok: false, error: '小队名称需为 1–20 个字符，TAG 为 2–5 位字母或数字。' }
  }
  const result = await createSquad(
    session.database,
    session.accountId,
    { gameId, ...identity },
    session.now,
  )
  return done(result, '小队已创建，去邀请队友吧。')
}

export async function inviteToSquadAction(
  squadId: string,
  form: FormData,
): Promise<SquadActionResult> {
  const session = await signedIn()
  if (!session) return SIGNED_OUT
  const identifier = String(form.get('identifier') ?? '')
  const result = await inviteToSquad(
    session.database,
    { captainAccountId: session.accountId, squadId, identifier },
    session.now,
  )
  return done(result, result.ok ? `已邀请 ${result.displayName}。` : undefined)
}

export async function respondToSquadInvitationAction(invitationId: string, accept: boolean) {
  const session = await signedIn()
  if (!session) return SIGNED_OUT
  const result = await respondToSquadInvitation(
    session.database,
    { accountId: session.accountId, invitationId, accept },
    session.now,
  )
  return done(result, accept ? '已加入小队。' : '已婉拒邀请。')
}

export async function revokeSquadInvitationAction(invitationId: string) {
  const session = await signedIn()
  if (!session) return SIGNED_OUT
  return done(
    await revokeSquadInvitation(
      session.database,
      { captainAccountId: session.accountId, invitationId },
      session.now,
    ),
  )
}

export async function removeSquadMemberAction(squadId: string, memberAccountId: string) {
  const session = await signedIn()
  if (!session) return SIGNED_OUT
  return done(
    await removeSquadMember(session.database, {
      actorAccountId: session.accountId,
      squadId,
      memberAccountId,
    }),
  )
}

export async function disbandSquadAction(squadId: string) {
  const session = await signedIn()
  if (!session) return SIGNED_OUT
  return done(
    await disbandSquad(session.database, { captainAccountId: session.accountId, squadId }),
  )
}

export async function registerSquadAction(
  squadId: string,
  tournamentId: number,
  form: FormData,
): Promise<SquadActionResult> {
  const session = await signedIn()
  if (!session || session.context.kind !== 'authenticated') return SIGNED_OUT
  const details = parseSquadRegistrationDetails(Object.fromEntries(form))
  if (!details) return { ok: false, error: COPY.invalid_details }
  try {
    const access = await createRegistrationAccess()
    const result = await registerSquad(session.database, session.context, {
      squadId,
      tournamentId,
      details,
      fingerprint: await clientFingerprint(),
      managementTokenHash: access.tokenHash,
      now: session.now,
    })
    return done(result, '报名已提交，等待主办方审核。')
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('提交太频繁')) {
      return { ok: false, error: '提交太频繁。每 60 分钟最多尝试 3 次，请稍后再试。' }
    }
    if (message.includes('席位已满')) return { ok: false, error: '席位已满' }
    console.error('[squads] registration unavailable', error)
    return { ok: false, error: '报名服务暂时不可用，请稍后再试。' }
  }
}
