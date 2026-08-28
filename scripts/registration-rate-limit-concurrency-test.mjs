import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

function runPsql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'db',
        'psql',
        '-U',
        'postgres',
        '-d',
        'cs2cup',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
        '-q',
        '-f',
        '-',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', chunk => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`psql exited with ${code}: ${stderr.trim()}`))
    })
    child.stdin.end(sql)
  })
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 16)
const slug = `registration-concurrency-${suffix}`
const fingerprint = `v1:${'d'.repeat(64)}`

await runPsql(`
  with inserted_game as (
    insert into public.game (slug, name, sort_order, active)
    values (${sqlLiteral(slug)}, 'Registration concurrency test game', 999, true)
    returning id
  )
  insert into public.tournament (
    slug, title, game_id, season, edition, status, team_cap
  )
  select
    ${sqlLiteral(slug)},
    'Registration concurrency test',
    id,
    '2099',
    1,
    'registration',
    16
  from inserted_game;
`)

try {
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => {
      const payload = JSON.stringify({
        slug,
        name: `Concurrent Team ${index}`,
        tag: `C${index}`,
        captain: 'Test Captain',
        contact: 'test-contact',
        players: [],
      })

      return runPsql(`
        select public.submit_team_rate_limited(
          ${sqlLiteral(fingerprint)},
          ${sqlLiteral(payload)}::jsonb
        )::text;
      `).then(output => JSON.parse(output))
    }),
  )

  const accepted = results.filter(result => result.ok === true)
  const rateLimited = results.filter(result => result.code === 'RATE_LIMITED')
  assert.equal(accepted.length, 3, JSON.stringify(results))
  assert.equal(rateLimited.length, 5, JSON.stringify(results))

  const ledgerCount = Number(
    await runPsql(`
      select count(*)
      from public.registration_attempt
      where fingerprint = ${sqlLiteral(fingerprint)};
    `),
  )
  assert.equal(ledgerCount, 3)

  console.log('registration rate-limit concurrency test passed')
} finally {
  await runPsql(`
    delete from public.tournament where slug = ${sqlLiteral(slug)};
    delete from public.game where slug = ${sqlLiteral(slug)};
  `)
}
