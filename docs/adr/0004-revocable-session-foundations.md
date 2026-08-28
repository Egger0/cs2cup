# ADR 0004: Revocable application-session foundations

- Status: Accepted
- Date: 2026-08-28
- Tracking: [#13](https://github.com/Egger0/cs2cup/issues/13)
- Scope: Phase 2B.2
- Depends on: [ADR 0002](0002-domain-identity-foundations.md),
  [ADR 0003](0003-explicit-cache-boundaries.md)

The uppercase terms **MUST**, **MUST NOT**, **SHOULD**, and **SHOULD NOT** have
the meanings in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) in this document. Stable
rules use `SESSION-NNN` identifiers. Later decisions may supersede a rule but
MUST NOT renumber or silently reuse its identifier.

## Context and delivery boundary

The application currently authenticates administrators directly from the
verified CloudBase/OIDC credential stored in the existing cookie. It then
checks the legacy `public.admin_user.user_id` allowlist. Migration 018 added a
provider-neutral Principal and identity resolver, but deliberately did not
issue an application session. The resolver may return a suspended Principal;
resolution is not session admission.

The current credential is difficult to revoke independently of its provider,
cannot express an application idle or absolute lifetime, and keeps application
authorization coupled to a provider token. A server-side application session
is therefore required before participant identity and ownership features can
be enabled.

Phase 2B.2 creates only the provider-neutral database and token-codec
foundations. It is an **additive, inert expand change**:

- migration 019 creates private relations, guarded service RPCs, constraints,
  indexes, audit behavior, and no rows;
- the token codec fixes a future wire format and digest contract but no current
  request reads or writes that token;
- current login, logout, administrator authority, cookie name/value/options,
  CloudBase verification, and `lib/auth.ts` behavior remain unchanged; and
- the previous application image continues to work after migration 019 and
  ignores every new object.

The application-session cookie cutover, provider adapter integration, trusted
network fingerprint derivation, CSRF proof, dual-cookie transition, and legacy
cookie retirement belong to a separately reviewed Phase 2B.3 change.

- `SESSION-001`: Phase 2B.2 MUST remain additive and inert. It MUST NOT alter
  current authentication, authorization, cookie, login, logout, or cache
  behavior and MUST NOT backfill a Principal, session, token, throttle, or
  audit event.
- `SESSION-002`: No Phase 2B.2 object is current product authority. Existing
  `public.admin_user.user_id` behavior remains authoritative until the Phase
  2B.3 cutover is explicitly accepted.

## Vocabulary and private data model

**SessionFamily** is one logical authenticated application session across token
rotations. It is stored in `app_private.app_session` and owns the Principal,
creation time, last successful use, idle and absolute expiries, next rotation
time, rotation count, and optional terminal revocation.

**SessionToken** is one digest belonging to a SessionFamily. It is stored in
`app_private.app_session_token`. A row is exactly one of:

- `current`: the only token that may trigger the next rotation;
- `grace`: the immediately previous current token, accepted only until its
  short overlap deadline so requests already in flight do not fail; or
- `retired`: older lineage retained only to detect reuse and then removed by
  bounded retention cleanup.

`app_private.login_throttle` stores two independent, keyed pseudonymous
dimensions for application-login admission:

- `account`: one provider-qualified account candidate; and
- `network`: one caller network bucket obtained only from a trusted ingress.

The two session relations are the complete credential lineage. A separate
family identifier is never placed in the browser token. The throttle relation
is operational abuse state, not a SessionFamily or an audit log.

- `SESSION-003`: All three relations MUST remain in `app_private`, enable RLS,
  define no request-role policy, and be unreachable by direct application or
  gateway table access.
- `SESSION-004`: A SessionFamily MUST have exactly one Principal and at most
  one `current` and one `grace` SessionToken. Every retained token digest MUST
  be unique across all families. The CSPRNG application path MUST NOT
  deliberately reuse a token after retirement, revocation, expiry, or cleanup;
  the database makes no historical uniqueness claim after bounded cleanup has
  deleted the digest.
- `SESSION-005`: Family revocation is terminal. Reactivating a Principal or
  presenting a newer provider credential MUST NOT clear `revoked_at`, extend an
  expired family, or revive any token in that family.

## Opaque token and digest contract

The future application token has one canonical representation:

```text
random bytes:  32 bytes from a cryptographically secure random source
payload:       unpadded base64url(random bytes), exactly 43 characters
token:         "v1." + payload, exactly 46 ASCII characters
```

The payload uses the URL-safe alphabet from
[RFC 4648 section 5](https://www.rfc-editor.org/rfc/rfc4648.html#section-5).
It has no `=` padding. For a 32-byte input, the low two unused bits in the final
base64url character are zero; non-canonical aliases are rejected rather than
normalized. Prefix, alphabet, length, case, and canonical final character are
exact.

```text
^v1\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$
```

Generation uses the runtime Web Crypto CSPRNG. The W3C Web Cryptography
specification defines `getRandomValues` as filling bytes with cryptographically
secure random values. NIST SP 800-63B-4 requires session-binding secrets to use
an approved random source and at least 64 bits; OWASP recommends at least 128
bits for a custom session identifier. The repository deliberately chooses 256
random bits.

Only the application and browser ever hold the raw token. Before any database
call, the application validates the canonical representation and computes:

```text
digest = SHA-256(
  UTF-8("cs2cup-session-v1\0") || UTF-8(complete versioned token)
)
```

The context string, terminating NUL byte, inclusion of `v1.`, UTF-8 encoding,
and concatenation order are exact. The result crosses the database boundary as
a 32-octet PostgreSQL `bytea`; a hexadecimal `\x...` value is only a transport
representation of that `bytea`, not the stored domain type. SHA-256 is defined
by [NIST FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final).

Domain separation and hash-only storage are repository decisions. The cited
standards do not prescribe this exact construction. An unkeyed digest is used
because the input contains 256 unpredictable bits; this reasoning MUST NOT be
copied to a password, short OTP, provider subject, email address, IP address,
or other enumerable value.

- `SESSION-006`: A future token MUST be exactly `v1.<43 canonical unpadded
  base64url characters>` encoding exactly 32 independently random bytes. A
  parser MUST reject every other prefix, length, alphabet, padding, whitespace,
  Unicode, or non-canonical trailing-bit representation.
- `SESSION-007`: Token generation MUST use a CSPRNG and MUST fail closed when
  the secure runtime primitive is unavailable. It MUST NOT use a UUID, time,
  counter, provider token, `Math.random`, database sequence, or user data.
- `SESSION-008`: The application MUST compute the exact domain-separated
  SHA-256 digest above before an RPC. The database MUST accept and persist only
  a 32-octet `bytea`, never the raw or merely base64url-decoded token.
- `SESSION-009`: A raw token MUST NOT enter any database row. A token digest
  may appear only in `app_private.app_session_token.token_hash`; neither value
  may appear in audit, request IDs, metric labels, traces, exceptions,
  structured logs, URLs, HTML, analytics, support records, runtime snapshots,
  or release evidence. Error messages MUST NOT echo rejected input. Public,
  immutable codec vectors made only from declared non-secret bytes are the sole
  documentation/test-source exception.

## Session clock and state machine

All authoritative times come from PostgreSQL. SessionFamily creation samples
time after its Principal admission lock; use and revocation sample time after
their ordered Principal and family serialization locks. Client time, cookie
expiry, CDN time, provider token time, and a transaction-start timestamp do not
override that database clock. Throttle and cleanup intentionally use the
separate operation-level clock contracts documented below; they are not
authentication-touch clocks.

For a newly created family at database time `T0`:

```text
created_at          = T0
last_seen_at        = T0
idle_expires_at     = T0 + 30 minutes
absolute_expires_at = T0 + 8 hours
rotate_after        = T0 + 15 minutes
```

For every successful use at lock-owned database time `T`:

```text
last_seen_at    = T
idle_expires_at = min(T + 30 minutes, absolute_expires_at)
```

There is no touch sampling, write-behind, minimum write interval, or
client-reported activity. A request is successful only after the exact touch
commits. Background polling and prefetch count as activity only if Phase 2B.3
deliberately routes them through authenticated session use; that integration
must not be accidental.

When a request presents the `current` token at or after `rotate_after`, it must
supply a distinct, newly generated replacement digest. In the same transaction:

1. any prior `grace` token becomes `retired`;
2. the presented `current` token becomes `grace` until
   `min(T + 60 seconds, absolute_expires_at)`;
3. the replacement becomes the sole `current` token;
4. `rotate_after` becomes `min(T + 15 minutes, absolute_expires_at)`;
5. the family is touched and its rotation count advances once; and
6. one minimal `session.rotated` audit event is appended.

A valid grace token succeeds and performs the exact family touch, but it cannot
rotate or become current again. While the family is otherwise live and its
Principal active, presenting a retired token or a grace token at or after its
deadline is treated as detected token reuse: the complete family is revoked
atomically and the caller receives the same generic denial as any other
unusable token. A family already revoked, idle-expired, absolute-expired, or
invalidated by Principal status remains denied without a second terminal
transition or audit event.

These boundaries use exact comparisons:

```text
now >= idle_expires_at      -> deny
now >= absolute_expires_at  -> deny
now >= grace.valid_until    -> deny and revoke for detected reuse
now >= rotate_after         -> rotate a current token
```

Cookie expiry is not an enforcement mechanism. Cleanup is also not an
enforcement mechanism: expired rows may remain stored temporarily but are
never accepted.

- `SESSION-010`: Idle expiry MUST be exactly 30 minutes from the last committed
  successful use and absolute expiry MUST be exactly eight hours from family
  creation. Absolute expiry is immutable and no token-only operation may
  extend it.
- `SESSION-011`: Every successful authenticated request MUST touch exactly at
  the database serialization time and recompute idle expiry. Approximate,
  sampled, asynchronous, cached, or client-side touches are forbidden.
- `SESSION-012`: Rotation MUST be due exactly every 15 minutes and MUST retain
  only the immediately previous token as grace for at most 60 seconds. Grace
  never extends the eight-hour absolute boundary.
- `SESSION-013`: Every expiry check MUST reject at equality. `now >= expiry`
  is expired; no epsilon, clock-skew allowance, retry grace, or inclusive end
  is implied.
- `SESSION-014`: Unknown, revoked, idle-expired, absolute-expired, retired, and
  expired-grace presentations MUST fail closed without revealing which state
  applied. Retired or expired-grace reuse against an otherwise live family and
  active Principal MUST atomically revoke the family; an already terminal
  family MUST NOT be rewritten or audited again.
- `SESSION-015`: Session creation and successful use MUST require an `active`
  Principal. A `suspended` or `deleted` Principal cannot receive, use, or
  rotate a session even though migration 018 identity resolution can return a
  suspended Principal.

## Guarded RPC contract

Migration 019 exposes a small trusted-service surface. Exact SQL signatures
are part of the reviewed migration; the semantic operations are:

| Guarded public RPC | Contract |
|---|---|
| `create_app_session(uuid, bytea, uuid)` | Admit an active Principal, create one family and one current digest, append `session.created`, and return only internal identifiers and deadlines. Arguments are Principal, digest, and request ID. |
| `use_app_session(bytea, bytea, uuid)` | Atomically validate, check Principal status and family expiry, touch every success, rotate when due, accept current grace, detect replay, and return no credential material. Arguments are presented digest, distinct replacement digest, and request ID. |
| `logout_app_session(bytea, uuid)` | Idempotently revoke the family found by a presented digest with reason `logout`; unknown or already revoked is a successful no-op. The audited actor is the family Principal. |
| `revoke_app_session(uuid, uuid, text, uuid)` | Revoke one family by internal UUID. Arguments are family, optional actor Principal, constrained reason, and request ID. `administrator` requires an active actor; `security_event` may use an existing actor of any status or a null system actor. It never accepts a token digest. |
| `revoke_principal_sessions(uuid, uuid, uuid, text, uuid)` | Revoke all active families for a target Principal, optionally excluding one family that must belong to the target. Arguments are target, exception, optional actor, constrained reason, and request ID. `administrator` requires an active actor; `principal_status` requires a non-active target and null system actor; `security_event` permits either an existing actor of any status or system. Each changed family receives its own audit event. |
| `consume_login_attempt(bytea, bytea)` | Atomically consume both account and network dimensions and return only `allowed` plus the maximum retry delay. |
| `clear_login_account_throttle(bytea)` | Remove only the account dimension after provider verification and application-session creation have both committed. |
| `cleanup_app_sessions(integer, uuid)` | Delete bounded eligible family/token and throttle batches while skipping rows owned by live operations. The requested per-relation limit is constrained to 1–1000; request ID correlates expiry audit events. |

`request_id` is required correlation data for operations that append audit. It
is not unique and is not a command-id or general idempotency mechanism.
Unknown token use returns a generic denial. Logout and revocation are
idempotent state transitions. Session creation is not generally idempotent:
its digest uniqueness prevents secret reuse, but a retry with a new secret may
create another family.

The stable database error envelope is:

| Condition | Result |
|---|---|
| malformed digest, identical presented and replacement digests, null request ID, invalid actor/reason/exception, malformed fingerprint, or cleanup limit outside 1–1000 | SQLSTATE `22023` |
| create or replacement digest collides with any already stored digest | sanitized SQLSTATE `23505` with no rejected value or native diagnostic detail |
| public wrapper without the trusted service policy | SQLSTATE `42501` |
| session creation for a missing, suspended, or deleted Principal | SQLSTATE `55000` |
| unknown/unusable token use | generic `{"ok":false}` |
| unknown/already revoked logout or administrative target | successful idempotent result with `revoked:false` |
| database uniqueness, check, or foreign-key violation | failure is never remapped to success; any violation involving a digest or fingerprint is caught at the private RPC boundary and rethrown without PostgreSQL `DETAIL`, `HINT`, or the rejected value |

Phase 2B.2 does not define an HTTP error body. Phase 2B.3 must map these
service-only outcomes without echoing arguments or disclosing account, token,
Principal, or family existence to the browser.

- `SESSION-016`: Public RPC wrappers MUST authorize the trusted service claim
  inside the function body and delegate to private `SECURITY INVOKER`
  implementations. SQL `EXECUTE` permission alone is never product
  authorization.
- `SESSION-017`: Session RPC success values MUST contain only `ok`, constrained
  status/count fields, internal UUIDs, and authoritative deadlines needed by
  the adapter. They MUST NOT return a raw token, digest, fingerprint, provider
  tuple, role set, cookie, or private audit metadata.
- `SESSION-018`: `request_id` MUST be treated as correlation only. An agent
  MUST NOT infer deduplication, exactly-once delivery, or safe create replay
  from its presence.
- `SESSION-019`: Logout, administrative single-family revocation, and
  Principal-wide revocation MUST be separate RPC semantics with the exact
  signatures above and idempotent state transitions. Repeating a completed
  revocation MUST NOT change its timestamp, reason, token lineage, or audit
  count.

## Lock order and linearizability

Every state-changing RPC is one PostgreSQL transaction. Session admission and
lifecycle functions use the following global order, and later lifecycle
functions MUST preserve it:

1. every affected Principal row in ascending Principal UUID order: ordinary
   admission/use/logout takes a compatible shared row lock; actor validation,
   Principal status, and administrative/security revocation take an exclusive
   row lock;
2. affected SessionFamily rows in ascending family UUID order;
3. token rows within the already locked family;
4. the corresponding audit insert.

The separate `consume_login_attempt` operation locks `account` before
`network` and holds no Principal/session lock. Account clear touches only one
account row. Bounded cleanup is a deliberate exception to both orders: it takes
no Principal lock and claims family or throttle rows independently in its
documented deterministic eligibility order with `SKIP LOCKED`.

A single-family token operation may first perform an unlocked
digest-to-family/Principal lookup. It then takes a Principal `FOR SHARE` lock,
locks the family, re-reads the family/token relationship, and discards a stale
lookup. Multiple requests for one Principal can share that first lock, while a
status or revocation writer must wait before acquiring any family. This also
prevents the audit actor foreign key from creating a hidden family-to-Principal
lock edge. An administrative/security revocation may first resolve its target
Principal without a lock; before deciding actor authorization or changing a
family it locks every distinct actor/target Principal `FOR UPDATE` in ascending
UUID order, re-reads the actor and target under those locks, then locks family
rows in ascending UUID order. A Principal-wide revocation uses the same order.
A future Principal-status writer must use this Principal-then-family order and
revoke affected families in the same transaction.

The family row lock serializes use, touch, rotation, single logout, and
single-family administrative revocation. The outcome is evaluated with a
fresh `clock_timestamp()` sampled after the lock is acquired, so a waiter does
not use pre-wait time. Commit makes the chosen order externally visible. After
a revocation transaction commits, no later use can succeed; a use that commits
before revocation is the earlier linearized operation.

PostgreSQL recommends acquiring multiple locks in a consistent order to avoid
deadlocks. `FOR UPDATE SKIP LOCKED` is intentionally reserved for eventual
cleanup, where an inconsistent partial view is acceptable; it is forbidden for
authentication, touch, rotation, or revocation decisions.

- `SESSION-020`: Family state changes MUST be atomic and linearizable under one
  family-row lock. A result computed before obtaining that lock MUST be
  re-read or discarded.
- `SESSION-021`: Every session lifecycle mutation MUST acquire its affected
  Principal lock before a family lock. Admission/use/logout take `FOR SHARE`;
  actor/status/revocation writers lock all distinct actor/target Principals
  `FOR UPDATE` in ascending UUID order and re-check authorization under those
  locks. Family rows follow in ascending UUID order, then token/audit work.
  Cleanup is governed only by `SESSION-035` through `SESSION-037` and does not
  take a Principal lock.
- `SESSION-022`: SessionFamily admission, validation, touch, rotation, grace,
  and revocation `now` MUST be sampled after the relevant Principal/family
  serialization lock is owned. A transaction-start, pre-wait, application, or
  client timestamp is not valid for those authentication decisions. This rule
  does not move the separately specified throttle or non-blocking cleanup clock.
- `SESSION-023`: `SKIP LOCKED` MUST NOT be used to decide whether a session is
  valid or revoked. It is allowed only for bounded, repeatable cleanup.

## Response-loss and retry consequences

Database commit and HTTP cookie delivery cannot be one atomic transaction.
Hash-only storage also means the database cannot reconstruct a replacement raw
token after it has been sent once.

- If a create transaction commits but its response is lost, an unreachable
  family may remain until it expires and is cleaned. Retrying with a new token
  can create another family because `request_id` is not a command-id.
- If a rotation commits but the `Set-Cookie` response is lost, the browser has
  only the prior token. Its 60-second grace permits already in-flight work but
  cannot reproduce the lost current secret. The browser may need to
  reauthenticate after grace ends.
- If logout commits but the response that clears the cookie is lost, the
  retained browser token is already unusable. The next adapter response should
  clear it without treating denial as an authenticated state.

The 60-second overlap is therefore a concurrency allowance, not guaranteed
recovery or exactly-once delivery. Storing an encrypted raw successor or
silently extending grace would be a different security design and is not
permitted by this ADR.

- `SESSION-024`: Phase 2B.3 MUST explicitly test create, rotation, and logout
  response loss. It MUST present a safe reauthentication outcome and MUST NOT
  claim that grace recovers a lost replacement secret.
- `SESSION-025`: Retrying after an ambiguous response MUST use the documented
  operation semantics. An adapter MUST NOT delete ledger/audit rows, revive a
  token, extend grace, or bypass digest uniqueness to manufacture success.

## Dual-dimension login throttling

The database accepts only two 32-octet keyed pseudonymous fingerprints. Raw IP
addresses, provider subjects, usernames, email addresses, bearer credentials,
and full provider responses never cross this storage boundary.

The future application adapter must derive account and network fingerprints
with a dedicated secret and distinct, versioned domain contexts. That exact
derivation and its test vectors are a Phase 2B.3 gate because Phase 2B.2 does
not yet have the verified provider/ingress inputs. A session-token SHA-256
digest is not a safe fingerprint for enumerable data and the session context
or random secret must not be reused.

The atomic fixed-window policy is:

| Dimension | Allowed attempts | Observation window | Block after next attempt | Success behavior |
|---|---:|---:|---:|---|
| account | 5 | 15 minutes | sixth attempt blocks for 15 minutes | clear this account row only after complete successful login |
| network | 30 | 15 minutes | thirty-first attempt blocks for 15 minutes | never clear on successful login |

Every candidate login reserves both dimensions before external verification.
Existing and unknown accounts follow the same path and outward response. A
request consumes both dimensions even when one already blocks it; otherwise an
attacker can probe the other dimension. While a block is active, retry delay is
the maximum remaining delay across both dimensions and is rounded up to at
least one second. Equality is expired: `now >= blocked_until` may enter the
next normal evaluation.

Each throttle dimension may sample a seed database time only to insert a
previously absent row. After acquiring that dimension's row lock, it samples a
fresh authoritative `clock_timestamp()` for window, block, retry, and update
calculations. Because account is completed before the network lock is acquired,
the two dimensions can legitimately use different lock-owned times. This
prevents a waiter from overwriting a newer timestamp or computing retry from
pre-wait time. `INSERT ... ON CONFLICT DO NOTHING` does not retain a row lock;
if account clear or cleanup deletes that row before the following lock read,
the helper repeats insert-and-lock until it owns a stable row. It never treats
`NOT FOUND` as an allowed, uncounted attempt.

Successful provider verification alone is insufficient to clear the account
row. The Principal must be active and application-session creation must commit.
Only then may the adapter call the account-clear RPC. Network history remains
as defense against one source distributing attempts across accounts.

OWASP recommends associating a failed-login counter with the account rather
than relying only on source IP and warns about denial-of-service tradeoffs.
Cloudflare documents separate IP and IP-with-NAT-support edge characteristics;
for security-critical endpoints such as login, its parameter guide recommends
combining the NAT-supporting characteristic with another characteristic such as
path or a header value. That edge advice is defense in depth, not the source of
this database's account/network model. The exact 5/30 thresholds and 15-minute
windows are repository decisions, not values mandated by those sources.

- `SESSION-026`: Every login candidate MUST consume both account and network
  dimensions before credential verification, including malformed, unknown,
  inactive, rejected, and ultimately successful candidates.
- `SESSION-027`: The account policy MUST allow exactly five attempts per 15
  minutes and block the sixth for 15 minutes. The network policy MUST allow
  exactly 30 and block the thirty-first for 15 minutes.
- `SESSION-028`: `consume_login_attempt` MUST lock account before network and
  update both in one transaction. Each dimension MUST sample its authoritative
  time after its own row lock; the initial insert seed is not a window decision
  time. A row deleted between conflict detection and locking MUST be reinserted
  and locked before evaluation. `allowed` is true only when neither dimension
  is blocked.
  Single-account clear and bounded cleanup are not dual-dimension writers and
  follow their own documented locks.
- `SESSION-029`: A complete successful login MUST clear only its account
  dimension after session creation commits. It MUST NOT clear, shorten, or
  replace the network dimension.
- `SESSION-030`: Fingerprints MUST be exactly 32-byte keyed, versioned,
  domain-separated pseudonyms. Raw or reversibly encoded account/network data
  and session-token digests are forbidden.
- `SESSION-031`: `CF-Connecting-IP` may contribute to the network fingerprint
  only when Cloudflare is the exclusive authenticated path to the origin and
  the origin rejects bypass traffic. Otherwise the adapter MUST use a proven
  trusted ingress source or fail closed. Cloudflare edge limits are defense in
  depth, not a substitute for the database contract.

## Audit and privacy contract

The append-only `app_private.audit_event` table from migration 018 records
session lifecycle state changes in the same transaction as the change:

| Action | When appended | Allowed metadata |
|---|---|---|
| `session.created` | one family is created | empty object |
| `session.rotated` | rotation commits | bounded rotation count only |
| `session.revoked` | one family first becomes revoked by logout, administrative/security action, Principal status, Principal-wide revocation, or retired/expired-grace reuse | constrained reason only (`logout`, `administrator`, `security_event`, `principal_status`, or `token_reuse`); actor semantics are fixed by the RPC table above |
| `session.expired` | cleanup removes one unrevoked family at least 24 hours after its idle or absolute expiry | exactly `idle_timeout` or `absolute_timeout` |

Creation, rotation, and logout use the authenticated family Principal as actor.
An administrator action uses its required active actor. A security event uses
its supplied existing actor or system when null. Principal-status, token-reuse,
and expiry events are system actions with no actor Principal. A Principal-wide
command writes one `session.revoked` event per changed family, all with the same
request ID; it does not compress lifecycle evidence into an aggregate event.

The stable internal family UUID and request UUID are sufficient correlation.
There is no need to record the raw token, digest, throttle fingerprint, network
address, provider namespace, cookie, user agent, or supplied credential.
Throttle rows are short-lived operational counters; Phase 2B.2 does not append
one immutable audit row per failed attempt, which would create a high-volume
privacy and denial-of-service sink. Application telemetry uses aggregate
counts and stable result codes only.

OWASP recommends lifecycle logging while excluding session identifiers and
access tokens from logs. This ADR is stricter: even the stored token digest is
excluded from audit and normal telemetry.

- `SESSION-032`: Each lifecycle audit event MUST commit atomically with its
  state change and exactly once for the first successful transition. A rolled
  back state change MUST leave no audit event, and a failed audit insert MUST
  roll back the state change.
- `SESSION-033`: Session audit and telemetry MUST NOT contain raw tokens,
  digests, fingerprints, IP addresses, provider issuer/subject, credentials,
  cookies, headers, or provider payloads. Audit metadata is restricted to the
  table above.
- `SESSION-034`: Ordinary successful use/touch and each throttle attempt MUST
  NOT create an immutable audit row. Aggregate monitoring MAY count stable
  outcomes without sensitive labels.

## Bounded retention cleanup

Session validity is checked synchronously and does not depend on deletion.
Cleanup is eventual storage hygiene. A family is eligible when it has been
revoked for at least 24 hours or its earliest idle/absolute expiry passed at
least 24 hours ago. Cleanup appends one `session.expired` event atomically in
the same data-modifying statement and transaction that deletes each eligible,
unrevoked expired family; no ordering among sibling data-modifying CTEs is
assumed. Revoked families already have their terminal audit evidence. Deleting
a family cascades only its token lineage. A throttle row is eligible when
`updated_at` is at least 24 hours old and any block has ended. Existing audit
events are not cleanup targets.

`cleanup_app_sessions(limit, request_id)` accepts a per-relation limit from 1
through 1000. It samples one PostgreSQL `clock_timestamp()` before making its
non-blocking `SKIP LOCKED` claims and uses that value for both eligible sets and
expiry audits. One call deletes no more than `limit` eligible families and no
more than `limit` eligible throttle rows. Each target set is selected in
deterministic oldest-first order with `FOR UPDATE SKIP LOCKED`, then deleted in
the same transaction. A row held by live session or throttle work is skipped
rather than delayed or treated as ineligible. Repeated invocations converge;
returned values contain aggregate deleted counts only.

PostgreSQL documents that `SKIP LOCKED` provides an inconsistent view unsuitable
for general-purpose decisions but useful for queue-like consumers. That is
exactly why it is limited to repeatable cleanup here.

- `SESSION-035`: A row MUST NOT become cleanup-eligible before exactly 24 hours
  after terminal family revocation, the earliest idle/absolute expiry, or stale
  throttle activity as applicable; equality is eligible and actual deletion is
  eventual. Cleanup MUST NOT remove a live family, a currently blocked
  throttle, or an existing audit row. Removing an unrevoked expired family and
  appending exactly one privacy-safe `session.expired` event MUST be one atomic
  statement/transaction: either both effects commit or neither does. No physical
  execution order among sibling data-modifying CTEs is part of the contract.
- `SESSION-036`: `cleanup_app_sessions(limit, request_id)` MUST reject limits
  outside 1–1000, delete at most `limit` families and `limit` throttle rows,
  sample one database time before its non-blocking claims, use deterministic
  ordering and `FOR UPDATE SKIP LOCKED`, and finish in one transaction. Callers
  MAY repeat bounded batches; they MUST NOT obtain an unbounded delete path.
- `SESSION-037`: Cleanup MUST be safe under concurrency with use, rotation,
  revocation, and another cleanup worker. A locked row is skipped for a later
  run, not waited on, partially deleted, or reported as a session decision.

## ACL and exposure boundary

The three tables enable RLS with no policies. Schema, relation, sequence, and
private-function privileges are revoked from `PUBLIC`, `anon`,
`authenticated`, `club_admin`, and `service_role` when those roles exist.
Table ownership and migration identities are operational powers, not product
authorization.

Private implementations are `SECURITY INVOKER`. Public wrappers are
`SECURITY DEFINER`, use a fixed trusted `search_path`, schema-qualify objects
and operators, call `app_private.require_rpc_role(array['service_role'])` in
their own body, and expose only the minimum transport-compatible SQL
`EXECUTE`. No `anon`, `authenticated`, or `club_admin` claim may pass a wrapper.
The repository's dedicated loopback-only `admin_authenticator` remains the
local test stand-in for the same service policy; it is not a production gateway
claim, end-user role, or ownership bypass.
PostgreSQL notes both the hostile-`search_path` risk and the default `PUBLIC`
execute grant for new functions; migration 019 creates and revokes these
objects in its single transaction.

- `SESSION-038`: Request roles MUST have no direct usage, read, write,
  truncate, reference, trigger, sequence, or private-function privilege for
  session foundations. RLS is defense in depth and MUST NOT be treated as a
  substitute for revocation.
- `SESSION-039`: Every public wrapper MUST have a fixed trusted `search_path`,
  an exact in-body `service_role` claims guard, a private invoker
  implementation, explicitly revoked default execute, and a tested
  least-privilege transport grant. No other gateway claim is authorized; the
  dedicated local `admin_authenticator` may act only as the repository's
  loopback test stand-in for that same policy.
- `SESSION-040`: No public view, relation, RPC result, error distinction, or
  gateway schema description may expose a raw token, digest, fingerprint, or
  arbitrary Principal/session existence to an untrusted caller.

## Migration, rollback, and Phase 2B.3 gates

Migration 019 is one append-only expand file and one runner-owned transaction.
It creates no contract migration and no down migration. A late statement
failure rolls back every 019 object and its ledger insert. Once applied, the
file and normalized checksum are immutable.

Application rollback leaves migration 019 installed and unused. A schema
defect is repaired by a new forward migration, normally 020. Dropping private
tables, purging their rows, editing the ledger, or changing the applied 019
file is not an application rollback.

- `SESSION-041`: Migration 019 MUST pass fresh install, 018-to-019 upgrade,
  legacy-012 adoption-to-head, replay, checksum, late-failure rollback, and
  concurrent-runner tests. Every path MUST prove empty 019 state and unchanged
  legacy behavior.
- `SESSION-042`: Migration 019 MUST have no down or contract migration.
  Application rollback keeps its schema and ledger inert; a database defect is
  corrected by an append-only 020-or-later forward fix.
- `SESSION-043`: Phase 2B.3 MUST not enable application sessions until token
  vectors, cookie attributes, CSRF, cache no-store, provider verification,
  active-Principal admission, dual-dimension fingerprints, response loss,
  expiry boundaries, concurrent rotation/revocation, cleanup scheduling,
  gateway ACLs, and old/new cookie transition all have deterministic tests.
- `SESSION-044`: Phase 2B.3 MUST define a fail-closed precedence and retirement
  plan for the legacy cookie. An invalid, expired, revoked, or replayed
  application token MUST NOT silently fall back to a weaker legacy credential.
- `SESSION-045`: For each future `use_app_session` call, the adapter MUST retain
  the raw replacement candidate only in request-local memory. It MUST set that
  candidate as the cookie only when the matching RPC result is `rotated`; on
  `active`, `grace`, denial, or error it MUST discard the candidate and MUST
  NOT create a cookie value whose digest the database did not install.
- `SESSION-046`: Migration 019 intentionally imposes no per-Principal active
  SessionFamily limit. Before Phase 2B.3, the product MUST choose and test a
  device/session cap or explicitly accept unbounded concurrent families and
  their abuse/storage risk. A database-enforced cap requires an append-only 020
  or later migration; an agent MUST NOT edit 019 or infer a cap from its active
  index, expiry, throttle, or cleanup behavior.
- `SESSION-047`: A constraint failure involving a supplied or stored token
  digest or throttle fingerprint MUST be caught before it crosses the private
  RPC boundary and rethrown with a stable generic message containing no
  PostgreSQL `DETAIL`, `HINT`, digest, fingerprint, or rejected input. The
  Phase 2B.2 SQL regression MUST inspect SQLSTATE, message, `DETAIL`, `HINT`, and
  `CONTEXT` for reachable token and throttle failures, not only the primary
  message. Because this inert release has no application caller, Phase 2B.3
  MUST additionally capture and inspect adapter, HTTP, application, and CI
  failure output before any session RPC receives traffic.

## Source basis and inference boundary

The decision uses these primary or standards-community sources:

- [NIST SP 800-63B-4, Session Management](https://pages.nist.gov/800-63-4/sp800-63b/session/)
  for random session secrets, server-enforced overall/inactivity timeout,
  logout, protected transport, cookie minimization, and privacy assessment;
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
  for opaque CSPRNG identifiers, idle/absolute/renewal timeouts, rotation-race
  awareness, revocation, and session lifecycle logging;
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
  for account-oriented login throttling and denial-of-service tradeoffs;
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
  for excluding session IDs, access tokens, credentials, and sensitive
  personal data from logs;
- [RFC 9700 section 4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2)
  for the security rationale behind retaining rotation relationships and
  detecting reuse;
- [W3C Web Cryptography Level 2, `getRandomValues`](https://www.w3.org/TR/webcrypto-2/#Crypto-method-getRandomValues)
  for the runtime secure-random primitive;
- [Cloudflare request headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
  and [rate-limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)
  for the Cloudflare ingress boundary and the recommendation to combine
  characteristics for security-critical edge rate limits; and
- PostgreSQL's [explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html),
  [`SELECT ... SKIP LOCKED`](https://www.postgresql.org/docs/current/sql-select.html),
  [row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
  and [safe `SECURITY DEFINER` functions](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)
  for serialization, cleanup, RLS, and wrapper ACL behavior.

RFC 9700 governs OAuth refresh tokens, not this application's session cookie.
Its rotation-family and replay-detection model is an explicit analogy, not a
claim that an application SessionToken is an OAuth refresh token or that this
design implements OAuth sender constraint. NIST and OWASP do not mandate this
repository's 30-minute idle, eight-hour absolute, 15-minute rotation,
60-second grace, 5/30 throttle thresholds, 24-hour retention, 1000-row maximum,
token prefix, digest context, schema names, or SQL API. Those are reviewed
repository choices frozen by the `SESSION-NNN` rules above.

## Verification and consequences

Deterministic tests must prove canonical token vectors, 32-octet digest-only
storage, exact boundary comparisons, exact touch, rotation lineage, response
loss behavior, inactive-Principal denial, idempotent revocation, replay-family
revocation, dual-dimension quotas, success clearing only account state,
transactional audit, bounded concurrent cleanup, ACL/claims denial, migration
atomicity, and operation linearizability under proven lock waiters.

The design accepts a database write on every successful authenticated request
and the operational cost of serialized family mutation. That cost is the price
of the exact idle contract and deterministic rotation/revocation ordering; an
agent must not introduce sampled touch, a persistent cache, asynchronous
write-behind, or edge-only session validation as an optimization.

Phase 2B.2 intentionally does not solve participant UI, role/ownership command
authorization, device-bound credentials, OAuth sender constraint, account
recovery, multi-factor authentication, session management UI, or legacy-cookie
retirement. It also does not limit active families per Principal. Those require
later decisions without weakening this storage and privacy boundary.
