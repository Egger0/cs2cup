import { createHash } from 'node:crypto'

export function normalizeMigrationSql(sql) {
  return sql.replace(/\r\n?/g, '\n')
}

export function migrationChecksum(sql) {
  return createHash('sha256')
    .update(normalizeMigrationSql(sql), 'utf8')
    .digest('hex')
}
