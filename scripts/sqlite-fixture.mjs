import { readdir, readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

const migrationsDirectory = new URL('../cloudflare/d1/', import.meta.url)
const migrationName = /^\d{4}_[a-z0-9_-]+\.sql$/

export async function migrationFiles() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && migrationName.test(entry.name))
    .map(entry => entry.name)
    .sort()
}

export async function applyMigrations(database) {
  const files = await migrationFiles()
  if (!files.length) throw new Error('No database migrations found')

  for (const file of files) {
    database.exec(await readFile(new URL(file, migrationsDirectory), 'utf8'))
  }
}

export async function createMigratedDatabase(path = ':memory:') {
  const database = new DatabaseSync(path)
  database.exec('PRAGMA foreign_keys = ON')

  try {
    await applyMigrations(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}
