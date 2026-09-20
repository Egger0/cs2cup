import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/headers') {
      return {
        url: dataModule(`export async function cookies() { throw new Error('unexpected') }`),
        shortCircuit: true,
      }
    }
    if (specifier === '../cloudflare-bindings.ts') {
      return {
        url: dataModule(`export function cloudflareBindings() { throw new Error('unexpected') }`),
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  claimRecruitmentLotteryPrize,
  drawRecruitmentLottery,
  RECRUITMENT_LOTTERY_CAMPAIGN_ID,
  recruitmentLotteryState,
} = await import('../lib/recruitment-lottery.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, opaque, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')
const { approveMembership } = await import('./membership-approval-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture

try {
  const campaign = database
    .prepare(
      'SELECT starts_at, ends_at, manual_state FROM recruitment_lottery_campaign WHERE id = ?',
    )
    .get(RECRUITMENT_LOTTERY_CAMPAIGN_ID)
  assert.ok(campaign, 'the recruitment campaign must be seeded by its migration')
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM recruitment_lottery_ticket').get().count,
    120,
  )
  assert.equal(
    database.prepare('SELECT SUM(quantity) AS count FROM recruitment_lottery_prize').get().count,
    120,
  )
  assert.equal(
    database
      .prepare('SELECT quantity FROM recruitment_lottery_prize WHERE requires_claim = 0')
      .get().quantity,
    58,
  )

  const owner = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  const secondMember = await fixture.session(accountIds.platformOwner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.platformOwner,
  })
  const reviewer = await fixture.session(accountIds.reviewer, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.reviewer,
  })
  await approveMembership(db, owner.context, reviewer.context, now + 1)
  await approveMembership(db, secondMember.context, reviewer.context, now + 10)

  assert.equal(
    (await recruitmentLotteryState(db, accountIds.manager, campaign.starts_at)).eligible,
    false,
  )
  assert.equal(
    (await recruitmentLotteryState(db, accountIds.owner, campaign.starts_at - 1)).phase,
    'upcoming',
  )
  database
    .prepare("UPDATE recruitment_lottery_campaign SET manual_state = 'open' WHERE id = ?")
    .run(RECRUITMENT_LOTTERY_CAMPAIGN_ID)
  assert.equal(
    (await recruitmentLotteryState(db, accountIds.owner, campaign.starts_at - 1)).phase,
    'open',
  )
  assert.deepEqual(await drawRecruitmentLottery(db, accountIds.owner, campaign.starts_at - 1), {
    ok: true,
  })
  database
    .prepare("UPDATE recruitment_lottery_campaign SET manual_state = 'closed' WHERE id = ?")
    .run(RECRUITMENT_LOTTERY_CAMPAIGN_ID)
  assert.equal(
    (await recruitmentLotteryState(db, accountIds.owner, campaign.starts_at + 1)).phase,
    'closed',
  )
  assert.deepEqual(await drawRecruitmentLottery(db, accountIds.platformOwner, campaign.starts_at), {
    ok: false,
    error: '本次抽奖已经结束。',
  })
  database
    .prepare('UPDATE recruitment_lottery_campaign SET manual_state = NULL WHERE id = ?')
    .run(RECRUITMENT_LOTTERY_CAMPAIGN_ID)
  assert.deepEqual(await drawRecruitmentLottery(db, accountIds.manager, campaign.starts_at + 1), {
    ok: false,
    error: '仅限已审核通过的社团成员参与。',
  })

  assert.deepEqual(await drawRecruitmentLottery(db, accountIds.owner, campaign.starts_at + 1), {
    ok: true,
  })
  assert.deepEqual(await drawRecruitmentLottery(db, accountIds.owner, campaign.starts_at + 2), {
    ok: true,
  })
  assert.deepEqual(
    await drawRecruitmentLottery(db, accountIds.platformOwner, campaign.starts_at + 3),
    { ok: true },
  )
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM recruitment_lottery_draw').get().count,
    2,
  )

  const physicalTicket = database
    .prepare(
      `SELECT ticket.id FROM recruitment_lottery_ticket AS ticket
       JOIN recruitment_lottery_prize AS prize ON prize.id = ticket.prize_id
       WHERE prize.requires_claim = 1
         AND NOT EXISTS (SELECT 1 FROM recruitment_lottery_draw WHERE ticket_id = ticket.id)
       LIMIT 1`,
    )
    .get()
  database
    .prepare(
      `INSERT INTO recruitment_lottery_draw
        (id, campaign_id, account_id, ticket_id, receipt_code, drawn_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opaque('z'),
      RECRUITMENT_LOTTERY_CAMPAIGN_ID,
      accountIds.reviewer,
      physicalTicket.id,
      'A1B2C3D4E5',
      campaign.starts_at + 4,
    )
  const claimed = await claimRecruitmentLotteryPrize(
    db,
    accountIds.platformOwner,
    'A1B2C3D4E5',
    campaign.starts_at + 5,
  )
  assert.equal(claimed.ok, true)
  assert.deepEqual(
    await claimRecruitmentLotteryPrize(
      db,
      accountIds.platformOwner,
      'A1B2C3D4E5',
      campaign.starts_at + 6,
    ),
    { ok: false, error: '这份奖品已经核销过。' },
  )

  const lateComer = await fixture.session(accountIds.manager, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.manager,
  })
  await approveMembership(db, lateComer.context, reviewer.context, now + 20)
  database
    .prepare(
      `DELETE FROM recruitment_lottery_ticket
       WHERE NOT EXISTS (
         SELECT 1 FROM recruitment_lottery_draw
         WHERE ticket_id = recruitment_lottery_ticket.id
       )`,
    )
    .run()
  assert.deepEqual(await drawRecruitmentLottery(db, accountIds.manager, campaign.starts_at + 7), {
    ok: false,
    error: '奖券已经全部抽完了。',
  })

  console.log('recruitment lottery tests passed')
} finally {
  database.close()
}
