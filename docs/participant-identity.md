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
does not create an account or claim an entry. Only the explicit Passkey enrollment action starts a
ceremony. Successful verification creates the principal, claims the entry, stores the credential,
and opens a participant session in one atomic D1 batch.

A namespaced external identity resolves to the same principal after a lost session, which provides
the foundation for verified recovery without converting event contact fields into credentials.
Recovery, additional credential enrollment, credential deletion, and ownership transfer still
require explicit audit and lifecycle work before they are exposed to participants. Until recovery
exists, the management link remains the editing capability and must not be cleared after a claim.

## Passkey boundary

The production relying-party origin is `https://cn.nbtesportsclub.online` and the initial RP ID is
the exact host `cn.nbtesportsclub.online`. Local ceremonies use `http://localhost:3000` and RP ID
`localhost`. Worker preview domains do not share credentials with the custom domain. WebAuthn
routes derive this configuration from the trusted canonical site setting, require HTTPS outside
localhost, and never trust request host headers.

Registration and usernameless authentication require user verification and discoverable
credentials. Ceremony tokens and participant-session tokens are random, stored hash-only, and
carried in `__Host-` cookies. Challenges expire after five minutes and are atomically consumed
before cryptographic verification, including failed attempts. Authentication updates the signature
counter through a credential revision compare-and-swap before issuing the session.

The initial participant surface is intentionally narrow: enrollment on the management receipt,
Passkey-only sign-in, a read-only owned-entry archive, and sign-out. It does not imply recovery,
credential management, or authorization for tournament mutations.

## UX references

The ceremony placement, device-local privacy language, and explicit user control follow the
[FIDO Alliance passkey UX guidelines](https://fidoalliance.org/new-design-guidelines-optimizing-user-sign-in-experience-with-passkeys/) and
[Google's passkey interface guidance](https://developers.google.com/identity/passkeys/ux/user-interface-design).
Platform language is cross-checked against
[Apple's passkey overview](https://developer.apple.com/passkeys/), while ceremony behavior follows
[WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/). The visual treatment and repository assets are
original to this project; no third-party artwork is bundled by this slice.

## Rollout and rollback

Apply additive migrations `0009` and `0010` before enabling participant routes. Anonymous
registration, management links, public reads, and the singleton administrator path do not depend
on participant sessions and continue unchanged.

To pause rollout, disable the participant Passkey routes and navigation entry; existing public and
administrator behavior requires no database rollback. Preserve participant data and management
links while sessions expire. Production migration and destructive rollback remain protected
maintainer operations.
