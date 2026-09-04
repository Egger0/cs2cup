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
  qqGroupMessage,
  qqWebhookVerification,
  syncQqGroupCommandPanel,
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
assert.deepEqual(qqCommand('/绑定 abcd2345'), { kind: 'bind', code: 'ABCD2345' })
assert.equal(qqCommand('绑定 ABCD2345'), null)
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
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), init })
  if (String(url).endsWith('/getAppAccessToken')) {
    return new Response(JSON.stringify({ access_token: 'token', expires_in: 300 }))
  }
  if (String(url).includes('/panels?scope=group')) return new Response(JSON.stringify({ records: panels }))
  return new Response(JSON.stringify({ panel_id: 'panel-1' }))
}
try {
  assert.equal(
    await syncQqGroupCommandPanel({ appId: 'app', appSecret: 'secret', allowedGroupOpenId: 'group-1' }),
    'created',
  )
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), {
    scope: 'group',
    target_type: 'specific',
    group_openids: ['group-1'],
    panel: {
      items: [
        { type: 'command', name: '签到', desc: '完成今天的社团打卡' },
        { type: 'command', name: '签到排行', desc: '查看连续签到排名' },
        { type: 'command', name: '最近赛事', desc: '查看当前赛事安排' },
      ],
      remark: 'nbt-qq-group-commands',
    },
  })
  panels = [{ panel_id: 'panel-1', panel: { remark: 'nbt-qq-group-commands' } }]
  assert.equal(
    await syncQqGroupCommandPanel({ appId: 'app', appSecret: 'secret', allowedGroupOpenId: 'group-1' }),
    'updated',
  )
  assert.match(requests.at(-1).url, /\/panels\/panel-1$/)
} finally {
  globalThis.fetch = originalFetch
}

console.log('QQ bot command tests passed')
