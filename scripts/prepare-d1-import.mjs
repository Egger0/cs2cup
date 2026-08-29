import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const TABLE_COLUMNS = {
  site_setting: ['id', 'club_name', 'club_name_en', 'school', 'logo_url', 'contact_qq', 'contact_wechat', 'footer_copy'],
  game: ['id', 'slug', 'name', 'name_en', 'accent_color', 'tagline', 'description', 'format_note', 'sort_order', 'active'],
  tournament: ['id', 'slug', 'title', 'game_id', 'season', 'edition', 'status', 'format', 'team_cap', 'reg_deadline', 'starts_at', 'accent_color', 'map_pool', 'rules', 'faqs', 'hero_eyebrow', 'hero_top', 'hero_bottom', 'lede', 'champion_name', 'champion_note', 'created_at'],
  team: ['id', 'tournament_id', 'name', 'tag', 'captain', 'contact', 'dept', 'note', 'status', 'seed', 'created_at'],
  player: ['id', 'team_id', 'nickname', 'role', 'is_substitute', 'sort_order'],
  match: ['id', 'tournament_id', 'round', 'slot', 'round_label', 'best_of', 'team_a_id', 'team_b_id', 'source_match_a_id', 'source_match_b_id', 'score_a', 'score_b', 'winner_team_id', 'scheduled_at'],
  match_map: ['id', 'match_id', 'pick_order', 'map_name', 'action', 'chosen_by', 'score_a', 'score_b', 'played'],
  photo: ['id', 'tournament_id', 'storage_key', 'width', 'height', 'blur_data_url', 'caption', 'sort_order', 'created_at'],
  club_member: ['id', 'name', 'role', 'handle', 'intro', 'sort_order'],
  post: ['id', 'game_id', 'slug', 'title', 'summary', 'body', 'published_at', 'pinned'],
  registration_attempt: ['id', 'fingerprint', 'tournament_id', 'accepted', 'created_at'],
}

function literal(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('non-finite number in export'); return String(value) }
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return `'${text.replaceAll("'", "''")}'`
}

async function main() {
  const source = resolve(process.argv[2] || 'migration-output/cloudbase-export')
  const output = resolve(process.argv[3] || join(source, 'd1-import.sql'))
  const statements = ['PRAGMA foreign_keys = ON;', 'BEGIN TRANSACTION;']
  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    const rows = JSON.parse(await readFile(join(source, `${table}.json`), 'utf8'))
    if (!Array.isArray(rows)) throw new Error(`${table}.json must contain an array`)
    for (const row of rows) statements.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(column => literal(row[column])).join(', ')});`)
  }
  statements.push('COMMIT;')
  await writeFile(output, `${statements.join('\n')}\n`, { mode: 0o600 })
  console.log(`prepared ${output}`)
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'D1 import preparation failed'); process.exit(1) })
