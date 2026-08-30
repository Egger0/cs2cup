import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'cs2cup-d1-test-'))
const common = ['d1', 'execute', 'cs2cup-preview-db', '--local', '--persist-to', root]

async function wrangler(args) {
  return run(process.execPath, [join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args], {
    cwd: process.cwd(), windowsHide: true,
  })
}

try {
  await wrangler(['d1', 'migrations', 'apply', 'cs2cup-preview-db', '--local', '--persist-to', root])
  const { stdout } = await wrangler([...common, '--command', [
    "INSERT INTO game (id,slug,name) VALUES (1,'cs2','CS2');",
    "INSERT INTO tournament (id,slug,title,game_id,season,edition,status,team_cap) VALUES (1,'draft','Draft',1,'2026',1,'draft',4),(2,'live','Live',1,'2026',2,'registration',4);",
    "INSERT INTO match (id,tournament_id,round,slot,round_label) VALUES (1,1,0,0,'Draft'),(2,2,0,0,'Live');",
    "INSERT INTO registration_attempt (fingerprint,tournament_id) VALUES ('test',2),('test',2),('test',2);",
    "INSERT INTO guestbook_message (id,name,body,status) VALUES (1,'公开访客','公开留言','published'),(2,'待审核访客','待审核留言','pending');",
    "INSERT INTO guestbook_attempt (fingerprint) VALUES ('guestbook-test'),('guestbook-test'),('guestbook-test'),('guestbook-test'),('guestbook-test');",
    "SELECT (SELECT COUNT(*) FROM tournament_public) AS visible_tournaments, (SELECT COUNT(*) FROM match_public) AS visible_matches, (SELECT COUNT(*) FROM guestbook_public) AS visible_guestbook_messages;",
  ].join(' ')])
  if (!stdout.includes('"visible_tournaments": 1') || !stdout.includes('"visible_matches": 1') || !stdout.includes('"visible_guestbook_messages": 1')) {
    throw new Error('public D1 views exposed non-public records')
  }

  try {
    await wrangler([...common, '--command', "INSERT INTO guestbook_attempt (fingerprint) VALUES ('guestbook-test');"])
    throw new Error('guestbook rate-limit trigger did not reject the sixth attempt')
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
    if (!output.includes('留言太频繁')) throw error
  }

  try {
    await wrangler([...common, '--command', "INSERT INTO registration_attempt (fingerprint,tournament_id) VALUES ('test',2);"])
    throw new Error('registration rate-limit trigger did not reject the fourth attempt')
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
    if (!output.includes('提交太频繁')) throw error
  }

  console.log('Cloudflare D1 schema tests passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
