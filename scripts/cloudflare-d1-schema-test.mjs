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
    "INSERT INTO guestbook_message (id,name,body,parent_id,status) VALUES (3,'公开回复','公开回复',1,'published'),(4,'待审核回复','待审核回复',1,'pending');",
    "INSERT INTO guestbook_attempt (fingerprint) VALUES ('guestbook-test'),('guestbook-test'),('guestbook-test'),('guestbook-test'),('guestbook-test');",
    "SELECT (SELECT COUNT(*) FROM tournament_public) AS visible_tournaments, (SELECT COUNT(*) FROM match_public) AS visible_matches, (SELECT COUNT(*) FROM guestbook_public) AS visible_guestbook_messages;",
  ].join(' ')])
  if (!stdout.includes('"visible_tournaments": 1') || !stdout.includes('"visible_matches": 1') || !stdout.includes('"visible_guestbook_messages": 2')) {
    throw new Error('public D1 views exposed non-public records')
  }

  for (const [label, sql] of [
    ['pending parent', "INSERT INTO guestbook_message (name,body,parent_id) VALUES ('访客','回复待审核留言',2);"],
    ['nested reply', "INSERT INTO guestbook_message (name,body,parent_id) VALUES ('访客','回复已有回复',3);"],
  ]) {
    try {
      await wrangler([...common, '--command', sql])
      throw new Error(`guestbook accepted a reply to ${label}`)
    } catch (error) {
      const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
      if (!output.includes('只能回复已公开留言')) throw error
    }
  }

  const { stdout: cascadeOutput } = await wrangler([...common, '--command', [
    "INSERT INTO guestbook_message (id,name,body,status) VALUES (5,'待删除访客','待删除留言','published');",
    "INSERT INTO guestbook_message (id,name,body,parent_id,status) VALUES (6,'待删除回复','待删除回复',5,'published');",
    'DELETE FROM guestbook_message WHERE id = 5;',
    'SELECT COUNT(*) AS cascade_replies FROM guestbook_message WHERE id = 6;',
  ].join(' ')])
  if (!cascadeOutput.includes('"cascade_replies": 0')) {
    throw new Error('deleting a guestbook message did not delete its replies')
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
