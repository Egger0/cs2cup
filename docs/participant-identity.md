# Participant identity foundation

Tournament entries are event records, not user accounts. `team` and `player` remain historical
snapshots, while a `participant_principal` is the stable private subject used by future sign-in,
profile, and authorization features.

## Invariants

- A WebAuthn user handle is a random, stable, non-PII 32-byte value. It is stored as 43-character
  base64url and never derived from a database id, name, team, contact value, or provider subject.
- External identities are keyed by the complete `provider + issuer + subject` namespace. Provider
  adapters must supply a lowercase provider id and canonical, exact issuer and subject values.
- Resolving the same namespace is idempotent. A bare external subject is never an application key.
- A tournament entry has at most one owner. Repeating a claim for that principal succeeds;
  another principal receives a conflict. Ownership transfer requires a separate verified command
  and is intentionally not implemented by the claim operation.
- Existing management links remain compatible during rollout. A claim verifies the existing
  hash-only token and never copies its plaintext value into an identity table.
- Identity, profile, ownership, user-handle, and future credential data are private. Public views,
  public query helpers, feeds, and CSV exports must not join these relations.

## Bootstrap and recovery

The first participant flow starts from an existing registration-management link. Visiting a link
does not create an account or claim an entry. A future explicit enrollment ceremony will create a
principal, verify a Passkey, and claim the entry in one atomic write boundary.

A namespaced external identity resolves to the same principal after a lost session, which provides
the foundation for verified recovery without converting event contact fields into credentials.
Recovery, credential deletion, and ownership transfer still require explicit audit and lifecycle
work before they are exposed to participants.

## Passkey boundary

The production relying-party origin is `https://cn.nbtesportsclub.online` and the initial RP ID is
the exact host `cn.nbtesportsclub.online`. Local ceremonies use `http://localhost:3000` and RP ID
`localhost`. Worker preview domains do not share credentials with the custom domain. Future
WebAuthn routes must derive this configuration from the trusted canonical site setting, require
HTTPS outside localhost, and never trust request host headers.

Credential, challenge, and participant-session tables are deliberately deferred to the next
vertical slice. No inert Passkey UI or half-implemented ceremony is introduced by this migration.

## Rollout and rollback

Apply the additive migration before enabling any participant account route. Anonymous registration,
management links, public reads, and the singleton administrator path do not depend on the new
tables and continue unchanged.

To pause rollout, stop new identity and claim writes; existing public and administrator behavior
requires no database rollback. If the unused foundation must be removed, first verify that no
participant feature references it, export any private identity data required by policy, and remove
the four new relations in reverse dependency order. Production migration and destructive rollback
remain protected maintainer operations.
