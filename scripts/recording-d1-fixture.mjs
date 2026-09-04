class RecordingD1Statement {
  constructor(owner, sql, parameters = []) {
    Object.assign(this, { owner, sql, parameters })
  }

  bind(...parameters) {
    return new RecordingD1Statement(this.owner, this.sql, parameters)
  }

  execute(kind) {
    this.owner.queries.push({ kind, sql: this.sql, parameters: this.parameters })
    if (this.owner.failure) {
      const error = this.owner.failure
      this.owner.failure = null
      throw error
    }
    return this.owner.database.prepare(this.sql)
  }

  async first() {
    return this.execute('first').get(...this.parameters) ?? null
  }

  async all() {
    return { results: this.execute('all').all(...this.parameters) }
  }

  async run() {
    return this.execute('run').run(...this.parameters)
  }
}

export class RecordingD1Database {
  constructor(database) {
    Object.assign(this, { database, queries: [], failure: null, beforeBatch: null })
  }

  prepare(sql) {
    return new RecordingD1Statement(this, sql)
  }

  async batch(statements) {
    if (this.beforeBatch) {
      const operation = this.beforeBatch
      this.beforeBatch = null
      await operation()
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}
