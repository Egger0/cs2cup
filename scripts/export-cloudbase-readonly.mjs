import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const TABLES = ['site_setting', 'game', 'tournament', 'team', 'player', 'match', 'match_map', 'photo', 'club_member', 'post', 'registration_attempt']
const PAGE_SIZE = 200

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function outputDirectory() {
  const argument = process.argv.find(value => value.startsWith('--output='))
  return resolve(argument?.slice('--output='.length) || 'migration-output/cloudbase-export')
}

function endpoint(baseUrl, table, offset) {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/${table}`)
  url.searchParams.set('select', '*')
  url.searchParams.set('order', 'id.asc')
  url.searchParams.set('limit', String(PAGE_SIZE))
  url.searchParams.set('offset', String(offset))
  return url
}

async function exportTable(baseUrl, key, table) {
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await fetch(endpoint(baseUrl, table, offset), {
      headers: { Authorization: `Bearer ${key}` }, cache: 'no-store',
    })
    if (!response.ok) throw new Error(`${table} export failed: HTTP ${response.status}`)
    const page = await response.json()
    if (!Array.isArray(page)) throw new Error(`${table} export returned a non-array response`)
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

function summary(table, rows, contents) {
  const ids = rows.map(row => row?.id).filter(Number.isSafeInteger)
  const photoKeys = table === 'photo' ? rows.filter(row => typeof row?.storage_key === 'string').length : 0
  return { table, rows: rows.length, idMin: ids.length ? Math.min(...ids) : null, idMax: ids.length ? Math.max(...ids) : null, sha256: createHash('sha256').update(contents).digest('hex'), photoKeys }
}

async function main() {
  const baseUrl = required('LEGACY_RDB_BASE_URL')
  const key = required('LEGACY_RDB_ADMIN_KEY')
  const output = outputDirectory()
  await mkdir(output, { recursive: true })
  const tables = []
  for (const table of TABLES) {
    const rows = await exportTable(baseUrl, key, table)
    const contents = `${JSON.stringify(rows)}\n`
    await writeFile(join(output, `${table}.json`), contents, { mode: 0o600 })
    tables.push(summary(table, rows, contents))
    console.log(`${table}: ${rows.length} rows`)
  }
  const manifest = { format: 1, generatedAt: new Date().toISOString(), source: 'legacy-rdb-read-only', tables }
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  console.log(`manifest: ${join(output, 'manifest.json')}`)
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'legacy export failed'); process.exit(1) })
