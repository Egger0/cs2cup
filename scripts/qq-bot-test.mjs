import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const { qqCommand, qqGroupMessage, verifyQqWebhookSignature } = await import('../lib/qq-bot.ts')

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

console.log('QQ bot command tests passed')
