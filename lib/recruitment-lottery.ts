import 'server-only'

import { createOpaqueToken } from './opaque-token.ts'
import type { IdentityDatabase } from './identity/kernel.ts'

export const RECRUITMENT_LOTTERY_CAMPAIGN_ID = 'recruitment-2026-09-20'

type CampaignRow = {
  id: string
  title: string
  startsAt: number
  endsAt: number
}

type DrawRow = {
  prizeTitle: string
  requiresClaim: number
  receiptCode: string | null
  claimedAt: number | null
}

export type RecruitmentLotteryState = {
  campaign: CampaignRow | null
  eligible: boolean
  phase: 'upcoming' | 'open' | 'closed' | 'unavailable'
  draw: {
    prizeTitle: string
    receiptCode: string | null
    claimedAt: number | null
  } | null
}

export type RecruitmentLotteryDrawResult = { ok: true } | { ok: false; error: string }

function phaseOf(campaign: CampaignRow | null, now: number): RecruitmentLotteryState['phase'] {
  if (!campaign) return 'unavailable'
  if (now < campaign.startsAt) return 'upcoming'
  if (now >= campaign.endsAt) return 'closed'
  return 'open'
}

function receiptCode() {
  return createOpaqueToken()
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 10)
    .toUpperCase()
}

function normalizeReceiptCode(value: string) {
  const code = value.trim().toUpperCase()
  return /^[A-Z0-9]{10}$/.test(code) ? code : null
}

async function campaign(database: IdentityDatabase) {
  return database
    .prepare(
      `SELECT id, title, starts_at AS startsAt, ends_at AS endsAt
       FROM recruitment_lottery_campaign WHERE id = ?`,
    )
    .bind(RECRUITMENT_LOTTERY_CAMPAIGN_ID)
    .first<CampaignRow>()
}

async function drawForAccount(database: IdentityDatabase, accountId: string) {
  return database
    .prepare(
      `SELECT prize.title AS prizeTitle, prize.requires_claim AS requiresClaim,
              draw.receipt_code AS receiptCode, draw.claimed_at AS claimedAt
       FROM recruitment_lottery_draw AS draw
       JOIN recruitment_lottery_ticket AS ticket ON ticket.id = draw.ticket_id
       JOIN recruitment_lottery_prize AS prize ON prize.id = ticket.prize_id
       WHERE draw.campaign_id = ? AND draw.account_id = ?`,
    )
    .bind(RECRUITMENT_LOTTERY_CAMPAIGN_ID, accountId)
    .first<DrawRow>()
}

async function approvedMember(database: IdentityDatabase, accountId: string) {
  const row = await database
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM identity_membership WHERE account_id = ? AND status = 'approved'
       ) AS eligible`,
    )
    .bind(accountId)
    .first<{ eligible: number }>()
  return row?.eligible === 1
}

function visibleDraw(row: DrawRow | null): RecruitmentLotteryState['draw'] {
  if (!row) return null
  return {
    prizeTitle: row.prizeTitle,
    receiptCode: row.requiresClaim === 1 ? row.receiptCode : null,
    claimedAt: row.claimedAt,
  }
}

export async function recruitmentLotteryState(
  database: IdentityDatabase,
  accountId: string | null,
  now: number,
): Promise<RecruitmentLotteryState> {
  const currentCampaign = await campaign(database)
  if (!accountId) {
    return {
      campaign: currentCampaign,
      eligible: false,
      phase: phaseOf(currentCampaign, now),
      draw: null,
    }
  }
  const [eligible, existingDraw] = await Promise.all([
    approvedMember(database, accountId),
    drawForAccount(database, accountId),
  ])
  return {
    campaign: currentCampaign,
    eligible,
    phase: phaseOf(currentCampaign, now),
    draw: visibleDraw(existingDraw),
  }
}

export async function drawRecruitmentLottery(
  database: IdentityDatabase,
  accountId: string,
  now: number,
): Promise<RecruitmentLotteryDrawResult> {
  const state = await recruitmentLotteryState(database, accountId, now)
  if (state.draw) return { ok: true }
  if (!state.campaign) return { ok: false, error: '抽奖暂未配置。' }
  if (!state.eligible) return { ok: false, error: '仅限已审核通过的社团成员参与。' }
  if (state.phase === 'upcoming') return { ok: false, error: '抽奖尚未开始。' }
  if (state.phase === 'closed') return { ok: false, error: '本次抽奖已经结束。' }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await database
      .prepare(
        `INSERT OR IGNORE INTO recruitment_lottery_draw
          (id, campaign_id, account_id, ticket_id, receipt_code, drawn_at)
         SELECT ?, campaign.id, ?, ticket.id,
                CASE WHEN prize.requires_claim = 1 THEN ? ELSE NULL END, ?
         FROM recruitment_lottery_campaign AS campaign
         JOIN recruitment_lottery_ticket AS ticket ON ticket.campaign_id = campaign.id
         JOIN recruitment_lottery_prize AS prize ON prize.id = ticket.prize_id
         WHERE campaign.id = ?
           AND campaign.starts_at <= ? AND campaign.ends_at > ?
           AND EXISTS (
             SELECT 1 FROM identity_membership
             WHERE account_id = ? AND status = 'approved'
           )
           AND NOT EXISTS (
             SELECT 1 FROM recruitment_lottery_draw
             WHERE campaign_id = campaign.id AND account_id = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM recruitment_lottery_draw WHERE ticket_id = ticket.id
           )
         ORDER BY RANDOM() LIMIT 1`,
      )
      .bind(
        createOpaqueToken(),
        accountId,
        receiptCode(),
        now,
        RECRUITMENT_LOTTERY_CAMPAIGN_ID,
        now,
        now,
        accountId,
        accountId,
      )
      .run()
    if (await drawForAccount(database, accountId)) return { ok: true }
  }

  return { ok: false, error: '奖券刚刚被抽完，请刷新页面确认。' }
}

export async function claimRecruitmentLotteryPrize(
  database: IdentityDatabase,
  claimedByAccountId: string,
  suppliedCode: string,
  now: number,
): Promise<{ ok: true; prizeTitle: string } | { ok: false; error: string }> {
  const code = normalizeReceiptCode(suppliedCode)
  if (!code) return { ok: false, error: '请输入结果页显示的 10 位核销码。' }
  const current = await database
    .prepare(
      `SELECT prize.title AS prizeTitle, prize.requires_claim AS requiresClaim,
              draw.claimed_at AS claimedAt
       FROM recruitment_lottery_draw AS draw
       JOIN recruitment_lottery_ticket AS ticket ON ticket.id = draw.ticket_id
       JOIN recruitment_lottery_prize AS prize ON prize.id = ticket.prize_id
       WHERE draw.receipt_code = ?`,
    )
    .bind(code)
    .first<{ prizeTitle: string; requiresClaim: number; claimedAt: number | null }>()
  if (!current || current.requiresClaim !== 1)
    return { ok: false, error: '没有找到可领取的中奖结果。' }
  if (current.claimedAt !== null) return { ok: false, error: '这份奖品已经核销过。' }

  await database
    .prepare(
      `UPDATE recruitment_lottery_draw
       SET claimed_at = ?, claimed_by_account_id = ?
       WHERE receipt_code = ? AND claimed_at IS NULL`,
    )
    .bind(now, claimedByAccountId, code)
    .run()

  const claimed = await database
    .prepare(
      `SELECT claimed_at AS claimedAt, claimed_by_account_id AS claimedByAccountId
       FROM recruitment_lottery_draw WHERE receipt_code = ?`,
    )
    .bind(code)
    .first<{ claimedAt: number | null; claimedByAccountId: string | null }>()
  if (claimed?.claimedAt === now && claimed.claimedByAccountId === claimedByAccountId) {
    return { ok: true, prizeTitle: current.prizeTitle }
  }
  return { ok: false, error: '这份奖品刚刚被其他工作人员核销。' }
}
