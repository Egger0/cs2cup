import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const {
  qqBotConfig,
  qqCommand,
  qqGroupMemberAdd,
  qqGroupMessage,
  qqWebhookVerification,
  syncQqGroupCommandPanel,
  sendQqGroupMessage,
  verifyQqWebhookSignature,
} = await import('../lib/qq-bot.ts')

assert.deepEqual(qqBotConfig({ QQ_BOT_APP_ID: 'app', QQ_BOT_APP_SECRET: 'secret' }), {
  appId: 'app',
  appSecret: 'secret',
  allowedGroupOpenId: null,
})
assert.deepEqual(
  qqWebhookVerification({ d: { plain_token: 'token', event_ts: 1_725_442_341 } }, 'test-secret'),
  qqWebhookVerification({ d: { plain_token: 'token', event_ts: '1725442341' } }, 'test-secret'),
)

assert.deepEqual(qqCommand(' <@!robot> 签到 '), { kind: 'check_in' })
assert.deepEqual(qqCommand('签到排行'), { kind: 'leaderboard' })
assert.deepEqual(qqCommand('最近赛事'), { kind: 'current_tournament' })
assert.deepEqual(qqCommand(' <@!robot> /签到 '), { kind: 'check_in' })
assert.deepEqual(qqCommand('/签到排行'), { kind: 'leaderboard' })
assert.deepEqual(qqCommand('/最近赛事'), { kind: 'current_tournament' })
assert.deepEqual(qqCommand('/绑定 Reviewer.User'), { kind: 'bind', username: 'Reviewer.User' })
assert.deepEqual(qqCommand('/解绑'), { kind: 'unbind' })
assert.equal(qqCommand('绑定 reviewer.user'), null)
assert.equal(qqCommand('/绑定'), null)
assert.equal(qqCommand('签到啊'), null)
assert.deepEqual(
  qqGroupMessage({
    id: 'event-1',
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: {
      id: 'message-1',
      group_openid: 'group-1',
      content: '签到',
      author: { member_openid: 'member-1' },
    },
  }),
  {
    eventId: 'event-1',
    messageId: 'message-1',
    groupOpenId: 'group-1',
    memberOpenId: 'member-1',
    content: '签到',
  },
)
assert.equal(qqGroupMessage({ t: 'GROUP_MESSAGE_CREATE', d: {} }), null)
assert.deepEqual(
  qqGroupMemberAdd({
    id: 'event-2',
    t: 'GROUP_MEMBER_ADD',
    d: {
      timestamp: 1_784_276_757,
      group_openid: 'group-1',
      member_openid: 'member-2',
    },
  }),
  {
    eventId: 'event-2',
    groupOpenId: 'group-1',
    memberOpenId: 'member-2',
  },
)
assert.equal(
  qqGroupMemberAdd({
    t: 'GROUP_MEMBER_ADD',
    d: { timestamp: 1_784_276_757, group_openid: 'group-1', member_openid: 'member-2' },
  })?.eventId,
  'GROUP_MEMBER_ADD:group-1:member-2:1784276757',
)
assert.deepEqual(
  qqGroupMemberAdd({
    id: 'outer-event-id',
    event_type: 'GROUP_MEMBER_ADD',
    timestamp: 1_784_276_757,
    group_openid: 'group-1',
    user_openid: 'member-2',
  }),
  {
    eventId: 'outer-event-id',
    groupOpenId: 'group-1',
    memberOpenId: 'member-2',
  },
)
assert.equal(qqGroupMemberAdd({ t: 'GROUP_MEMBER_REMOVE', d: {} }), null)
assert.equal(
  verifyQqWebhookSignature(
    new Headers({
      'x-signature-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-signature-ed25519': '0'.repeat(128),
    }),
    '{}',
    'test-secret',
  ),
  false,
)

const originalFetch = globalThis.fetch
const requests = []
let panels = []
let panelDetail = { group_openids: [] }
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), init })
  if (String(url).endsWith('/getAppAccessToken')) {
    return new Response(JSON.stringify({ access_token: 'token', expires_in: 300 }))
  }
  if (String(url).includes('/panels?scope=group'))
    return new Response(JSON.stringify({ records: panels }))
  if (String(url).endsWith('/panels/panel-1') && (!init.method || init.method === 'GET'))
    return new Response(JSON.stringify(panelDetail))
  return new Response(JSON.stringify({ panel_id: 'panel-1' }))
}
try {
  assert.equal(
    await syncQqGroupCommandPanel({
      appId: 'app',
      appSecret: 'secret',
      allowedGroupOpenId: 'group-1',
    }),
    'created',
  )
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), {
    scope: 'group',
    target_type: 'specific',
    group_openids: ['group-1'],
    panel: {
      items: [
        { type: 'command', name: '/签到', desc: '完成今天的社团打卡' },
        { type: 'command', name: '/签到排行', desc: '查看连续签到排名' },
        { type: 'command', name: '/最近赛事', desc: '查看当前赛事安排' },
        { type: 'command', name: '/绑定 用户名', desc: '绑定网站用户名' },
        { type: 'command', name: '/解绑', desc: '解除当前 QQ 绑定' },
      ],
      remark: 'nbt-qq-group-commands',
    },
  })
  panels = [{ panel_id: 'panel-1', panel: { remark: 'nbt-qq-group-commands' } }]
  panelDetail = { group_openids: ['old-group'] }
  assert.equal(
    await syncQqGroupCommandPanel({
      appId: 'app',
      appSecret: 'secret',
      allowedGroupOpenId: 'group-1',
    }),
    'updated',
  )
  assert.ok(
    requests.some(
      request =>
        request.url.endsWith('/panels/panel-1/target') &&
        request.init.body === JSON.stringify({ op: 'add', group_openids: ['group-1'] }),
    ),
  )
  assert.ok(
    requests.some(
      request =>
        request.url.endsWith('/panels/panel-1/target') &&
        request.init.body === JSON.stringify({ op: 'del', group_openids: ['old-group'] }),
    ),
  )
  await sendQqGroupMessage(
    { appId: 'app', appSecret: 'secret' },
    'group-1',
    '早安，宁理电竞社！今天记得签到哦',
  )
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), {
    content: '早安，宁理电竞社！今天记得签到哦',
    msg_type: 0,
  })
} finally {
  globalThis.fetch = originalFetch
}

console.log('QQ bot command tests passed')
