# ADR 0005: Application-session cutover and administrator admission

- Status: Accepted
- Date: 2026-08-28
- Tracking: [#13](https://github.com/Egger0/cs2cup/issues/13)
- Scope: Phase 2B.3
- Depends on: [ADR 0002](0002-domain-identity-foundations.md),
  [ADR 0003](0003-explicit-cache-boundaries.md),
  [ADR 0004](0004-revocable-session-foundations.md)

The uppercase terms **MUST**, **MUST NOT**, **SHOULD**, and **SHOULD NOT** have
the meanings in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174). Stable rules use
`CUTOVER-NNN` identifiers. Later decisions may supersede a rule but MUST NOT
renumber or silently reuse its identifier.

## Context and audited repository facts

The current administrator path stores a CloudBase access token directly in
`cs2cup_session`. [`lib/jwt.ts`](../../lib/jwt.ts) either verifies a configured
local OIDC/JWKS issuer or calls CloudBase `/auth/v1/user/me`, then returns only
an unqualified `sub`. [`lib/auth.ts`](../../lib/auth.ts) and the login action
authorize that bare subject through `public.admin_user.user_id`. The Proxy
checks the provider token but not the administrator allowlist; the layout and
each Server Action perform their own later check. Logout only deletes the
browser cookie.

The Phase 2A and 2B.2 foundations deliberately do not make this path safe to
cut over by themselves:

- `ensure_principal_identity` resolves an identity but does not prove that it
  belongs to an administrator, and it may return a suspended Principal;
- migration 019's generic `create_app_session` has no administrator allowlist
  check and no active-family limit;
- `use_app_session` validates and touches a family but does not authorize the
  Principal for an administrator request;
- a separate unguarded application `admin_user` table lookup would duplicate
  authorization policy outside the service RPC boundary;
- validating once in Proxy and again in a layout/action would write and
  potentially rotate the same session twice in one HTTP request; and
- Server Components can read cookies but cannot reliably deliver a rotated
  `Set-Cookie` response. Next.js documents cookie mutation as a Server
  Function, Route Handler, or response-bound operation.

The current fallback provider verifier also parses `sub` from the access-token
payload without cryptographically validating that payload. A successful
`user/me` call proves that CloudBase accepted the bearer, but the current code
does not compare its returned subject to the token subject, does not call token
introspection, does not check the environment `client_id`, and does not return
the exact verified issuer required by ADR 0002.

These are repository findings, not allegations about CloudBase. CloudBase's
current official documentation describes password sign-in, introspection,
`user/me`, token lifecycle, refresh, sign-out, and PG-mode JWT claims. It does
not prove how this repository's actual staging environment is configured or
that its example issuer and discovery behavior are the values observed there.

- `CUTOVER-001`: An application session MUST NOT become administrator
  authority through a composition of the migration 018 resolver, migration
  019 generic creator/use RPC, and a direct application allowlist query.
  Admission requires migration 020's atomic boundary; each normal request
  requires the strict service-RPC sequence defined below.
- `CUTOVER-002`: A bare provider subject, a successful provider request, a
  Principal row, a populated bridge, or an application SessionFamily alone is
  not administrator authority.

## Delivery slices and inert default

Phase 2B.3 is split into independently reviewable changes:

| Slice | Included | Traffic and authority |
|---|---|---|
| **2B.3a** | This ADR/runbook, append-only migration 020, pure production-remote CloudBase proof plus portable fingerprint/session/cookie/CSRF adapters, fail-closed mode parser, and deterministic database/unit tests | The parser's unit contract maps absence to `legacy` and rejects every malformed value, but it is not wired to startup or ordinary traffic. The image remains behaviorally legacy because none of the new adapters is wired. |
| **2B.3b** | Explicit dev/test-local `VerifiedProviderProof` adapter, startup mode wiring, Proxy as the one touch/rotation owner, login/logout/DAL integration, dual-cookie bridge wiring, signed request attestation, and browser/concurrency/response-loss tests | Still deploys with absent or exact `legacy` and remains cutover-inert until the 2B.3c gate. After wiring, malformed mode configuration fails startup. Production builds/configuration cannot select the local proof adapter. |
| **2B.3c** | Staging proof, cleanup scheduler, fleet-wide bridge enablement, canary, drain, `application` mode, observation, and reviewed legacy-code retirement | The only slice allowed to send session traffic. Each state transition follows the companion runbook. |

The configuration has exactly three values:

```text
SESSION_AUTH_MODE=legacy | bridge | application
```

In 2B.3a, unit tests prove that the pure parser maps an absent setting to
`legacy` and rejects every present unknown, differently cased,
whitespace-padded, or empty value; the parser is not yet an application startup
gate. Phase 2B.3b wires it into startup, where the same malformed values become
startup/configuration failures rather than implicit fallback. All live
instances in one environment must then report the same non-secret mode and
release digest before a transition.

- `CUTOVER-003`: Ordinary Phase 2B.3a and 2B.3b traffic MUST remain behaviorally
  legacy. Migration/adapters may be deterministically tested only in disposable
  databases; production ordinary traffic MUST leave 018–020 identity/session
  state untouched.
- `CUTOVER-004`: No operator may enable `bridge` or `application` merely because
  code or migration 020 is deployed. Every staging, browser, ingress, cache,
  concurrency, rollback, and evidence gate in the runbook is separately
  required.
- `CUTOVER-005`: A mode transition is deployment-wide. Mixed `legacy` and
  `bridge` instances are forbidden after a new application cookie can be
  issued because an old path cannot consume that cookie safely.

## Provider verification contract

### Production CloudBase proof

The production adapter identifier is exactly `cloudbase`. Its expected issuer
is an exact, case-sensitive deployment value supplied as
`CLOUDBASE_IDENTITY_ISSUER`. The adapter does not trim it, remove a trailing
slash, change case, derive it from `CLOUDBASE_ENV_ID`, or synthesize it from the
gateway hostname. `CLOUDBASE_ENV_ID` and the issuer are separate configuration
facts.

As an additional repository fail-closed constraint, the pin must be an exact
canonical HTTPS URL without user information, query, or fragment, and its
origin must exactly equal the official environment gateway origin. This URL
shape check does not establish the issuer: independent target-staging evidence
must still approve the exact pin. CloudBase documentation is not cited as
mandating this extra constraint.

A password candidate follows one bounded, no-store remote proof:

1. `POST /auth/v1/signin` with only the documented username/password fields
   obtains an access token and sign-in `sub`.
2. `GET /auth/v1/token/introspect` sends that bearer; the result must be
   non-empty, its `token_type`
   must be `Bearer`, its `client_id` must exactly equal
   `CLOUDBASE_ENV_ID`, and it must contain a valid exact string `sub`.
3. `GET /auth/v1/user/me` sends the same bearer; its
   `status` must be exactly `ACTIVE` and its `sub` must be a valid exact string.
4. The sign-in, introspection, and profile `sub` values must be byte-for-byte
   equal.

The exact issuer is not parsed from unverified access-token claims. It comes
only from the separately reviewed, target-staging observation pinned in
`CLOUDBASE_IDENTITY_ISSUER`. Runtime proof returns the tuple composed from that
approved pin and the three equal remote subjects. If staging cannot establish
the issuer authoritatively, cutover stops rather than deriving it.

CloudBase documents that introspection validates a non-expired, non-revoked
token and returns `client_id` and `sub`; `user/me` requires a valid access
token and returns `sub` and account status; its PG authentication guide shows
JWT `iss`, `sub`, `aud`, and `role` claims. The repository's requirement to use
all three subject observations, exact `client_id`, and exact pinned issuer is
defense in depth. It is not a CloudBase-mandated sequence.

Each provider request uses the official environment gateway origin, explicit
method, `cache: 'no-store'`, `redirect: 'error'`, a bounded abort deadline, a
bounded JSON body, and no automatic retry. A provider timeout, redirect,
non-2xx response, malformed body, empty introspection, field mismatch, inactive
status, or unavailable exact issuer is the same generic authentication failure
to the browser. Provider response text and error bodies are not forwarded.

The access token and any refresh token remain request-local secret material.
The adapter parses only the fields needed for proof, never returns either token
from its public result, never places one in an application cookie, and never
stores one in PostgreSQL, a cache, a closure sent to the client, an exception,
or telemetry. In `bridge`, pre-existing legacy cookies are a bounded
transition exception; no 2B.3 sign-in writes a new legacy provider-token
cookie. The adapter does not refresh or sign out that transient provider token;
it discards it after proof. CloudBase's token-lifecycle, refresh, and sign-out
documentation establishes provider behavior and the legacy retirement context,
not an extra request in the new admission flow.

- `CUTOVER-006`: Production sign-in MUST complete the exact remote double proof
  and subject/client/active checks above. One endpoint, local payload parsing,
  the sign-in response alone, or a database `sub` is insufficient.
- `CUTOVER-007`: The exact issuer is a staging/deployment evidence gate. An
  official example, gateway naming convention, environment ID, or inferred URL
  MUST NOT be copied into `principal_identity.issuer` as verified fact.
- `CUTOVER-008`: The existing [`lib/jwt.ts`](../../lib/jwt.ts)
  discovery/JWKS fallback remains a legacy-session path; it does not implement
  or satisfy the new `VerifiedProviderProof` contract. Phase 2B.3b MUST add an
  explicitly selected dev/test-local proof adapter and prove that production
  builds/configuration cannot select it. Discovery/JWKS availability never
  substitutes for the production remote proof or staging issuer evidence.
- `CUTOVER-009`: New login code MUST keep provider access/refresh tokens
  request-local, no-store, non-serializable to the client, and redacted. It MUST
  not refresh or persist a provider token after application-session creation.
- `CUTOVER-010`: Provider proof produces only the exact tuple
  `(cloudbase, expectedIssuer, verifiedSubject)`. Provider groups, roles,
  profile fields, email, phone, username, and JWT `is_system_admin` are not
  product authorization.

### Phase 2B.3b local verification adapter

Phase 2B.3a adds no local implementation of `VerifiedProviderProof`.
[`lib/jwt.ts`](../../lib/jwt.ts) and the issuer served by
[`scripts/dev-session.mjs`](../../scripts/dev-session.mjs) support the existing
legacy path only and are not evidence that the new contract has a local
adapter.

Phase 2B.3b must add an explicit dev/test-only adapter that returns the same
minimal `(provider, issuer, subject)` proof shape from visibly local, synthetic
OIDC/JWKS fixtures with exact issuer, audience, expiry, signature, and subject
checks. Selection uses a dedicated explicit provider mode, never the presence
of `CLOUDBASE_IDENTITY_ISSUER` or another issuer variable. Deterministic tests
must prove the adapter is unavailable when `NODE_ENV=production` and cannot be
selected by a production build/configuration.

## Migration 020: atomic admission and guarded administrator authorization

Migration 020 is an append-only expand migration. It does not edit migrations
018 or 019, backfill `admin_user.principal_id`, create an identity/session, or
change an old image's behavior merely by being applied. It adds guarded public
wrappers with private `SECURITY INVOKER` implementations under the same
`service_role` claim, fixed-search-path, RLS, and ACL contract as ADR 0004.

The exact guarded interfaces are:

```text
public.admit_admin_app_session(text,text,text,bytea,uuid)
public.authorize_admin_principal(uuid)
```

### Atomic administrator admission

`admit_admin_app_session` accepts the exact verified provider tuple, a new
32-byte token digest, and a request UUID. In one transaction it:

1. validates the digest and request UUID before taking an admission lock;
2. locks the exact legacy `admin_user.user_id = verified subject` row;
3. invokes `app_private.ensure_principal_identity`, which then validates the
   provider/issuer/subject namespace and resolves or creates the AuthIdentity
   and Principal under the resolver's exact identity advisory/row
   serialization, without treating a request UUID as an idempotency key;
4. either links the locked row's null `principal_id` to that Principal or
   requires the existing link to be exactly equal;
5. takes the Principal's exclusive admission lock;
6. requires the Principal to remain `active`;
7. at a fresh database time, counts live families for that Principal; and
8. only when fewer than five are live, creates the family/current digest and
   `session.created` event using the exact ADR 0004 lifetime contract.

Migration 020 does not hard-code `provider = 'cloudbase'`. The existing
`app_private.ensure_principal_identity` resolver validates the
provider/issuer/subject namespace generically; the current application
provider adapter is the layer that produces only a verified `cloudbase` tuple.
A later adapter must satisfy the same resolver and reviewed proof contract
rather than require a database rewrite.

Expected policy denials—no matching allowlist row, a deleted/inactive
Principal, an incompatible administrator bridge, or the five-family cap—roll
back the internal subtransaction and return only `{"ok":false}`. They produce
the same generic login failure as invalid credentials and leave no new
Principal, AuthIdentity, bridge, session, token, or audit evidence.

An invalid digest/request-ID contract input, digest collision, invalid
resolver/constraint input, unexpected constraint violation, RPC transport
failure, or other database exception is not converted to `ok:false` and is not
described as an invalid-password result. It is an operational failure: the
transaction fully rolls back and the application returns private no-store 503
with no Set-Cookie. Monitoring exposes only admission success, generic policy
denial, and operational failure. Restricted operations may inspect aggregate
cap health, never a per-attempt cap-reason signal or identity label.

A family is live for the cap exactly when, at the lock-owned database time:

```text
revoked_at is null
and now < idle_expires_at
and now < absolute_expires_at
```

Equality is not live. Expired rows do not consume a slot while awaiting
cleanup. Concurrent admission for one Principal is serialized by an exclusive
Principal lock, so no sixth live family can commit. Phase 2B.3 creates only
administrator families; before participant session admission ships, its ADR
must decide whether this Principal-wide cap remains shared or gains an
explicit session-purpose dimension.

### Ordered session use and administrator authorization

A normal application-cookie request uses two guarded RPCs in strict order:

```text
use_app_session(presented digest, replacement digest, request UUID)
  -> only on success, authorize_admin_principal(returned Principal UUID)
  -> only when authorized=true, issue the request attestation
```

`use_app_session` remains the atomic migration 019 state machine and sole
touch/rotation. `authorize_admin_principal(uuid)` is a separate stable service
RPC returning only `{"ok":true,"authorized":boolean}` after checking an exact
`admin_user.principal_id` bridge and active Principal. The adapter does not
reverse the order, authorize after a denied use, query `admin_user` directly,
or attest unless both calls succeed. Authorization false denies and clears the
request credentials. These are deliberately two transactions; this ADR does
not claim atomicity across session use and administrator authorization. A
family can therefore be touched before a concurrent authority loss is observed
by the second RPC, but the request receives no attestation or administrator
access.

The bridge is administrator authority only through this guarded RPC. A
`role_assignment`, provider group, service-role transport credential, or stale
request attestation does not substitute for it. Direct operator changes to an
administrator bridge during cutover are prohibited; a later administration
command must be designed against migration 020's lock order.

Admission's exact write-lock order is administrator row, identity resolver
advisory/identity row, then exclusive Principal, then SessionFamily/token/audit.
There is currently no Principal-to-admin write path. A future migration MUST
NOT introduce a reverse Principal-to-admin writer; it must extend this order or
replace all affected paths together with deterministic deadlock tests.

- `CUTOVER-011`: Migration 020 MUST admit an administrator identity, link its
  bridge, enforce active Principal state, enforce the five-live-family cap,
  create the family, and append audit in one transaction. No application-side
  sequence may claim equivalent atomicity.
- `CUTOVER-012`: A request MUST call guarded `use_app_session` exactly once,
  then guarded `authorize_admin_principal` exactly once only after successful
  use. These are separate transactions; authorization false denies without an
  attestation. A direct application allowlist query is forbidden.
- `CUTOVER-013`: The cap is exactly five live families per Principal and is
  enforced under an exclusive Principal lock. The sixth live admission fails;
  it does not evict an existing family, extend an expiry, or reuse a token.
- `CUTOVER-014`: Migration 020 MUST preserve its admin-row → identity →
  Principal → family ordering, preserve the policy-denial/operational-failure
  boundary above, redact all digest/identity diagnostics, retain the 019 audit
  contract, and pass fresh, upgrade, replay, late-failure, and real waiter
  concurrency tests. Future writers MUST NOT introduce the reverse Principal
  → admin-row order.

### Phase 2B.3a session RPC adapter boundary

The unwired session adapter applies one abort deadline to every RPC. Its
default is exactly 5,000 milliseconds; an override must be a safe integer in
`1..30000` milliseconds. Deadline expiry aborts the transport. Every rejection
at this boundary—including a timeout, PostgREST/database diagnostic, arbitrary
error, or already constructed and subsequently mutated session-service
error—is replaced by a new fixed `SessionStoreError('unavailable')` without a
`cause`. The original object and message never cross the adapter boundary.
Policy responses such as `{"ok":false}` remain parsed results rather than
transport errors.

Successful session envelopes require UUID-shaped session and Principal IDs and
calendar-valid RFC 3339-style timestamps: a four-digit non-zero year, real
Gregorian month/day, `00..23` hour, `00..59` minute/second, optional one-to-six
digit fractional seconds, and `Z` or a bounded numeric offset. The adapter also
requires idle and rotation deadlines not to exceed the absolute deadline. A
login-throttle response accepts only a safe-integer `retryAfterSeconds` in
`0..900`: an allowed result requires exactly zero, while a denied result
requires `1..900`. Shape, range, calendar, clock, or ordering drift becomes the
same fixed invalid-service-response error and grants no authority.

These are deterministic 2B.3a adapter facts. They do not claim that ordinary
requests call the adapter, that a 2B.3b Proxy owns rotation, or that a browser
received any cookie.

## Login throttling and portable fingerprints

Every syntactically received login candidate consumes migration 019's account
and network dimensions before contacting CloudBase, including blank,
oversized, malformed, unknown, inactive, non-admin, provider-failed, capped,
and ultimately successful candidates.

`LOGIN_FINGERPRINT_SECRET` is a dedicated secret containing at
least 32 independently random bytes. It is not the registration fingerprint
secret, session token, attestation secret, service-role credential, or an
environment ID. Web Crypto HMAC-SHA-256 derives exactly 32 bytes:

```text
account = HMAC-SHA-256(
  secret,
  UTF-8("cs2cup:login-account-fingerprint:v1\0")
  || UTF-8(accountMaterial)
)

network = HMAC-SHA-256(
  secret,
  UTF-8("cs2cup:login-network-fingerprint:v1\0")
  || UTF-8(networkMaterial)
)
```

For a non-empty candidate of at most 512 UTF-8 bytes with no control character,
`accountMaterial` is `valid\0` plus the exact submitted value. It is not
trimmed, case-folded, Unicode-normalized, interpreted as email/phone, or
replaced with a verified subject. Every invalid, blank, control-bearing, or
oversized candidate uses the one constant material `invalid`, so malformed
input still consumes a shared account bucket without unbounded HMAC input.

`networkMaterial` is exactly `ipv4:<canonical dotted decimal>` for IPv4 and
IPv4-mapped IPv6, or `ipv6-64:<16 lowercase hexadecimal characters>` for the
first 64 IPv6 bits. Comma-separated, zone-qualified, bracketed, malformed, or
untrusted address input fails closed. The implementation uses portable Web APIs
rather than `node:crypto` or `node:net`.

`LOGIN_CLIENT_IP_SOURCE=cf-connecting-ip` is accepted only after the Cloudflare
ingress gate below.
Until then, a deployment uses one separately proven ingress-owned source or
fails closed. Browser-provided forwarding chains are not fallbacks.

Account throttle is cleared only after provider double proof, atomic admin
admission, and cookie response construction all
succeed. Network history is never cleared by login success. If response
delivery is lost after the clear, the family remains subject to the
response-loss contract rather than having the account counter reconstructed.

- `CUTOVER-015`: Login fingerprint derivation MUST use the exact versioned,
  domain-separated Web Crypto construction and independent secret above, with
  published synthetic test vectors. Raw account/network data and fingerprints
  MUST NOT enter logs, audit, cookies, metrics, or release evidence.
- `CUTOVER-016`: Both throttle dimensions MUST commit before any provider
  request. A throttle failure, missing trusted address, or unavailable HMAC
  primitive fails closed and performs no provider verification.
- `CUTOVER-017`: Only complete login success clears the account dimension;
  provider success, allowlist success, or session creation alone does not.

## Application cookie and transition state machine

The application cookie is exactly:

```text
name:     __Host-cs2cup-session
value:    canonical v1.<43-character base64url application token>
Secure:   true
HttpOnly: true
SameSite: Strict
Path:     /
Domain:   absent
Priority: High
Partitioned: absent
Expires:  exact authoritative SessionFamily absolute_expires_at
Max-Age:  floor((absolute_expires_at - response_time) / 1000)
```

No code path conditionally removes `Secure`, including local browser tests;
tests use a browser context that can prove the production attribute contract.
`__Host-` plus `Secure`, root path, and no Domain prevents a less specific
domain/path cookie from replacing this name. `SameSite=Strict` is a reviewed
compatibility choice and defense in depth, not the CSRF authorization check.
`Max-Age` is computed at response construction and floored so it can never
outlive `Expires`; an already-passed or sub-second deadline is not serialized.
The deletion helper retains Secure, HttpOnly, SameSite=Strict, Path=/, and
Priority=High, with no Domain or Partitioned attribute, and sets the Unix epoch
plus `Max-Age=0`.
The cookie carries no Principal, family ID, role, provider claim, or expiry
field. PostgreSQL remains authoritative when the browser retains or drops it
at a different instant.

Rotation sets the exact request-local replacement only for an atomic session-use
result of `rotated` followed by `authorized:true`. Its cookie retains the same family absolute
expiry returned by PostgreSQL. `active` and `grace` retain the presented
cookie. Malformed credentials and definite `ok:false` session or
`authorized:false` results clear both cookie names. A session RPC transport,
timeout, or malformed-service-response error returns private no-store 503 for
the current request, grants no authority, performs no fallback, and installs no
replacement, but preserves the existing cookies for bounded retry. Cookie
serialization failure after a committed rotation is response loss, never
permission to install another secret or extend grace.

The legacy name remains exactly `cs2cup_session`. The modes are:

| Mode and presented cookies | Authentication result | Cookie mutation |
|---|---|---|
| `legacy`, new present with legacy | preserve old-version semantics: ignore new and authenticate legacy | current legacy behavior; do not consume/rotate new |
| `legacy`, new only | unauthenticated because legacy is absent | ignore new; do not consume/rotate it |
| `legacy`, legacy only | current provider-token behavior | current legacy behavior only |
| `bridge`, new present (with or without legacy) | authorize only through migration 020 | on success rotate/retain new and clear legacy; definite denial clears both; operational failure preserves both and sets no replacement |
| `bridge`, legacy only | verify the existing provider credential and current `admin_user.user_id` allowlist | accept temporarily; do not mint lazily and do not refresh/reissue legacy |
| `bridge`, no cookie | unauthenticated | new successful sign-in sets only the new cookie |
| `application`, new present | authorize only through migration 020 | on success rotate/retain new and clear legacy; definite denial clears both; operational failure preserves both and sets no replacement |
| `application`, legacy only or none | unauthenticated | clear legacy; require new sign-in |

A new cookie always wins in `bridge` and `application`. In those modes, a
malformed credential or definite invalid, expired, revoked, or replayed result
clears both names and never falls back to a valid legacy cookie. An operational
session-service error likewise grants no authority, fallback, or replacement,
but returns private no-store 503 and preserves both cookies for bounded retry.
The bridge never lazily
creates a SessionFamily from a legacy cookie: a lost response could otherwise
create one unreachable family per request and consume the cap. New sign-ins in
`bridge` produce only an application cookie, so every pre-2B.3 image must drain
before bridge enablement.

- `CUTOVER-018`: The new cookie name and attributes are exact. No Domain,
  non-root Path, non-Secure environment branch, JavaScript-readable value, or
  expiry beyond the database absolute deadline is permitted.
- `CUTOVER-019`: New-cookie presence is fail-closed precedence in `bridge` and
  `application`. `legacy` deliberately preserves old-image behavior by
  ignoring the new name and is therefore not a safe rollback mode after bridge
  has issued a new-only cookie.
- `CUTOVER-020`: Bridge accepts only pre-existing legacy-only sessions and
  never issues, refreshes, or converts one lazily. Every bridge sign-in emits
  only the new application cookie and clears legacy state.
- `CUTOVER-021`: Pre-2B.3 application images MUST be completely drained before
  `bridge`; they are not a valid rollback target after the first new-only
  cookie is issued.

## One touch owner and request-bound attestation

Proxy is the sole application-session use/touch/rotation owner for an external
HTTP request. Its reviewed matcher covers every administrator page and Server
Action request plus authorization-sensitive media. A request carrying an
application cookie is used at most once through migration 019, then checked at
most once through migration 020's administrator RPC. Proxy then either
clears/rotates the response cookie and injects one private
request-only attestation, or denies/continues anonymously according to the
route contract.

This is a deliberate repository choice despite Next.js guidance that Proxy is
normally best for optimistic checks rather than complete session management.
Here Proxy does not grant authority by itself: it orchestrates the ordered
service checks, owns the only response on which a
rotation cookie can be delivered, and passes cryptographic evidence to the
same request's downstream authorization check. Every Server Action still calls
`requireAdmin`; that function verifies the attestation and never treats an
unsigned header or Proxy redirect as authority.

The attestation uses a separate, minimum-32-byte
`SESSION_ATTESTATION_SECRET` and Web Crypto HMAC-SHA-256. Proxy deletes every
client-supplied header with the reserved prefix before work. On success it
creates a canonical, base64url-encoded payload with exactly:

```text
version = 1
requestId = fresh UUID
issuedAt = integer epoch milliseconds
expiresAt = issuedAt + 30000
requestClass = admin-page | admin-action | private-media
principalId = internal UUID
sessionId = internal UUID
credentialKind = application | legacy
```

The MAC input is domain separated and bound to the exact credential presented
on the incoming request without placing that credential in the payload:

```text
HMAC-SHA-256(
  attestationSecret,
  UTF-8("cs2cup-request-attestation-v1\0")
  || UTF-8(presentedRawCredential) || 0x00
  || canonicalPayloadBytes
)
```

The internal header contains only `v1.<payload>.<unpadded base64url MAC>`.
Downstream verification requires canonical encoding, a known request class, a
matching cookie selected by `credentialKind`, constant-time MAC comparison,
`issuedAt` no more than five seconds in the future, and `now < expiresAt`.
Callers pass the expected request class explicitly. The header is never copied
to a response, subrequest, browser, log, trace, analytics event, or cache key.

Attestation is safe only while all external traffic crosses the stripping
Proxy and direct origin access is impossible. It is not a bearer API token,
cross-request session, cache entry, queue message, or authorization result that
may be stored. React request memoization may reuse the already verified
attestation within the same render/request; persistent or module-level caching
is forbidden.

- `CUTOVER-022`: One external request causes at most one
  `use_app_session` call and therefore at most one touch/rotation.
  Layouts, Server Components, Route Handlers, and Server Actions MUST consume
  the signed attestation instead of calling a session-use RPC again.
- `CUTOVER-023`: Proxy MUST overwrite reserved inbound headers and bind a
  30-second attestation to the exact incoming credential and request class.
  Missing, expired, future, malformed, wrong-class, wrong-cookie, or invalid-MAC
  evidence is unauthenticated.
- `CUTOVER-024`: Attestation headers and secrets are private no-store data and
  MUST never leave the same request. Origin isolation and header stripping are
  cutover gates, not optional hardening.

## CSRF and mutation contract

Every login, logout, and administrator mutation is POST-only. GET, HEAD,
prefetch, render, image, and query-string navigation never mutate authentication
or domain state. Each browser mutation independently requires:

- an exact `Origin` equal to the configured canonical public application
  origin, including scheme, host, and non-default port; only when `Origin` is
  absent may an exact same-origin `Referer` supply the origin check;
- Next.js's Origin-to-Host or Origin-to-`X-Forwarded-Host` Server Action check,
  with only exact reviewed `serverActions.allowedOrigins` if a reverse proxy
  makes configuration necessary—never `*` or a broad suffix;
- if `Sec-Fetch-Site` is present, the exact value `same-origin`;
- validated form/action input; and
- for every action except login, a valid request-bound administrator
  attestation of class `admin-action`.

A present `Origin` never falls back to `Referer`: a mismatched, malformed, or
literal `null` Origin is rejected. If Origin is absent, an absent, malformed,
or cross-origin Referer is rejected. Origin and Referer both missing therefore
deny. Scheduler and service operations use separate service credentials and
routes; they are not exempt browser calls. SameSite, an opaque Server Action identifier, a hidden
field, button visibility, or an unforgeable-looking URL is not CSRF
authorization. Login uses the same rule to prevent login CSRF. Logout clears
both cookies on every outward response even when database revocation is
unknown or fails; a cross-origin request cannot invoke it.

Next.js documents that Server Actions are public HTTP endpoints, compare
Origin with Host/forwarded host, and still require authorization at the action.
OWASP recommends origin verification and SameSite as layers rather than
replacing a CSRF defense.

- `CUTOVER-025`: Every browser mutation MUST enforce exact same-origin POST at
  the application boundary, including login and logout: exact Origin first,
  then exact same-origin Referer only when Origin is absent. A null, malformed,
  or mismatched Origin, an unavailable/invalid fallback, or non-same-origin
  `Sec-Fetch-Site` fails before a provider, session, or domain mutation.
- `CUTOVER-026`: Every administrator Server Action MUST still call
  `requireAdmin` and validate its input. Proxy, action IDs, and UI reachability
  are not action authorization.
- `CUTOVER-027`: Cross-origin form, fetch, text/plain, null-Origin,
  missing-Origin-without-valid-Referer, forged forwarded-host, stale-action,
  and GET-mutation cases MUST have deterministic browser/HTTP tests proving no
  database or cookie state change. Missing Origin with an exact same-origin
  Referer MUST be the only successful fallback case.

## Response loss, concurrency, and failure mapping

ADR 0004's response-loss rules remain unchanged:

- admission can commit a family whose Set-Cookie response is lost;
- rotation can commit a successor whose Set-Cookie response is lost, and the
  previous token works only during its existing 60-second grace;
- logout can commit while the cookie-clearing response is lost, but the token
  is already unusable; and
- request IDs correlate these operations but do not deduplicate them.

Five ambiguous admission responses can consume all five live slots. The
adapter does not evict another administrator device or lie about a prior
response. The operator recovery path is a reviewed, service-only
Principal-wide revocation followed by reauthentication; ordinary expiry also
releases a cap slot without waiting for physical cleanup.

Concurrent current-token requests may produce one rotation and grace successes
in the order guaranteed by migration 019. Only the request receiving
`rotated` may set its own replacement. A response carrying an old/grace token
never overwrites a newer cookie in application code. Browser response ordering
is explicitly tested; if an older response can overwrite a newer Set-Cookie in
the selected runtime, the cutover is no-go until response coordination prevents
the downgrade.

Stable outward authentication responses are deliberately small:

| Internal condition | Browser result |
|---|---|
| invalid credential, unknown account, inactive provider account, or admission `ok:false` for missing allowlist/inactive Principal/bridge conflict/cap | same generic login failure |
| account/network throttle | same generic failure plus a bounded retry delay; no dimension/account disclosure |
| admission digest/request-ID validation error, digest collision, resolver/constraint exception, RPC failure, or malformed service response | full rollback; private no-store 503; no Set-Cookie |
| unknown, malformed, expired, revoked, replayed session or authorization loss | unauthenticated redirect/401 as route-appropriate; clear both cookies |
| provider timeout or malformed provider response during sign-in | generic temporary authentication failure; private no-store |
| session/authorization RPC transport, timeout, or malformed service response | private no-store 503; grant no authority, fallback, or replacement; preserve existing cookies for bounded retry |
| logout unknown/already revoked/provider legacy failure | local cookies cleared and unauthenticated redirect |

- `CUTOVER-028`: No response-loss or retry path may extend grace, reconstruct a
  lost secret, reuse a digest, delete audit evidence, exceed the family cap, or
  claim exactly-once behavior.
- `CUTOVER-029`: Concurrent admission, authorization, rotation, grace,
  revocation, allowlist change, cleanup, and response ordering MUST be proven
  cumulatively in the delivery phases assigned by the acceptance matrix, with
  controlled waiters and real browser responses rather than timing sleeps
  alone. Phase 2B.3a evidence is limited to the stated database admission
  harnesses; request-path ordering and browser evidence remain 2B.3b.
- `CUTOVER-030`: Outward errors MUST NOT distinguish account, provider subject,
  administrator row, Principal, bridge, family, token state, or cap membership.

## Cache, telemetry, and secret handling

Every provider request, session/identity/admin query, guarded RPC, login/logout
response, redirect, RSC payload, Server Action, draft-media decision, and
attestation operation is `private-no-store` under ADR 0003. The canonical HTTP
directive remains:

```text
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
```

No authenticated response may set `public`, `s-maxage`, `immutable`, or an edge
TTL. `Set-Cookie` is not treated as a sufficient cache control. Provider and
private database subrequests use fetch `cache: 'no-store'`; a Cloudflare
adapter must not place them in `caches.default` or another Cache API.

Allowed operational telemetry is aggregate counts and latency histograms with
fixed result codes, environment, release, and mode. Prohibited values include
username, password, raw/digested application token, provider access/refresh
token, JWT/claims, issuer, subject, profile, email/phone, IP address,
fingerprint, cookie/header value, attestation, Principal/family/request UUID,
RPC arguments, and provider/database response bodies. Those restrictions also
apply to thrown errors, console output, tracing attributes, metric labels,
analytics, CI artifacts, screenshots, release transcripts, and support text.

Synthetic tests use declared canary strings and then scan process logs,
browser traces, test reports, and failure artifacts for those strings and token
shapes. The 2B.3a CI gate is the only CI entry point for the sensitive
session-token, cookie, session-store, provider-proof, login-fingerprint and
CSRF unit scripts. It captures every normal run, generates fresh dynamic
canaries, deliberately forces ordinary and redaction-path `AssertionError`
failures, scans combined stdout/stderr, and never replays a failed child's raw
output. It rejects provider password/access-token/issuer/subject,
application-session token/digest/UUID/cookie, login fingerprint/IP, CSRF origin,
and the canary itself. This is process-failure evidence only; browser traces and wired
request-path artifacts remain 2B.3b. Production evidence contains only
aggregate counts and catalog-level state. Debug mode may not waive redaction.

- `CUTOVER-031`: All cutover data and HTTP paths MUST preserve ADR 0003 private
  no-store semantics at Next, Worker, origin, and edge layers. No authenticated
  object enters a cache even briefly.
- `CUTOVER-032`: Provider/session secrets, identity tuples, fingerprints,
  attestations, internal UUIDs, and private payloads MUST be excluded from every
  log and evidence sink. Stable aggregate result codes are the only normal
  observability labels.

## Cloudflare deployment boundary

Application correctness must not depend on Cloudflare, but Cloudflare traffic
may be trusted only after these deployment facts are proven:

1. The public hostname is proxied, TLS is Full (strict), and the origin accepts
   traffic only through an account-specific authenticated path such as a
   zone/per-hostname Authenticated Origin Pull certificate or Cloudflare Tunnel.
   Global shared AOP alone proves only Cloudflare network origin, not this
   account.
2. Direct origin IP, alternate DNS names, default platform hostnames, forged
   Host/SNI, and non-Cloudflare networks cannot reach the application.
3. Cloudflare overwrites the selected client-address header, the origin rejects
   a client-supplied duplicate, and the application accepts exactly that
   configured source. Only then may `CF-Connecting-IP` feed the network HMAC.
4. Reserved attestation headers are stripped at the edge/origin and again by
   Proxy. Host and forwarded-host are overwritten from trusted routing data.
5. Cache Rules bypass requests containing either session cookie,
   `Authorization`, administrator/auth/session paths, protected media,
   Server-Action headers, and every non-GET/HEAD method. A later matching rule
   cannot override the bypass; Cloudflare documents that the last conflicting
   matching Cache Rule wins.
6. Protected responses preserve the origin no-store directive and never use
   Cache Everything, Edge TTL override, Cache API `put`, response-header
   stripping, or a rule that removes `Set-Cookie` before caching.
7. Provider and private-database Worker subrequests use `fetch` with
   `cache: 'no-store'`; secrets are encrypted bindings and never
   `NEXT_PUBLIC_*` values.
8. ADR 0003's RSC/prefetch/query-string key and protected-namespace probes pass
   at the deployed edge, including `CF-Cache-Status` remaining non-hit for
   every protected 2xx/3xx/4xx/5xx response.

Cloudflare documents that Workers `fetch` supports `no-store`, its Cache API is
an explicit cache-write interface, Cache Rules can bypass on cookies, and
account-specific AOP/Tunnel can prevent origin bypass. The exact rule order,
header policy, hostname inventory, and origin firewall are deployment evidence,
not facts established by this repository.

- `CUTOVER-033`: Neither `CF-Connecting-IP` nor a private attestation header is
  trusted until exclusive ingress and overwrite/strip behavior are proven from
  both public and direct-origin probes.
- `CUTOVER-034`: A single authenticated edge cache hit, stripped no-store
  directive, cache-rule override, direct-origin success, or untrusted header
  acceptance is a no-go/rollback condition.
- `CUTOVER-035`: A Cloudflare runtime adapter MUST preserve the same provider,
  database transaction, Web Crypto, cookie, CSRF, attestation, and response-loss
  contract. Moving code to Workers does not move authority to the edge cache.

## Cleanup scheduling, drain, rollback, and retirement

The bounded migration 019 cleanup RPC is enabled only through a
least-privilege scheduler after staging overlap tests. One invocation uses
batches of 250, a fresh request UUID for every batch, at most four batches, and
a 30-second wall budget. It runs every 15 minutes, never exports rows, and
reports only aggregate family/throttle deletion counts and fixed errors. A
second worker may overlap safely; `SKIP LOCKED` makes it eventual, not an
authentication decision. Three consecutive failures or no successful run for
60 minutes pages the operational owner. Session validity never depends on the
job.

Bridge begins only after all pre-2B.3 images drain. The timestamp of the last
possible legacy-cookie issuance is recorded. `application` mode cannot begin
until eight hours after that timestamp, all fleet clocks/configs are healthy,
no old image is registered, and the runbook's legacy-only probes and aggregate
signals pass. The extra operational observation window is not used to extend a
legacy credential; it only determines when the next release is attempted.

Rollback keeps migrations 018–020 installed. Before bridge, the previous image
is a valid application rollback target. After bridge issues the first new-only
cookie, rollback uses the reviewed 2B.3-capable image:

- `bridge` preserves valid application sessions and legacy drain;
- `legacy` deliberately ignores the new cookie and can accept legacy, so it is
  not a safe rollback target after bridge; and
- a pre-2B.3 image is forbidden because it can ignore a failed new credential
  and accept a weaker legacy cookie.

Legacy code and configuration are removed only in a reviewed contraction after
stable `application` observation, zero legacy success, all old-image rollback
expectations retired, and a browser test proves `cs2cup_session` is cleared and
ignored. Contract rollback may restore application-capable compatibility code,
not revive provider tokens or drop session schema/audit.

- `CUTOVER-036`: Cleanup scheduling MUST remain bounded, least privilege,
  privacy safe, overlap safe, and operationally monitored. Its failure cannot
  make an expired/revoked session valid.
- `CUTOVER-037`: `application` mode requires a complete eight-hour legacy
  issuance drain and exact fleet evidence. An observation estimate or average
  cookie age is insufficient.
- `CUTOVER-038`: Database rollback is forward-fix only. Migrations 018–020,
  bridge links, SessionFamilies, token lineage, throttle state, and audit rows
  are never dropped, edited, or purged to roll back application traffic.
- `CUTOVER-039`: Legacy retirement is a reviewed contract change after stable
  application-only operation. It is not bundled with first traffic enablement.

## Deterministic acceptance matrix

Phase 2B.3a/2B.3b/2B.3c must cumulatively add named repository commands and CI jobs that prove at
least this matrix:

| Boundary | Required deterministic evidence |
|---|---|
| Provider | 2B.3a production-remote pure proof: exact sign-in/introspect/profile subject equality, exact client ID, ACTIVE state, separately supplied canonical issuer pin, empty/malformed/mismatch/redirect/timeout/outage, and no access-token claim parsing; 2B.3b: explicit synthetic local `VerifiedProviderProof` adapter with exact OIDC/JWKS vectors plus production-mode/build exclusion; existing legacy `lib/jwt.ts` is not new-proof evidence; 2B.3c: independently approved target-staging issuer and remote tuple proof |
| Fingerprints/throttle | fixed HMAC vectors, malformed/oversized accounts, IPv4/IPv6 `/64`, missing/untrusted headers, exact 5/30 windows, `retryAfterSeconds` safe-integer `0..900` with allow=0/deny=1..900, both dimensions consumed before provider calls, success clear ordering |
| Migration 020 | 2B.3a: fresh/018/019 upgrade, legacy-012 adoption to head, replay, checksum, late rollback, ACL plus missing/malformed/anon/authenticated/club-admin claims denial, zero backfill, atomic bridge, static inactive/deleted Principal and bridge conflict, operational collision rollback, revoked-slot and uncleaned deadline-equality recovery; at least six concurrent admissions (pinned harness: one holder plus eight waiters, five success/four generic denial); admin-row deletion waiter generic denial/zero state; migration 019 Principal-SHARE fifth-family holder blocking migration 020 UPDATE until resampled cap denial; committed Principal suspension resampled with verification/session rollback and authorization false |
| Session adapter | 2B.3a: canonical tokens, exact RPC arguments/result parser, 5-second default/30-second maximum abort deadline, complete transport-error replacement, strict calendar/clock-valid RFC 3339-style timestamps and deadline ordering, active/grace/rotated/denied/error and request-local replacement, provider-token non-persistence; 2B.3b: Proxy one touch, ordered use/authorization, authority loss, revocation/replay/logout and downstream wiring |
| Attestation | canonical vectors, wrong secret/cookie/class, expired/future/malformed payload, incoming-header overwrite, no response echo, exactly one use then one administrator-authorization RPC across layouts/actions/media |
| Cookies/bridge | 2B.3a pure evidence: exact `__Host-` option/deletion helpers, no Domain/Partitioned, Priority High, absolute Expires plus floored Max-Age, Strict SameSite, and parser absence→legacy/malformed→rejection; 2B.3b wiring evidence: malformed configuration fails real application startup, bridge/application new precedence, legacy compatibility, no lazy mint/new legacy issue, invalid-new downgrade denial, operational-error cookie preservation and real-browser attributes |
| CSRF | exact Origin success; absent Origin plus exact same-origin Referer fallback success; cross-origin form/fetch, null Origin, absent Origin without valid Referer, forged forwarded host, non-same-origin Fetch Metadata, GET/logout and stale action all fail without mutation |
| Concurrency/loss | 2B.3a controlled cap, allowlist-deletion, migration-019-SHARE interoperability, and Principal-suspension admission waiters with exact rollback outcomes; 2B.3b ordered use/authorization/revocation and browser create/rotate/logout response loss/order; 2B.3c staging cleanup overlap and rollback rehearsal |
| Cache/privacy | protected HTML/RSC/action/media/provider/RPC responses and subrequests no-store; 2B.3a makes one captured gate the sole CI runner for sensitive token/provider/session/cookie/fingerprint/CSRF unit tests, scanning normal and forced `AssertionError` stdout/stderr and never replaying failed child output; provider password/token/issuer/subject, session token/digest/UUID/cookie, fingerprint/IP and CSRF canaries are prohibited; later slices add traces, screenshots and browser failure artifacts |
| Cloudflare/staging | actual provider tuple proof, gateway redirects/timeouts, edge/direct-origin/header probes, both-cookie cache bypass, rule-order trace, scheduler overlap and rollback rehearsal |

Tests must assert both effects and non-effects: exact row/audit/cookie counts,
absence of provider credentials, absence of a second touch, and unchanged legacy
behavior in default mode. Sleeps without a proven lock waiter, mocked cookie
headers without a real browser, a decoded JWT without remote proof, or an
origin-only cache test are not release evidence.

- `CUTOVER-040`: Every matrix row MUST be automated locally/CI where possible
  and repeated against disposable staging for provider/edge facts that cannot
  be simulated. Missing environment evidence is a no-go, not a skipped pass.
- `CUTOVER-041`: Phase 2B.3a completion claims an accepted design plus inert
  migration/adapter database and unit evidence. It MUST NOT be reported as
  Proxy/login/logout/DAL wiring, browser, staging, or production cutover
  evidence.

## Source basis and evidence classification

### Documented external facts

- CloudBase documents [`POST /auth/v1/signin`](https://docs.cloudbase.net/http-api/auth/auth-sign-in)
  and a response containing access/refresh tokens and `sub`.
- CloudBase documents [`GET /auth/v1/token/introspect`](https://docs.cloudbase.net/http-api/auth/auth-token-introspect)
  as validating a non-expired, non-revoked bearer and returning `client_id` and
  `sub`, or an empty object when invalid.
- CloudBase documents [`GET /auth/v1/user/me`](https://docs.cloudbase.net/http-api/auth/user-me)
  as requiring a valid bearer and returning profile `sub` and `status`.
- CloudBase's [PG authentication guide](https://docs.cloudbase.net/authentication-v2/auth/auth-pg)
  describes user access tokens as JWTs and shows `iss`, `sub`, `aud`, expiry,
  and `authenticated` role claims. Its displayed issuer is an example, not this
  deployment's evidence.
- CloudBase documents configurable [token lifecycle](https://docs.cloudbase.net/authentication-v2/auth/token),
  [refresh-token rotation](https://docs.cloudbase.net/http-api/auth/auth-grant-token),
  and [`POST /auth/v1/user/signout`](https://docs.cloudbase.net/http-api/auth/auth-sign-out)
  invalidating access/refresh state.
- Next.js documents [Proxy behavior and limitations](https://nextjs.org/docs/app/api-reference/file-conventions/proxy),
  [cookie read/write locations](https://nextjs.org/docs/app/api-reference/functions/cookies),
  and [Server Action/data security](https://nextjs.org/docs/app/guides/data-security),
  including treating actions as public endpoints, re-authorizing inside them,
  and Origin/Host comparison.
- [NIST SP 800-63B-4 Session Management](https://pages.nist.gov/800-63-4/sp800-63b/session/)
  supports server-enforced sessions, secure transport, timeout, logout, and
  cookie protection. The [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
  [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html),
  [CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
  and [Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
  cheat sheets support opaque cookies, throttle layering, origin/SameSite
  defenses, action authorization, and secret redaction.
- Cloudflare documents Workers [`fetch`](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
  `no-store`, the explicit [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/),
  [cookie cache bypass](https://developers.cloudflare.com/cache/how-to/cache-rules/examples/bypass-cache-on-cookie/),
  [Cache Rule precedence](https://developers.cloudflare.com/cache/how-to/cache-rules/order/),
  and account-specific [Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/).

### Repository choices

The remote double proof, exact subject equality, five-family cap, migration 020
RPC boundaries and lock order,
fingerprint strings, cookie name/options, three modes, no-lazy-mint bridge,
30-second attestation, Proxy touch ownership, the exact Origin-then-Referer
fallback contract,
cleanup cadence/budget, eight-hour drain, and rollout order are repository
decisions. None is presented as a value mandated by CloudBase, Next.js, NIST,
OWASP, or Cloudflare.

### Inference boundary

No production claim is inferred from the access-token payload. The remote
endpoints establish the equal active subject and environment client ID; the
issuer comes from an independently staging-approved exact pin. The conclusion
that those together form this adapter's identity tuple is a repository design
choice. If staging cannot establish the issuer, cutover stops.

### Evidence unavailable in the repository

At acceptance of Phase 2B.3a, the repository has no target staging credential
or captured proof for the exact issuer, introspection/profile field equality,
JWT role/anonymous claims, discovery/JWKS availability and rotation, network
timeouts, Cloudflare request headers, Cache Rule ordering, authenticated origin,
direct-origin denial, secret bindings, or scheduler. Those are deliberately
not fabricated. The companion runbook defines how an authorized operator
records non-secret results without committing credentials or identity data.

## Consequences and rejected alternatives

This design adds a PostgreSQL write plus one separate administrator-authorization
read for every authenticated request. It also makes provider sign-in dependent
on two verification reads. Those costs buy exact revocation, issuer/subject
evidence, one request touch, downgrade resistance, and a provider credential
that does not become the application session.

Provider outages prevent new and transitional legacy verification but do not
invalidate an already admitted application session; PostgreSQL remains its
authority. Database outages fail authenticated requests closed. Cleanup
outages affect retention only.

The following alternatives are rejected:

- keeping the provider token in the new cookie, because it preserves provider
  coupling and prevents independent application revocation;
- verifying only `user/me`, because it leaves subject/client/issuer proof
  incomplete;
- trusting the documented issuer example, because a documentation example is
  not target-environment evidence;
- enabling local JWKS in production by environment-variable presence, because
  its discovery and rotation behavior is unproven;
- application-side identity resolution, allowlist lookup, cap count, and
  session creation, because concurrent calls can create or authorize an
  inconsistent result;
- letting both Proxy and downstream code use the session, because it creates
  duplicate touches and ambiguous rotation-cookie ownership;
- trusting an unsigned internal header, because external clients control
  headers unless every hop strips and authenticates them;
- falling back from a bad new cookie to legacy, because it converts revocation
  or replay detection into an authentication downgrade;
- lazily minting from legacy, because response loss can create unreachable
  families repeatedly;
- dual-writing provider tokens on new sign-in, because it extends the weaker
  credential and contradicts request-local provider handling;
- edge-only session validation or throttling, because caches and edge rules do
  not replace database authority or exact account limits; and
- removing legacy code in the first cutover, because it eliminates the safe
  bridge-capable rollback image before production evidence exists.
