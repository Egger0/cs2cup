import assert from 'node:assert/strict'

const { qqWelcomeMessage, sendQqMorning, sendQqWelcome, shanghaiDate } = await import('../lib/qq-automation.ts')
const { createMigratedDatabase } = await import('./sqlite-fixture.mjs')

const sqliteDatabase = await createMigratedDatabase()
const database = {
  prepare(query) {
    const statement = sqliteDatabase.prepare(query)
    return {
      bind(...values) {
        return {
          async first() {
            return statement.get(...values) ?? null
          },
          async run() {
            return statement.run(...values)
          },
        }
      },
    }
  },
}
const requests = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), init })
  if (String(url).endsWith('/getAppAccessToken')) {
    return new Response(JSON.stringify({ access_token: 'token', expires_in: 300 }))
  }
  return new Response(JSON.stringify({ id: 'message-1' }))
}

const config = { appId: 'app', appSecret: 'secret' }
const groupOpenId = 'official-group-openid'
const at = (day, hour) => Date.UTC(2026, 8, day, hour - 8)

try {
  assert.equal(shanghaiDate(at(5, 8)), '2026-09-05')
  assert.equal(shanghaiDate(at(5, 8) - 1), '2026-09-05')
  assert.equal(shanghaiDate(at(6, 0) - 1), '2026-09-05')
  assert.equal(shanghaiDate(at(6, 0)), '2026-09-06')

  assert.equal(await sendQqWelcome(config, database, groupOpenId, 'member-event-1', 'member-1'), true)
  assert.equal(await sendQqWelcome(config, database, groupOpenId, 'member-event-1', 'member-1'), false)
  assert.equal(await sendQqMorning(config, database, groupOpenId, at(5, 9)), true)
  assert.equal(await sendQqMorning(config, database, groupOpenId, at(5, 23)), false)
  assert.equal(await sendQqMorning(config, database, groupOpenId, at(6, 9)), true)

  const sentBodies = requests
    .filter(request => String(request.url).includes('/groups/'))
    .map(request => JSON.parse(request.init.body))
  assert.deepEqual(sentBodies, [
    {
      content: qqWelcomeMessage('member-1'),
      msg_type: 0,
      event_id: 'member-event-1',
    },
    { content: '早安，宁理电竞社！今天记得签到哦', msg_type: 0 },
    { content: '早安，宁理电竞社！今天记得签到哦', msg_type: 0 },
  ])
} finally {
  globalThis.fetch = originalFetch
  sqliteDatabase.close()
}

console.log('QQ automation tests passed')
