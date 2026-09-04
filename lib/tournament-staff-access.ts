export type TournamentStaffIdentity =
  | { kind: 'admin'; adminId: number; uid: string; sessionExpiresAt: number }
  | { kind: 'participant'; principalId: string; sessionExpiresAt: number }
  | { kind: 'unified'; accountId: string; uid: string; sessionExpiresAt: number }

export type TournamentStaffAccess =
  | { ok: true; actor: TournamentStaffIdentity }
  | {
      ok: false
      reason: 'anonymous' | 'expired' | 'forbidden' | 'conflict'
      hadAdminCookie: boolean
      hadParticipantCookie: boolean
    }

export class TournamentStaffAccessError extends Error {
  readonly access: Extract<TournamentStaffAccess, { ok: false }>

  constructor(access: Extract<TournamentStaffAccess, { ok: false }>) {
    super('Tournament staff authorization failed')
    this.name = 'TournamentStaffAccessError'
    this.access = access
  }
}

export function staffSessionRemainingMs(expiresAt: number) {
  return Number.isSafeInteger(expiresAt) ? expiresAt - Date.now() : 0
}
