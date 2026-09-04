import assert from 'node:assert/strict'

import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'

import { captureBrowserRuntimeErrors } from './browser-runtime-errors.mjs'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'
import { verifyRecoveryPasswordCycle } from './identity-browser-recovery.mjs'
import { BROWSER_USERS } from './identity-browser-users.mjs'

const BASE = resolveE2EBaseUrl()
const TEAM = Object.freeze({ name: '浏览器验收战队', tag: 'BRWSR' })

async function assertAccessible(page, label) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  if (violations.length) {
    const detail = violations
      .flatMap(item => item.nodes.map(node => `${item.id}: ${node.target.join(' ')}`))
      .join(', ')
    throw new Error(`${label} accessibility violations: ${detail}`)
  }
}

async function passwordLogin(page, user, redirectKey = 'account') {
  await page.goto(`${BASE}/login?redirectKey=${redirectKey}`, { waitUntil: 'networkidle' })
  await page.getByLabel('用户名').fill(user.username)
  await page.getByLabel('密码').fill(user.password)
  await Promise.all([
    page.waitForURL(url => url.pathname !== '/login'),
    page.getByRole('button', { name: '使用账号密码登录' }).click(),
  ])
}

async function signOut(page) {
  await Promise.all([
    page.waitForURL(url => url.pathname === '/'),
    page.getByRole('button', { name: '退出', exact: true }).click(),
  ])
}

async function fillRegistration(page) {
  const values = {
    name: TEAM.name,
    tag: TEAM.tag,
    captain: '浏览器队长',
    contact: 'browser-captain@example.test',
    dept: '计算机与数据工程学院',
    player1: 'Browser-01',
    player2: 'Browser-02',
    player3: 'Browser-03',
    player4: 'Browser-04',
    player5: 'Browser-05',
    player6: 'Browser-06',
    note: '自动化浏览器验收',
  }
  for (const [name, value] of Object.entries(values))
    await page.locator(`[name="${name}"]`).fill(value)
}

function reviewCard(page, displayName) {
  return page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: displayName, exact: true }) })
}

let contextSequence = 0

async function claimAndReview(page, displayName, decision, reason) {
  const card = reviewCard(page, displayName)
  await card.getByRole('button', { name: '领取并开始审核' }).click()
  await card.getByRole('button', { name: '确认审核决定' }).waitFor()
  await card.getByLabel('决定').selectOption(decision)
  await card.getByLabel('给申请者的说明').fill(reason)
  await card.getByRole('button', { name: '确认审核决定' }).click()
  await card.waitFor({ state: 'detached' })
}

async function context(browser, runtimeOptions) {
  contextSequence += 1
  const value = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'x-real-ip': `198.51.100.${100 + contextSequence}` },
  })
  const page = await value.newPage()
  return {
    value,
    page,
    guard: await installLoopbackRequestGuard(value),
    runtimeErrors: captureBrowserRuntimeErrors(page, runtimeOptions),
  }
}

const browser = await chromium.launch()
const applicant = await context(browser, { allowedConsoleErrors: ['status of 401 (Unauthorized)'] })
const reviewer = await context(browser)
const rejectee = await context(browser)
const owner = await context(browser)
let secondary = null

try {
  await passwordLogin(applicant.page, BROWSER_USERS.applicant)
  await applicant.page.getByRole('heading', { name: '等待审核', exact: true }).waitFor()
  await assertAccessible(applicant.page, 'pending account')

  await applicant.page.goto(`${BASE}/tournaments/2026-nlc/register`)
  await fillRegistration(applicant.page)
  assert.equal(
    await applicant.page.getByRole('button', { name: '通过资格审核后提交' }).isDisabled(),
    true,
  )
  await applicant.page.getByRole('button', { name: '保存草稿' }).click()
  await applicant.page.getByText('草稿已保存，可从“我的赛事”继续填写。').waitFor()
  await applicant.page.reload()
  assert.equal(await applicant.page.locator('[name="name"]').inputValue(), TEAM.name)

  await applicant.page.goto(`${BASE}/account`)
  await applicant.page.getByRole('button', { name: '提醒审核员' }).click()
  await applicant.page.getByText(/已发送提醒，下次可在/).waitFor()
  await signOut(applicant.page)
  console.log('PASS  applicant draft, pending state, reminder cooldown and sign-out')

  await passwordLogin(reviewer.page, BROWSER_USERS.reviewer, 'workspaces')
  await reviewer.page.waitForURL(url => url.pathname === '/admin/identity')
  await reviewer.page.getByRole('heading', { name: '成员资格审核', exact: true }).waitFor()
  await assertAccessible(reviewer.page, 'membership review queue')
  await claimAndReview(
    reviewer.page,
    BROWSER_USERS.applicant.displayName,
    'changes_requested',
    '请补充可核验的院系信息。',
  )
  await claimAndReview(
    reviewer.page,
    BROWSER_USERS.rejectee.displayName,
    'rejected',
    '当前资料无法确认参与资格。',
  )
  await passwordLogin(rejectee.page, BROWSER_USERS.rejectee)
  await rejectee.page.getByRole('heading', { name: '未通过', exact: true }).waitFor()
  await signOut(rejectee.page)

  await passwordLogin(applicant.page, BROWSER_USERS.applicant)
  await applicant.page.getByRole('heading', { name: '需要补充资料', exact: true }).waitFor()
  await applicant.page.getByLabel('补充说明（可选）').fill('已补充院系与参与信息。')
  await applicant.page.getByRole('button', { name: '更新并重新提交' }).click()
  await applicant.page.getByRole('heading', { name: '等待审核', exact: true }).waitFor()

  await reviewer.page.goto(`${BASE}/admin/identity`)
  const returningCard = reviewCard(reviewer.page, BROWSER_USERS.applicant.displayName)
  await returningCard.getByText(/审核轨迹 · 1 条/).click()
  await returningCard.getByText('请补充可核验的院系信息。').waitFor()
  await returningCard.getByRole('button', { name: '领取并开始审核' }).click()
  await returningCard.getByRole('button', { name: '确认审核决定' }).waitFor()
  await returningCard
    .getByLabel('接手审核员')
    .selectOption({ label: BROWSER_USERS.owner.displayName })
  await returningCard.getByLabel('转交原因').fill('由平台负责人完成最终核验。')
  await returningCard.getByRole('button', { name: '发起转交' }).click()
  await returningCard.getByText(/审核轨迹 · 2 条/).waitFor()

  await passwordLogin(owner.page, BROWSER_USERS.owner, 'workspaces')
  await owner.page.goto(`${BASE}/admin/identity`)
  const transferredCard = reviewCard(owner.page, BROWSER_USERS.applicant.displayName)
  await transferredCard.getByRole('button', { name: '接受转交' }).click()
  await transferredCard.getByRole('button', { name: '确认审核决定' }).waitFor()
  await transferredCard.getByLabel('给申请者的说明').fill('申请资料已核验，通过。')
  await transferredCard.getByRole('button', { name: '确认审核决定' }).click()
  await transferredCard.waitFor({ state: 'detached' })
  await applicant.page.reload()
  await applicant.page.getByRole('heading', { name: '已通过', exact: true }).waitFor()
  console.log('PASS  reviewer decisions, history, resubmission and accepted transfer')

  await applicant.page.goto(`${BASE}/tournaments/2026-nlc/register`)
  assert.equal(await applicant.page.locator('[name="name"]').inputValue(), TEAM.name)
  await applicant.page.getByRole('button', { name: '提交报名', exact: true }).click()
  await applicant.page.getByRole('heading', { name: '报名已提交', exact: true }).waitFor()
  const managePath = await applicant.page
    .getByRole('link', { name: /管理这份报名/ })
    .getAttribute('href')
  assert.match(managePath ?? '', /^\/me\/registrations\/[1-9][0-9]*$/)
  await applicant.page.goto(BASE + managePath)
  await assertAccessible(applicant.page, 'registration manager')
  await applicant.page.getByLabel('邀请协作者').fill(BROWSER_USERS.reviewer.username)
  await applicant.page.getByRole('button', { name: '发送邀请' }).click()
  await applicant.page.getByText('协作者邀请已发出。').waitFor()

  await reviewer.page.goto(`${BASE}/me`)
  await reviewer.page.getByRole('heading', { name: '报名协作邀请', exact: true }).waitFor()
  await reviewer.page.getByRole('button', { name: '接受邀请' }).click()
  await reviewer.page.getByText(TEAM.name).first().waitFor()

  await applicant.page.reload()
  await applicant.page.getByText(BROWSER_USERS.reviewer.displayName).waitFor()
  await applicant.page.getByLabel('转让所有权').fill(BROWSER_USERS.owner.username)
  applicant.page.once('dialog', dialog => dialog.accept())
  await applicant.page.getByRole('button', { name: '发起转让' }).click()
  await applicant.page.getByText('所有权转让邀请已发出。').waitFor()

  await owner.page.goto(`${BASE}/me`)
  owner.page.once('dialog', dialog => dialog.accept())
  await owner.page.getByRole('button', { name: '接受邀请' }).click()
  await owner.page.getByText(TEAM.name).first().waitFor()
  await applicant.page.reload()
  await applicant.page.getByRole('heading', { name: '你是协作者', exact: true }).waitFor()
  console.log('PASS  account-owned registration, collaboration and ownership transfer')

  await owner.page.goto(`${BASE}/admin/identity`)
  const roster = owner.page
    .locator('section')
    .filter({ has: owner.page.getByRole('heading', { name: '有效成员资格', exact: true }) })
  const membershipRow = roster
    .locator('article')
    .filter({ hasText: BROWSER_USERS.applicant.displayName })
  await membershipRow.getByRole('button', { name: '暂停资格' }).click()
  await membershipRow
    .getByLabel(`变更 ${BROWSER_USERS.applicant.displayName} 成员资格的原因`)
    .fill('等待补充年度资格确认')
  await membershipRow.getByRole('button', { name: '确认暂停' }).click()
  await membershipRow.getByText('资格已暂停').waitFor()
  await applicant.page.goto(`${BASE}/account`)
  await applicant.page.getByRole('heading', { name: '资格已暂停', exact: true }).waitFor()
  await membershipRow.getByRole('button', { name: '恢复资格' }).click()
  await membershipRow
    .getByLabel(`变更 ${BROWSER_USERS.applicant.displayName} 成员资格的原因`)
    .fill('年度资格已经确认')
  await membershipRow.getByRole('button', { name: '确认恢复' }).click()
  await membershipRow.getByText('资格有效').waitFor()
  await applicant.page.reload()
  await applicant.page.getByRole('heading', { name: '已通过', exact: true }).waitFor()

  const access = owner.page
    .locator('section')
    .filter({ has: owner.page.getByRole('heading', { name: '人员与权限', exact: true }) })
  await access.getByLabel('账号用户名').fill(BROWSER_USERS.rejectee.username)
  await access.getByLabel('角色').selectOption('check_in_operator')
  await access.getByLabel('赛事').selectOption({ index: 1 })
  await access.getByLabel('授权原因').fill('浏览器权限闭环验收')
  await access.locator('form').first().getByRole('button').click()
  const roleRow = access.locator('article').filter({ hasText: BROWSER_USERS.rejectee.displayName })
  await roleRow.waitFor()
  await passwordLogin(rejectee.page, BROWSER_USERS.rejectee, 'workspaces')
  await rejectee.page.getByRole('heading', { name: '我的工作区', exact: true }).waitFor()
  await rejectee.page.getByRole('heading', { name: '2026 NLC 校园杯', exact: true }).waitFor()
  await assertAccessible(rejectee.page, 'tournament role workspace')
  await rejectee.page.getByRole('link', { name: '打开签到台' }).click()
  await rejectee.page.getByRole('heading', { name: '现场签到', exact: true }).waitFor()
  await assertAccessible(rejectee.page, 'tournament check-in desk')
  await signOut(rejectee.page)
  await roleRow.getByRole('button', { name: '撤销' }).click()
  await roleRow
    .getByLabel(`撤销 ${BROWSER_USERS.rejectee.displayName} 的原因`)
    .fill('浏览器验收完成')
  await roleRow.getByRole('button', { name: '确认撤销' }).click()
  await roleRow.waitFor({ state: 'detached' })
  await owner.page.getByRole('heading', { name: '操作记录', exact: true }).waitFor()
  console.log('PASS  membership suspension, scoped roles and audit visibility')

  const cdp = await applicant.value.newCDPSession(applicant.page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  await applicant.page.goto(`${BASE}/account/security`)
  await applicant.page.getByLabel('设备名称（可选）').fill('浏览器虚拟设备')
  await applicant.page.getByRole('button', { name: '添加 Passkey' }).click()
  await applicant.page.getByText('浏览器虚拟设备').waitFor()
  const recovery = applicant.page.locator('section').filter({
    has: applicant.page.getByRole('heading', { name: '账号的离线退路', exact: true }),
  })
  await recovery.getByRole('button', { name: '生成恢复码' }).click()
  const recoveryCode = (await recovery.locator('ol li').first().textContent())?.trim() ?? ''
  assert.match(recoveryCode, /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/)
  await assertAccessible(applicant.page, 'account security')

  secondary = await context(browser)
  await passwordLogin(secondary.page, BROWSER_USERS.applicant)
  await applicant.page.reload()
  const sessions = applicant.page
    .locator('section')
    .filter({ has: applicant.page.getByRole('heading', { name: '设备与会话', exact: true }) })
  await sessions.getByText(/2 个有效状态/).waitFor()
  await sessions.getByRole('button', { name: '退出所有其他设备' }).click()
  await sessions.getByRole('button', { name: /确认退出其他/ }).click()
  await sessions.getByText('1 个有效状态').waitFor()
  secondary.guard.assertSafe()
  secondary.runtimeErrors.assertClean('secondary identity session')
  await secondary.value.close()
  secondary = null

  await signOut(applicant.page)
  await applicant.page.goto(`${BASE}/login`)
  await applicant.page.getByRole('button', { name: '使用通行密钥登录' }).click()
  await applicant.page.waitForURL(url => url.pathname === '/account')
  await applicant.page.getByRole('heading', { name: BROWSER_USERS.applicant.displayName }).waitFor()
  await signOut(applicant.page)

  await verifyRecoveryPasswordCycle({
    browser,
    page: applicant.page,
    base: BASE,
    user: BROWSER_USERS.applicant,
    recoveryCode,
    assertAccessible,
  })
  for (const item of [applicant, reviewer, rejectee, owner]) {
    item.runtimeErrors.assertClean('identity browser')
  }
  console.log('PASS  Passkey, recovery code, password rotation and session security flows')
} finally {
  if (secondary) {
    secondary.guard.assertSafe()
    await secondary.value.close()
  }
  for (const item of [applicant, reviewer, rejectee, owner]) {
    item.guard.assertSafe()
    await item.value.close()
  }
  await browser.close()
}
