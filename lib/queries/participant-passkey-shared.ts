import 'server-only'

export interface ParticipantPasskeyStatement {
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

export interface ParticipantPasskeyDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): ParticipantPasskeyStatement
  }
  batch(statements: ParticipantPasskeyStatement[]): Promise<unknown[]>
}

export type PasskeyCeremonyKind = 'claim' | 'authentication'

export class ParticipantPasskeyError extends Error {
  readonly code:
    | 'invalid_claim'
    | 'entry_already_claimed'
    | 'rate_limited'
    | 'invalid_challenge'
    | 'unknown_credential'
    | 'conflict'

  constructor(code: ParticipantPasskeyError['code']) {
    super(code)
    this.name = 'ParticipantPasskeyError'
    this.code = code
  }
}
