# ADR 0002: Provider-neutral domain and identity foundations

- Status: Accepted
- Date: 2026-08-28
- Tracking: [#12](https://github.com/Egger0/cs2cup/issues/12)
- Delivery sequence: [#13](https://github.com/Egger0/cs2cup/issues/13)
- Scope: Phase 2A

## Context: repository facts before Phase 2A

This decision starts from the behavior already present in the repository:

- The administrator session contains only a verified external `sub`.
  [`lib/auth.ts`](../../lib/auth.ts) admits that subject only when the same value
  exists in `public.admin_user.user_id`; no product role or ownership lookup is
  performed.
- [`lib/jwt.ts`](../../lib/jwt.ts) verifies the configured OpenID Connect issuer
  when OIDC is enabled, but returns only `sub` to the current administrator
  code. A bare subject is therefore insufficient for a durable domain identity.
- [`migrations/001_schema.sql`](../../migrations/001_schema.sql) defines
  `public.team.status` as only `pending`, `approved`, or `rejected` and defines
  `public.player` as a child of one team.
- [`migrations/004_registration.sql`](../../migrations/004_registration.sql)
  creates an anonymous registration directly in `pending`. It counts every
  team except `rejected` against tournament capacity.
- [`migrations/013_security_boundaries.sql`](../../migrations/013_security_boundaries.sql)
  publishes only approved teams and their roster rows through `team_public`
  and `player_public`; registration contact and notes are not in those views.
- [`migrations/017_cloudbase_rpc_guards.sql`](../../migrations/017_cloudbase_rpc_guards.sql)
  establishes `app_private` and guarded public RPC wrappers because the current
  CloudBase/PostgREST transport is not itself a product authorization model.

Phase 2A must add durable identity vocabulary without changing any of those
product behaviors or making a guessed assertion about an existing person.

## Decision

### Normative vocabulary

These names are the canonical domain terms for later code, tests, and UI copy:

- **Principal** is the provider-neutral, durable application subject stored as
  `app_private.principal`. Its UUID is the only identity key used by new domain
  foreign keys. It is not a token, provider subject, PostgreSQL role, browser
  session, or `admin_user` row.
- **AuthIdentity** is one verified external login binding stored as
  `app_private.principal_identity`. It links exactly one external namespace to
  exactly one Principal.
- **TournamentEntry** is the domain meaning of the existing `public.team` row:
  a team snapshot registered for one tournament. Phase 2A does not introduce a
  reusable global club/team entity and does not rename the table.
- **RosterSlot** is the domain meaning of the existing `public.player` row: one
  place in a TournamentEntry roster. A RosterSlot may reference a Principal,
  but it is not itself an identity or proof of control.
- **Owner** and **Manager** are revocable relationships between a Principal and
  a TournamentEntry in `app_private.team_ownership`. They are not inferred from
  `team.captain`, `team.contact`, a nickname, or a RosterSlot.

`public.club_member` remains editorial website content. It is not an identity,
role assignment, roster, or ownership record.

### Identity namespace

An AuthIdentity is identified by the exact, case-sensitive tuple:

```text
(provider, issuer, subject)
```

The tuple has the following contract:

- `provider` is a repository-owned adapter identifier matching
  `^[a-z][a-z0-9_-]{0,31}$`; the current adapter identifier is `cloudbase`.
- `issuer` is the exact verified issuer, 1–512 characters, with no leading or
  trailing whitespace and no control characters. It is not URL-normalized or
  case-folded.
- `subject` is the exact verified opaque subject within that issuer, with the
  same length, whitespace, and control-character rules. It is never parsed as
  an email, handle, role, or tenant.
- all three columns use PostgreSQL's built-in `C` collation so equality,
  uniqueness, and ASCII validation remain exact and independent of the target
  database locale.

OpenID Connect specifies that `iss` and `sub` together are the stable identifier
on which a relying party can depend. The additional repository-owned provider
component keeps adapters in separate namespaces. See
[OpenID Connect Core 1.0, Claim Stability and Uniqueness](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability).

An adapter MUST fail closed unless it has verified all three values. It MUST
NOT:

- invent an issuer from `CLOUDBASE_ENV_ID`, a gateway hostname, username,
  deployment URL, or convention;
- copy a bare `admin_user.user_id` into `subject` under a synthetic issuer;
- find or merge an identity by `subject`, display name, contact, captain, or
  roster nickname alone; or
- relink a binding implicitly when a provider, issuer, or subject changes.

Relinking and recovery require a later explicit, transactional, audited
operation. In particular, an identity bound to a deleted Principal is not
silently reactivated.

### Phase 2A additive schema

[`migrations/018_identity_foundations.sql`](../../migrations/018_identity_foundations.sql)
is the implementation contract. All new security-sensitive tables are in
`app_private`, not the PostgREST-exposed `public` schema.

| Relation or bridge | Persisted contract in Phase 2A |
|---|---|
| `app_private.principal` | UUID primary key generated by PostgreSQL; status is `active`, `suspended`, or `deleted`; timestamps and deleted-state consistency are database constrained. |
| `app_private.principal_identity` | Bigint identity primary key; required Principal FK; exact `provider`, `issuer`, and `subject`; unique namespace tuple; creation and last-verification timestamps. |
| `app_private.principal_profile` | One optional profile per Principal; required display name if present; optional unique case-insensitive handle and bounded bio; visibility is `private` by default or `public`. No public projection is created. |
| `app_private.role_assignment` | Bigint identity primary key; Principal, constrained role, optional tournament scope, optional granting Principal, creation and revocation timestamps; duplicate active assignments are prevented by partial unique indexes. |
| `app_private.team_ownership` | Bigint identity primary key; TournamentEntry, Principal, `owner` or `manager`, optional granting Principal, creation and revocation timestamps; at most one active owner and at most one active relationship per Principal and entry. |
| `app_private.audit_event` | Bigint identity primary key; occurrence time; `actor_type` (`system`, `principal`, or `anonymous`) consistent with the nullable actor Principal; constrained action and entity fields; optional retained tournament link and request UUID; JSON object metadata bounded to 8192 bytes. Update, delete, and truncate are rejected by triggers. |
| `public.admin_user.principal_id` | Nullable, unique Principal FK bridge. Existing rows remain null. It does not participate in the current allowlist decision. |
| `public.player.principal_id` | Nullable Principal FK bridge. Existing rows remain null; a non-null Principal can occupy at most one RosterSlot in the same TournamentEntry. |

The migration creates no profile automatically. It stores no password, access
token, refresh token, cookie, JWT, full claims document, registration contact,
or provider profile response.

The following role names and scopes are the complete Phase 2A storage enum:

- global only: `platform_admin`, `content_editor`;
- tournament-scoped only: `tournament_manager`, `registration_reviewer`,
  `match_reporter`.

An active assignment is one whose `revoked_at` is null. A row in this table is
data only in Phase 2A: it does not grant console, RPC, table, or page access.

### Resolver and concurrency contract

`public.ensure_principal_identity(text, text, text)` is the only public-schema
entry point added by Phase 2A. Its contract is deliberately narrow:

- its guarded `SECURITY DEFINER` wrapper calls
  `app_private.require_rpc_role(array['service_role'])`;
- `anon` and `authenticated` cannot execute it, while every caller still must
  present the trusted `service_role` gateway claim;
- the private implementation is `SECURITY INVOKER` and is not directly
  executable by application roles;
- a transaction-scoped advisory lock plus the unique namespace constraint make
  concurrent resolution of the same tuple converge on one Principal and one
  AuthIdentity;
- a first resolution creates the Principal and AuthIdentity and appends one
  minimal `principal.created` system audit event; a repeat updates only
  `last_verified_at`; and
- success returns only `{"ok":true,"principalId":"<uuid>","created":<boolean>}`.

Resolution is not authorization or session admission. The implemented lookup
returns an existing `active` **or `suspended`** Principal and rejects only a
`deleted` one. Phase 2B must apply suspension and revocation policy before
issuing or accepting an application session.

The implemented SQL error semantics are:

| Condition | SQLSTATE | Meaning |
|---|---|---|
| malformed or missing namespace component | `22023` | caller supplied an invalid verified-identity contract |
| wrapper called without an allowed gateway role | `42501` | caller is not authorized |
| tuple is already attached to a deleted Principal | `55000` | recovery/relinking is required; do not create a replacement |

Constraint and foreign-key failures keep their PostgreSQL SQLSTATE. Phase 2A
does not establish an HTTP error envelope; a later application adapter must map
these states without leaking whether an arbitrary identity exists.

The resolver is idempotent for identity creation. `audit_event.request_id` is
only nullable correlation data: it is not unique, there is no `command_id`, and
Phase 2A does not claim general command or event idempotency.

### Database invariants and exposure boundary

The database, rather than only TypeScript, enforces these invariants:

1. An exact AuthIdentity namespace maps to at most one Principal.
2. A deleted Principal has a non-null deletion time; an active or suspended
   Principal does not.
3. A profile is private by default and a handle is unique case-insensitively.
4. Global and tournament role scopes cannot be interchanged, and duplicate
   active assignments are rejected under concurrency.
5. A TournamentEntry has at most one active Owner, while it may have multiple
   active Managers.
6. A Principal cannot hold two simultaneous ownership/management rows for the
   same TournamentEntry.
7. One Principal cannot occupy two linked RosterSlots in one TournamentEntry.
8. Audit actor type and actor Principal are consistent; audit metadata is an
   object within the size limit; audit rows cannot be updated, deleted, or
   truncated. A tournament referenced by audit evidence cannot be hard-deleted;
   it must be retained or archived so the immutable relationship remains true.
9. All six new tables enable RLS and intentionally define no policies. Direct
   schema, table, sequence, and private-function access is revoked from
   `public`, `anon`, `authenticated`, `club_admin`, and `service_role` where
   those roles exist.
10. No migration fabricates Principal, identity, profile, role, ownership,
    RosterSlot link, administrator link, consent, or historical audit data.

With RLS enabled and no applicable policy, PostgreSQL uses default deny for
ordinary table access. Table owners normally bypass RLS, which is why ownership
or a migration connection is not accepted as product authorization evidence.
See the official
[PostgreSQL row security documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

### Current authority is unchanged

`public.admin_user.user_id` remains the sole authoritative administrator
allowlist for Phase 2A. [`lib/auth.ts`](../../lib/auth.ts) continues to query
that column and does not read any foundation table or `principal_id` bridge.

Therefore:

- `admin_user.principal_id` being null does not deny an existing administrator;
- linking that bridge does not grant administrator access;
- `platform_admin` does not grant current administrator access;
- removing a role assignment or foundation row does not revoke current
  administrator access; and
- replacing the allowlist requires a separate reviewed cutover, not a silent
  interpretation of this ADR.

The migration may safely run before the application and remain installed after
an application rollback because old code ignores the new tables and nullable
columns.

### Authorization and ownership matrices

Phase 2A enforcement is intentionally small:

| Evidence | Administrator console now | Identity resolver now | Participant command now |
|---|---:|---:|---:|
| matching `admin_user.user_id` after token verification | allow | no implied access | none |
| Principal or populated `admin_user.principal_id` | no | no implied access | none |
| `platform_admin` or any `role_assignment` | no | no implied access | none |
| active `team_ownership` Owner/Manager | no | no implied access | none |
| trusted `service_role` gateway claim | no console identity | may execute resolver | none |

The following matrix freezes the least-privilege target for Phase 2D command
authorization. It is not implemented by migration 018. “Scoped” means the row's
`tournament_id` matches the target resource, and all unlisted combinations are
denied.

| Future command | Owner | Manager | `match_reporter` | `registration_reviewer` | `tournament_manager` | `content_editor` | `platform_admin` |
|---|---:|---:|---:|---:|---:|---:|---:|
| Edit own entry draft and roster | owned | owned | deny | deny | scoped override | deny | all |
| Submit or withdraw own entry | owned | owned | deny | deny | scoped override | deny | all |
| Transfer/recover entry ownership | owned transfer | deny | deny | deny | scoped recovery | deny | all |
| Start review or decide registration | deny | deny | deny | scoped, non-self | scoped, non-self | deny | all, non-self by default |
| Report match score/result | deny | deny | scoped | deny | scoped | deny | all |
| Edit tournament configuration | deny | deny | deny | deny | scoped | deny | all |
| Edit global editorial content | deny | deny | deny | deny | deny | allow | all |
| Assign tournament-scoped roles | deny | deny | deny | deny | scoped, only narrower roles | deny | all |
| Assign global roles or manage Principals | deny | deny | deny | deny | deny | deny | all |
| Read private audit projection | owned safe projection | owned safe projection | scoped match events | scoped registration events | scoped | deny | all |

Every future decision MUST be deny-by-default, re-evaluated for each request,
and based on both role and resource relationship. A client-supplied ID never
proves ownership. These rules follow the
[OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html):
least privilege, default deny, per-request validation, logging, and explicit
authorization tests.

### Audit, privacy, consent, and retention

Audit events record evidence that an action occurred, not copies of the
affected record. `metadata` may contain internal IDs, state or role names,
changed-field names, stable reason codes, and credential-free correlation IDs.
It MUST NOT contain:

- credentials, tokens, cookies, authorization headers, JWT bodies, or API keys;
- issuer/subject tuples, raw or hashed client addresses, or provider responses;
- registration contact, notes, legal names, roster payloads, profile content,
  or complete before/after objects; or
- unrestricted human review text.

Use an internal Principal ID for a principal actor. Use `system` or `anonymous`
with a null actor Principal when that is the truth; never invent a Principal.
The resolver's creation event uses empty metadata.

`audit_event.tournament_id` uses `ON DELETE RESTRICT`, not a cascading or
nulling action. Rewriting the relationship would contradict append-only audit
history, so hard deletion of an associated tournament fails. Phase 2A does not
invent an archive command or state; a later lifecycle must define retention or
archival before such a tournament could be removed.

Phase 2A stores no consent receipt and exposes no participant profile or
identity projection. `principal_profile.visibility = 'public'` is a stored
preference only until a later reviewed projection and consent flow exist.
`last_verified_at`, an ownership row, a roster link, or prior anonymous
registration is not consent.

Identity bindings and audit records are private and data-minimized, but Phase
2A does not implement export, correction, erasure, or retention jobs. Until a
reviewed retention schedule and deletion workflow ship, operators preserve
these rows under restricted access and do not hard-delete or repurpose them.

### Cloudflare adapter boundary

Domain code must depend on the contracts above, not on Next.js request types,
CloudBase SDK objects, PostgREST filter syntax, Workers bindings, connection
URLs, or external subjects as foreign keys. An authentication adapter verifies
the provider tuple; the resolver returns a Principal UUID; repositories and
policies use internal IDs and explicit transactions.

[Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/) can
provide pooled connectivity from Workers to PostgreSQL; its
[getting-started contract](https://developers.cloudflare.com/hyperdrive/get-started/)
still uses a database connection string. Hyperdrive does not replace token
verification, authorization, RLS, migrations, transaction boundaries, or
audit/privacy policy. A Workers/Hyperdrive adapter must pass the same namespace,
authorization, concurrency, and rollout tests. This ADR makes no D1 commitment.

## Frozen lifecycle contract for the Phase 2C PR

Migration 018 does **not** alter `public.team.status`, anonymous registration,
capacity counting, public views, administrator controls, or pages. The shipped
states remain `pending`, `approved`, and `rejected` for Phase 2A.

The next lifecycle PR (Phase 2C in issue #13's delivery sequence) MUST implement
and migrate the following target state machine as one reviewed backend contract
before any Phase 3/4 UI depends on it:

| State | Owner/Manager mutable | Occupies capacity | Public | Legal next state |
|---|---:|---:|---:|---|
| `draft` | yes | no | no | `submitted`, or hard-delete |
| `submitted` | no | yes | no | `under_review`, `withdrawn` |
| `under_review` | no | yes | no | `submitted`, `approved`, `rejected`, `withdrawn` |
| `approved` | no | yes | yes | `withdrawn` only before roster/bracket lock and without match dependency |
| `rejected` | no | no | no | `draft` through an audited revision command |
| `withdrawn` | no | no | no | terminal by default |

Additional frozen requirements for that PR are:

- existing `pending` maps to `submitted`; `approved` and `rejected` retain their
  meanings, and the data migration must prove capacity and publication parity;
- old application instances must keep working through an explicit compatibility
  projection or adapter for `pending`/`approved`/`rejected`; the migration must
  not replace the legacy field in place while those instances can still run;
- only `submitted`, `under_review`, and `approved` consume a seat;
- only `approved` appears in normal public team and roster projections;
- only `draft` may be hard-deleted;
- every transition checks an expected aggregate version and a unique command
  ID in the authoritative transaction;
- every successful transition and ownership change appends exactly one audit
  event in that transaction;
- capacity, deadline, ownership, role scope, conflict of interest, and
  match/bracket dependencies are re-checked transactionally; and
- migration 018's nullable, non-unique `audit_event.request_id` does not satisfy
  command idempotency. The lifecycle PR must add the required storage/constraint.

## Delivery boundaries

| Phase | Included | Explicitly excluded |
|---|---|---|
| **2A: this PR** | private additive schema, nullable bridges, exact identity resolver, constraints, ACL/RLS posture, audit envelope, tests, ADR and rollout runbook | current auth integration, legacy backfill, role/ownership enforcement, lifecycle states, public projections, user/admin UI |
| **2B: sessions and login hardening** | verified provider tuple to Principal integration, revocable application sessions, login/logout/revocation contracts, and explicit cache semantics for identity and authorization-sensitive reads | registration lifecycle changes, scoped product authorization, participant/admin UI |
| **2C: registration lifecycle commands** | the frozen entry state migration and compatibility projection, ownership plus receipt/claim preparation, optimistic concurrency, command idempotency, transactional capacity/deadline/dependency checks, and transition audit | broad scoped-role enforcement or participant/reviewer UI |
| **2D: authorization, audit, and privacy** | enforcement of the scoped role/ownership matrix, complete command audit coverage, consent records, data export/correction/erasure and retention operations | participant and reviewer interface design |
| **3: participant account interface** | profile/consent controls, owned entry and roster forms, submit/withdraw/status flows, accessible validation, recovery, and polished loading/empty/error states on the Phase 2 contracts | reviewer/administrator workflow redesign |
| **4: review administration interface** | scoped reviewer/tournament-manager workflows, review decisions and history, audit projections, conflict-of-interest presentation, and polished operational states | inferred legacy identities, hidden authority cutover, or backend policy implemented only in UI |

No later UI may simulate a capability whose backend command, authorization
rule, audit behavior, and error contract have not shipped.

## Consequences

- Existing administrator and anonymous registration behavior remains stable.
- No legacy person receives an identity, role, roster link, or ownership claim
  based on ambiguous data.
- New rows may remain empty until an explicit trusted flow uses them; that is
  correct expand-before-application behavior.
- Stable Principal UUIDs and private provider bindings decouple later domain
  work from CloudBase and from a future Cloudflare database adapter.
- A stored role or relationship is not a security control until Phase 2D
  command handlers enforce the frozen matrix.
- The six-state lifecycle is the frozen Phase 2C contract, not a shipped Phase
  2A feature.

## Alternatives rejected

- Using `admin_user.user_id` or token `sub` as the Principal key was rejected
  because a subject is issuer-scoped and provider-specific.
- Guessing an issuer or backfilling identities was rejected because it would
  assert verification that never occurred.
- Inferring ownership from captain, contact, nickname, or roster membership was
  rejected because none proves account control.
- Reusing `club_member` was rejected because it is editorial content.
- Putting the new tables in `public` was rejected because identities, profiles,
  roles, ownership, and audit evidence are not generic PostgREST resources.
- Replacing `admin_user` in this PR was rejected because it would combine an
  additive foundation with a high-risk authorization cutover.
- Implementing the lifecycle and UI in the same PR was rejected so namespace,
  ACL, concurrency, migration, and rollback behavior remain independently
  reviewable.
