# Application-session cutover, drain, and rollback runbook

This runbook governs Phase 2B.3 under
[ADR 0005](../adr/0005-application-session-cutover.md). It begins with an inert
2B.3a architecture/migration/pure-adapter release (including only the remote
CloudBase proof), then defines the 2B.3b explicit local-proof and
Proxy/login/logout/DAL integration and the separately authorized 2B.3c traffic
cutover.

Migration 020, the pure remote proof and other foundation adapters, and their
database/unit tests are 2B.3a deliverables. **Do not manually call migration
018–020 RPCs in production, set
a new cookie, wire ordinary traffic, or enable a cleanup job from this document
alone.** Phase 2B.3a keeps
`SESSION_AUTH_MODE` absent or exactly `legacy`; current
`cs2cup_session` behavior remains authoritative.

The uppercase terms **MUST**, **MUST NOT**, **SHOULD**, and **SHOULD NOT** have
the meanings in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174). Operational rules use
stable `CUTOVER-RUN-NNN` identifiers. Do not renumber or reuse an identifier.

## Mandatory release lanes

The release cannot collapse these lanes:

```text
2B.3a: ADR/runbook + migration 020 + remote proof/other pure adapters/tests; legacy/inert
  -> 2B.3b: explicit local proof + Proxy/login/logout/DAL/browser; legacy/inert
  -> 2B.3c: target-environment provider, browser, database, ingress/cache proof
  -> all pre-2B.3 images drained while mode remains legacy
  -> bounded cleanup scheduler in staging, then production
  -> fleet-wide bridge mode; one coordinated administrator canary login
  -> bridge observation through the complete eight-hour legacy issuance drain
  -> fleet-wide application mode; legacy-only requests denied and cleared
  -> stable application-only observation
  -> separate reviewed legacy compatibility contraction
```

Merging code, applying migration 020, or passing local CI never authorizes the
next arrow. Each transition has an explicit owner, independent reviewer,
recorded start/finish time, immutable commit/image digest, non-secret aggregate
evidence, and a go/abort decision.

- `CUTOVER-RUN-001`: 2B.3a MAY deliver only the reviewed architecture,
  append-only migration 020, production-remote proof and other stated pure
  adapters, and database/unit tests. It MUST NOT claim the explicit local proof
  adapter or wire Proxy, login, logout, DAL, browser traffic, scheduler, or
  production session authority.
- `CUTOVER-RUN-002`: 2B.3a and 2B.3b MUST deploy with an absent or exact
  `legacy` mode and prove no ordinary request calls a 018–020 identity/session
  RPC or changes identity/session state.
- `CUTOVER-RUN-003`: 2B.3c traffic enablement requires separate application,
  database/security, browser, provider, Cloudflare ingress/cache, operations,
  and rollback approval.

## People, authority, and evidence handling

Assign these roles before 2B.3a migration deployment:

| Role | Responsibility |
|---|---|
| Release owner | exact commit/image, fleet mode, traffic transition, abort |
| Database owner | backup/restore, migration 020, ledger/ACL/lock evidence, forward fix |
| Security reviewer | provider tuple, cookie/CSRF/attestation, error and log redaction |
| Cloudflare owner | DNS/proxy, authenticated origin, headers, Cache Rules and rule order |
| Identity owner | target CloudBase environment, designated staging account, token policy and exact issuer-pin proof |
| Test observer | independent browser/concurrency/result verification |
| Incident owner | rollback routing, session revocation, provider/database/cache escalation |

No one person may both produce and independently approve the provider issuer
evidence, direct-origin denial, or production mode transition.

The restricted release record may contain only:

- repository commit, PR, image digest, environment name, database name, and
  migration filename/checksum;
- configuration and secret **version identifiers**, never secret values;
- backup/restore identifiers and rehearsal result;
- test command names, CI run, start/finish timestamps, pass/fail booleans, and
  fixed aggregate counts/latencies;
- fleet instance count, release digest, non-secret mode, canary scope, cleanup
  batch totals, and go/abort decision; and
- named owners/reviewers and incident link.

It MUST NOT contain a username, password, provider access/refresh token, JWT,
claims, issuer, subject, profile, email/phone, IP address, raw/digested
application token, fingerprint, cookie/header, attestation, Principal/family/
request UUID, private row, RPC argument, database URL, API key, or provider
response body. Inspect exact issuer and secret values only inside the approved
secret/configuration system with access audit; record two-person exact-match
approval, not the value.

- `CUTOVER-RUN-004`: Shell tracing (`set -x`), HTTP verbose output, browser
  network export, database statement logging with parameters, and CI command
  echo MUST be disabled around credentials and exact identity evidence.
- `CUTOVER-RUN-005`: A failure artifact containing prohibited data is a
  security incident. Restrict/delete the artifact through the hosting system,
  rotate exposed credentials where applicable, preserve a sanitized incident
  record, and do not paste the value into an issue to explain the deletion.

## Universal stop conditions

Stop before or during any release if one statement is false:

1. The checkout is clean except explicitly reviewed files, migration files are
   immutable, and CI uses the exact commit that produced the image.
2. A completed isolated backup restore proves the previous application and
   current business writes before migration 020.
3. The target database name is independently configured and verified; no
   command follows a URL from a repository `.env*` overlay.
4. Migration 020 is append-only, one runner-owned transaction, zero-backfill,
   old-image compatible, claims-guarded, private-core, and checksum-pinned.
5. `SESSION_AUTH_MODE` is identical across the fleet and the exact
   transition is authorized.
6. Production provider mode is remote double proof; local OIDC/JWKS is rejected
   in production.
7. The exact issuer was observed and independently approved in the target
   staging environment. It was not derived from the environment ID or a
   documented example.
8. New sign-in never writes a provider token to either cookie, storage, cache,
   database, log, or browser-visible result.
9. `__Host-cs2cup-session` has exact Secure/HttpOnly/SameSite/Path/Domain,
   Priority, Partitioned-absence, Expires, and Max-Age behavior in a real
   browser.
10. A new cookie always has fail-closed precedence; no invalid-new request can
    authenticate with legacy.
11. Proxy is the only per-request application-session touch/rotation owner and
    downstream code requires a valid request-bound attestation.
12. Every browser mutation enforces exact same-origin POST and action-level
    authorization.
13. Protected responses/subrequests are private no-store at application,
    origin, Worker, and edge layers.
14. Direct origin bypass and client-forged trusted headers are impossible.
15. Cleanup is bounded and validity does not depend on it.
16. The rollback target is compatible with every cookie already issued.

Any provider mismatch, sixth-family race, double touch, raw-secret observation,
cross-origin mutation, authenticated edge cache hit, direct-origin success,
untrusted header acceptance, old-image request after bridge, or migration
checksum difference is an abort—not an observation warning.

## Phase 2B.3a foundation acceptance

The 2B.3a PR is acceptable only when:

```bash
git diff --check
git status --short
git diff --name-only origin/main...HEAD
```

shows only the reviewed foundation scope: this ADR/runbook, append-only
migration 020, pure production-remote CloudBase proof and
fingerprint/session/cookie/CSRF adapters,
deterministic database/unit tests, and their necessary migration lifecycle,
package, environment-example, and pinned-CI wiring. Reviewers must check every
direct source link, each `CUTOVER-*` requirement, the exact migration/RPC
semantics, pure-adapter contracts, all three cookie modes, evidence
classification, and this runbook's go/no-go and rollback ordering.

There is no Proxy, login, logout, DAL, attestation, browser-traffic, cleanup
scheduler, production deployment, migration execution, secret creation,
staging credential use, or traffic flag change in this slice. An absent
`SESSION_AUTH_MODE` resolving to `legacy`, and malformed input rejection, are
pure parser unit evidence only. The foundation is behaviorally inert because
the parser and all new adapters are not wired to startup or ordinary traffic.

After merge, the feature branch is deleted according to the repository's
normal protected-branch process. Phase 2B.3b starts from updated `main` on a new
focused branch. A material design change gets a reviewed ADR amendment with
stable rule references.

## Phase 2B.3a foundation implementation contract

### Required deliverables

The focused 2B.3a PR must contain, in reviewable commits:

1. `migrations/020_application_session_admission.sql` with the exact guarded wrappers
   and private implementations:

   ```text
   public.admit_admin_app_session(text,text,text,bytea,uuid)
   public.authorize_admin_principal(uuid)
   ```

2. portable Web Crypto account/network fingerprints with ADR 0005 vectors;
3. the pure production-remote CloudBase `VerifiedProviderProof` adapter; 2B.3a
   does not claim a new dev/test-local proof adapter;
4. typed session RPC result parsers with a 5-second default/30-second maximum
   deadline, complete transport-error remapping, strict RFC 3339-style
   calendar/clock validation and bounded login retry parsing; exact cookie
   helpers and a fail-closed mode state machine, without ordinary-request
   wiring;
5. a pure CSRF origin/Referer decision helper;
6. no-store/error/redaction boundaries in those adapters; and
7. deterministic database, unit, concurrency, migration-lifecycle, build, and
   packaging tests wired into the pinned CI workflow.

The expected public commands are:

```text
npm run test:auth-boundaries
npm run test:application-session-admission
```

Exact script names may change only in the same reviewed PR that updates this
runbook and CI. No command may require a real production credential. Provider
staging proof remains a separate acknowledged smoke command that refuses an
unconfirmed target environment.

### Session adapter and failure-artifact acceptance

The 2B.3a session-store unit gate must prove all of the following without
wiring an ordinary request:

- every RPC defaults to a 5,000-millisecond abort deadline, accepts only a
  safe-integer override in `1..30000`, and aborts the underlying transport;
- every transport rejection, timeout, database/PostgREST diagnostic, or
  forged/mutated service error is replaced by a fresh fixed `unavailable`
  error with no original message, object, or `cause`;
- session envelopes reject invalid UUIDs, impossible Gregorian dates, invalid
  clock/offset fields, non-RFC 3339-style timestamp shapes, and idle/rotation
  deadlines later than the absolute deadline; and
- login retry output is a safe integer in `0..900`, with allowed requiring
  zero and denied requiring `1..900`.

The CI redaction gate must be the only CI entry point for the sensitive
session-token, cookie, session-store, provider-proof, login-fingerprint and
CSRF scripts. It captures their normal execution, generates fresh random
canaries, deliberately forces ordinary and redaction-path `AssertionError`
failures, and scans combined stdout/stderr without ever replaying failed child output.
It fails if an artifact contains provider password/access-token/issuer/subject,
application-session token/digest/UUID/cookie, login fingerprint/IP, CSRF origin,
or the canary itself. Fixed safe assertion messages remain required; a direct
sensitive-script CI command or a scan of stdout alone is not evidence. This gate is 2B.3a process-failure
evidence, not the browser/trace coverage assigned to 2B.3b.

### Migration 020 database acceptance

Migration 020 must pass the complete runner lifecycle:

| Path | Required result |
|---|---|
| Fresh | 001–020 apply; exact ledger row/checksum; no fabricated identity/session/admin link |
| 018 upgrade | 018 sentinels unchanged; 019/020 install; no session/admin link |
| 019 upgrade | 019 empty/sentinel state unchanged; 020 exact objects/ACLs install |
| Legacy adoption | supported unledgered 012 baseline, then 013–020 normally; no false adoption |
| Replay | second run changes neither ledger nor catalog/business counts |
| Late failure | deliberately late 020 conflict rolls back every 020 object and ledger row; recovery then succeeds |
| Concurrent runners | advisory migration lock yields one exact migration and ledger row |
| Previous image | current provider-cookie login/admin/logout and public behavior pass against migrated schema with zero 020 traffic |

Before migration, capture restricted aggregate counts. After migration and
before traffic, require exact equality for all pre-existing counts and no new
links/sessions/audit. The target query is intentionally aggregate:

```sql
select
  (select count(*) from public.admin_user) as admin_count,
  (select count(*) from public.admin_user where principal_id is not null)
    as linked_admin_count,
  (select count(*) from app_private.principal) as principal_count,
  (select count(*) from app_private.principal_identity) as identity_count,
  (select count(*) from app_private.app_session) as family_count,
  (select count(*) from app_private.app_session_token) as token_count,
  (select count(*) from app_private.login_throttle) as throttle_count,
  (select count(*) from app_private.audit_event) as audit_count;

select
  to_regprocedure(
    'public.admit_admin_app_session(text,text,text,bytea,uuid)'
  ) as admission,
  to_regprocedure(
    'public.authorize_admin_principal(uuid)'
  ) as authorization;
```

Do not select provider tuples, bridge values, token hashes, fingerprints, or
audit rows. Existing non-zero identity/audit counts may be legitimate; equality
to the captured baseline, not a guessed zero, is the gate. Migration 019
session/throttle relations are expected to be empty before first session
traffic; any unexplained row is an incident to investigate, not a row to erase.

Catalog tests must prove:

- digest and request-ID validation occurs before admission locks; the
  administrator row is locked next; only then does
  `app_private.ensure_principal_identity` validate the generic
  provider/issuer/subject namespace and take identity advisory/row locks;
- admission delegates generic provider/issuer/subject namespace validation to
  `app_private.ensure_principal_identity` and does not hard-code CloudBase in
  migration 020; the current pure application adapter alone emits `cloudbase`
  proof;
- both wrappers are `SECURITY DEFINER` with fixed trusted search paths and an
  in-body `service_role` claim check;
- private implementations are `SECURITY INVOKER` and unavailable to request
  roles;
- `PUBLIC`, `anon`, `authenticated`, `club_admin`, and `service_role` have no
  direct private schema/table/function access;
- gateway missing/malformed/anon/authenticated/club-admin claims receive
  `42501`, while a signed service claim reaches only non-secret argument
  validation in staging;
- no digest, identity tuple, or constraint diagnostic enters MESSAGE, DETAIL,
  HINT, CONTEXT, gateway text, application error, or CI output; and
- missing allowlist, inactive/deleted Principal, bridge conflict, and cap are
  expected policy denials returning exactly `{"ok":false}` with full rollback;
  an invalid digest/request-ID contract input, digest collision, invalid
  resolver/constraint input, unexpected constraint violation, or RPC exception
  instead remains an operational failure, fully rolls back, and maps to
  private no-store 503 with no Set-Cookie.

### Migration 020 concurrency acceptance

Use controlled external transactions and positive lock-wait evidence. Phase
2B.3a proves its implemented database boundary with:

1. at least six simultaneous admissions for one active administrator with
   distinct tokens; the pinned harness uses one administrator-row lock holder
   plus eight observed lock waiters, then finishes with exactly five successes
   and four generic `{"ok":false}` denials;
2. all successful admissions converge on one Principal, one AuthIdentity, and
   one bridge without deadlock, while denied token digests create no token or
   audit row;
3. static missing-allowlist, suspended/deleted Principal, and conflicting
   bridge cases return the expected generic policy denial with complete
   rollback, while a deliberately late digest collision raises an operational
   error and rolls back the attempted Principal/identity/bridge/session/audit
   changes;
4. five physically present, uncleaned families have idle and absolute
   deadlines set to the same exact database-time boundary; at the following
   admission sample they do not consume the cap, so one new family succeeds
   and is the sole live family;
5. an admission visibly waits behind an administrator-row holder; after that
   holder deletes and commits the allowlist row, admission returns exactly
   `{"ok":false}` with zero identity, token, or audit state for the attempt;
6. with four committed families, an actual migration 019
   `create_app_session` transaction creates the fifth while retaining its
   Principal `SHARE` lock; migration 020 admission blocks on its conflicting
   Principal `UPDATE` lock, then after commit resamples five and generically
   denies the sixth candidate without token/audit residue;
7. admission waiting behind a Principal `UPDATE` holder resamples a committed
   suspension, returns `{"ok":false}`, preserves the prior
   `last_verified_at`, creates no candidate token/audit, and the authorization
   RPC returns `{"ok":true,"authorized":false}`;
8. admission visibly follows administrator row → identity advisory/row →
   exclusive Principal → family/token/audit; the current schema has no
   Principal-to-administrator writer, and a future migration may not introduce
   that reverse order;
9. the pure adapters independently parse use success/denial/error and
   authorization true/false/error without claiming cross-RPC atomicity;
10. revoked families release a cap slot and the generic migration 019 RPCs
   retain their prior tested semantics.

These are Phase 2B.3a database facts proven on a fresh 001→020 disposable
database; they do not claim request-path wiring. Phase 2B.3b must still prove
Proxy's ordered one-touch use then administrator authorization under authority
loss, revocation/replay/logout behavior, and real-browser response loss/order
before its wiring can merge.

Random sleeps are not proof. Capture only waiter/backend state and aggregate
outcomes; never capture SQL text/parameters containing private values.

- `CUTOVER-RUN-006`: Migration 020 MUST be applied by the repository runner
  before an image capable of calling its wrappers, then replayed through the
  runner. Manual SQL, down migration, ledger editing, or checksum adoption is
  forbidden.
- `CUTOVER-RUN-007`: A cap or lock-order test that cannot show the intended
  waiter/serialization state is inconclusive and blocks merge.

## Phase 2B.3b wiring contract

Starting from merged 2B.3a, the focused 2B.3b PR wires the mode parser into
application startup and the other pure contracts into Proxy, login, logout,
and the DAL. Startup must accept absence/exact `legacy` and reject malformed
mode configuration. Proxy becomes the unique application-session touch/rotation
owner. On a new-cookie request it calls `use_app_session` once,
then calls `authorize_admin_principal` once only after successful use; these are
two ordered RPCs, not one atomic use-and-authorization transaction.
`authorized:false` is a definite denial. Only both successes may create the
signed, request-bound downstream attestation.

Before browser wiring, 2B.3b adds the explicit dev/test-local
`VerifiedProviderProof` adapter omitted from 2B.3a. It may use the synthetic
issuer from `scripts/dev-session.mjs`, but selection requires a dedicated
dev/test provider mode and must fail when `NODE_ENV=production`; issuer-variable
presence is never a selector. Tests must prove its exact local
issuer/audience/expiry/signature/subject checks and prove a production build or
configuration cannot select it. Existing `lib/jwt.ts` remains a legacy
provider-token path and does not satisfy this gate.

The PR also wires strict bridge/application new-cookie precedence, login and
logout response behavior, the CSRF decision at every mutation, reserved-header
stripping, no-store/redaction, and DAL action-level authorization. It adds
production-build real-browser, dual-cookie, one-touch, concurrency,
response-loss/order, attestation, and CSRF tests, including:

```text
npm run e2e:session-cutover
```

It still deploys with an absent `SESSION_AUTH_MODE` or its exact value `legacy`;
no ordinary request may exercise the new wiring until the separately approved 2B.3c
traffic transition.

## Repository and CI preflight for 2B.3a/2B.3b

Run against a caller-owned disposable stack with no repository-local deployment
overlay and no inherited production controls. Each phase must update the exact
self-contained preflight as implementation lands; 2B.3a runs all applicable
commands below, and 2B.3b adds the browser/wiring gates:

```bash
set -euo pipefail

for cutover_env_file in .env .env.local .env.production .env.production.local; do
  if [[ -e "${cutover_env_file}" ]]; then
    echo "remove ${cutover_env_file} from this disposable checkout" >&2
    exit 1
  fi
done

unset \
  SESSION_AUTH_MODE \
  LOGIN_FINGERPRINT_SECRET \
  LOGIN_CLIENT_IP_SOURCE \
  SESSION_ATTESTATION_SECRET \
  CLOUDBASE_ADMIN_KEY \
  CLOUDBASE_ANON_KEY \
  CLOUDBASE_IDENTITY_ISSUER \
  CLOUDBASE_SMOKE_ACKNOWLEDGE_STAGING \
  CLOUDBASE_SMOKE_EXPECT_ENV_ID \
  MIGRATION_DATABASE_URL \
  MIGRATION_EXPECT_DATABASE \
  NODE_ENV \
  PORT \
  HOSTNAME

export CI=1
export NEXT_TELEMETRY_DISABLED=1
export SESSION_AUTH_MODE=legacy
export CLOUDBASE_ENV_ID=dev-env
export RDB_BASE_URL=http://127.0.0.1:53000
export RDB_ADMIN_BASE_URL=http://127.0.0.1:53001
export E2E_BASE_URL=http://127.0.0.1:3000
export E2E_RDB_BASE_URL=http://127.0.0.1:53000
export BASE_URL=http://127.0.0.1:3000
export NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000
export LOGIN_FINGERPRINT_SECRET=local-cutover-login-secret-at-least-32-bytes
export LOGIN_CLIENT_IP_SOURCE=x-real-ip
export SESSION_ATTESTATION_SECRET=local-cutover-attestation-secret-at-least-32-bytes
export REGISTRATION_FINGERPRINT_SECRET=local-registration-secret-at-least-32-bytes
export REGISTRATION_CLIENT_IP_SOURCE=x-real-ip
export MIGRATION_REQUIRE_EXTERNAL_TEST=1

npm ci
npx playwright install chromium
npm run stack:up
npm run stack:seed
npm run test:migration-checksum
npm run test:migration-state
npm run test:migrations
npm run test:security-boundaries
npm run test:identity-foundations
npm run test:session-foundations
npm run test:auth-boundaries
npm run test:application-session-admission
npm run typecheck
npm run lint
npm run build
node scripts/pack-standalone.mjs
npm run e2e:admin                 # 2B.3b
npm run e2e:session-cutover       # 2B.3b
npm run check
git diff --check
```

This inert local preflight deliberately leaves
`CLOUDBASE_IDENTITY_ISSUER` unset. Phase 2B.3a unit tests inject isolated
synthetic remote responses/configuration; they do not claim a local proof
adapter. Once 2B.3b adds one, browser development must select its dedicated
dev/test-only provider mode. Neither phase may fabricate an HTTP value for the
production pin. The production adapter accepts only the separately approved
canonical HTTPS issuer on the official gateway origin.

The future harness must own and health-check every application/provider process
it exercises and clean up on all exits. `npm run check` against a stale process
or undeclared database is invalid. The CI workflow must independently run the
same gates with pinned actions, dependency lockfile, production build/container,
real Chromium, and unconditional service cleanup.

Default `legacy` tests must snapshot 018–020 aggregate counts before and after
the complete public/admin suite and prove no delta attributable to cutover.
They must also prove `legacy` intentionally ignores a client-supplied
`__Host-cs2cup-session` and preserves old provider-cookie behavior. This mode
is never used as a security rollback after bridge begins.

- `CUTOVER-RUN-008`: No staging/production smoke can compensate for a failing
  local/CI migration, concurrency, browser, build, packaging, cache, CSRF, or
  secret-scan gate.

## Phase 2B.3c target provider evidence gate

This gate requires an authorized non-production CloudBase environment that
matches production authentication mode and a designated synthetic
administrator. It never runs from pull-request CI and never uses a production
human password.

### Configuration provenance

Two reviewers must independently verify, inside the secret/configuration
system:

- exact target `CLOUDBASE_ENV_ID` and separately expected environment ID;
- exact issuer established by an independent target-staging approval and
  pinned as `CLOUDBASE_IDENTITY_ISSUER`;
- official gateway origin generated from the environment ID;
- CloudBase token policy (access lifetime, refresh lifetime, provider session
  cap) as non-authoritative context;
- remote production verification mode and local JWKS mode disabled;
- minimum-32-byte login-fingerprint and attestation secrets are independent,
  versioned, and absent from client bundles; and
- the provider smoke's explicit staging acknowledgement and target match.

The issuer may resemble the example in CloudBase's PG guide; similarity is not
evidence. Do not normalize it while comparing or storing it.

### Remote proof procedure

Use the future acknowledged staging command. It must keep all response bodies
in process memory, emit only fixed booleans/counts, and perform:

1. one password sign-in at the exact official gateway with redirects disabled;
2. introspection of that exact access token;
3. `user/me` for that exact token;
4. exact equality of the sign-in, introspection, and profile `sub` values,
   introspection `client_id = CLOUDBASE_ENV_ID`, exact profile `ACTIVE` status,
   and the independently approved issuer pin;
5. atomic staging admin admission and exact new-cookie construction in a
   disposable/restored staging database;
6. request-local discard of the provider token with no refresh, sign-out,
   persistence, cookie, client result, or log; and
7. cleanup/revocation of only the designated staging SessionFamily through its
   normal lifecycle—not direct row deletion.

Repeat negative cases with synthetic/local provider responses for every field
mismatch, malformed body, invalid JSON, oversized response, redirect, timeout,
500, and network failure. Against real staging, additionally prove a wrong
environment client ID, inactive designated test account if safely available,
and invalid token all fail with the same sanitized outward result. Do not
intentionally lock a shared account or exhaust a production throttle.

Capture outbound request metadata through a redacting harness and require:

- exactly one sign-in, introspection, and `user/me` for success;
- zero `/auth/v1/token` refresh calls;
- no provider call before both throttle dimensions commit;
- `cache: 'no-store'`, `redirect: 'error'`, exact official origin, bounded
  abort, and no automatic retry; and
- no bearer, password, provider body, subject, issuer, or profile in output.

Production proof does not parse unverified access-token claims. If
introspection omits the expected client/subject, profile differs, the issuer
pin lacks independent staging approval, discovery is unexpectedly followed, or
any exact check cannot be proven, record only the failed gate and stop. Do not
weaken or infer the missing field.

- `CUTOVER-RUN-009`: Production cutover MUST have a fresh passing remote proof
  from the target-equivalent staging environment for the exact release. Local
  JWKS and mocked HTTP are necessary tests but never substitute evidence.

## Cookie, attestation, CSRF, and browser gate

Run the production build in real Chromium through the same TLS/proxy shape used
for staging. Browser tests must inspect actual storage and response headers,
not only a cookie-option object.

### Cookie matrix

Prove:

- successful bridge/application sign-in stores exactly one
  `__Host-cs2cup-session` with Secure, HttpOnly, SameSite=Strict, Path=/,
  Priority=High, no Domain, no Partitioned attribute, canonical token value,
  and Expires equal to the returned family absolute deadline;
- its Max-Age is
  `floor((absoluteExpiresAt - responseTime) / 1000)` and never permits the
  browser credential to outlive Expires; passed or sub-second deadlines fail
  serialization;
- the deletion helper retains Secure, HttpOnly, SameSite=Strict, Path=/, and
  Priority=High, omits Domain and Partitioned, and sets the Unix epoch plus
  Max-Age=0;
- no provider token/refresh token is present in cookies, local/session storage,
  IndexedDB, Cache Storage, page/RSC/action body, history, URL, or service
  worker state;
- JavaScript cannot read the new cookie;
- active/grace responses do not install a candidate; only `rotated` installs
  its own candidate and keeps the original absolute expiry;
- in bridge/application, invalid/malformed/expired/revoked/replayed new tokens
  clear both names and never fall back to a valid legacy cookie;
- a session/authorization RPC transport, timeout, or malformed service response
  returns private no-store 503, grants no authority or fallback, sets no
  replacement, and preserves both existing cookies for bounded retry;
- in legacy, the new name is deliberately ignored and old provider-cookie
  semantics remain unchanged;
- bridge legacy-only succeeds without creating an identity/family, without
  reissuing legacy, and without silently adding the new cookie;
- bridge sign-in sets new only and clears an existing legacy cookie;
- application legacy-only denies and clears it; and
- logout revokes the new family and clears both cookie names even for unknown,
  already revoked, database-failed, provider-legacy-failed, and response-loss
  cases.

Exercise all four combinations: neither, legacy only, new only, and both. For
both, repeat every new-token state. Inspect exact before/after family/token/
audit aggregate deltas using synthetic isolated identities.

### One-touch and attestation matrix

For one administrator page, RSC request, Server Action, login-page redirect,
and draft-media request, instrument the disposable database and require exactly
one `use_app_session` touch followed by one `authorize_admin_principal` read.
Nested layouts and repeated `requireAdmin` calls
may verify a memoized request attestation but create no second RPC or rotation.

Send a client-controlled reserved header with a valid cookie. Proxy must remove
and replace it. Then prove missing, changed, malformed, wrong-secret,
wrong-cookie, wrong-class, expired-at-equality, and more-than-five-seconds-future
attestations all deny downstream authorization. The internal header must be
absent from response headers, redirects, HTML/RSC/action bodies, provider/RDB
subrequests, logs, traces, and browser performance resources.

Test a slow downstream render exceeding 30 seconds after the attestation was
verified. Authorization is checked at action/render entry; code must not expose
the header or re-verify it later as a renewable credential. A queued request
whose attestation expires before first verification denies rather than
extending the TTL.

### CSRF matrix

From a separate attacker origin, attempt ordinary form POST, fetch with JSON,
text/plain POST, image/link GET, and stale Server Action invocation against
login, logout, and a harmless isolated administrator mutation. Also send raw
requests with literal-null or mismatched Origin, Origin absent with no Referer,
Origin absent with cross-origin/malformed Referer, mismatched scheme/port,
forged Host, `X-Forwarded-Host`, `Forwarded`, and
`Sec-Fetch-Site: cross-site`. Prove that Origin absent with an exact
same-origin Referer is the sole permitted fallback.

Every case must yield no provider call, no session/identity/admin/domain row or
audit change, and no Set-Cookie except a safe clearing response where the
request was already unauthenticated. Exact same-origin browser POST must pass.
Server Action IDs and allowed-origin configuration must be inspected in the
production build; no wildcard or broad suffix is accepted.

- `CUTOVER-RUN-010`: A mocked cookie test, unit-only HMAC test, or origin-only
  request is insufficient. The exact production build must pass real-browser
  cookie, response-order, attestation, CSRF, and storage inspection.

## Response-loss and browser-order gate

The test harness must deliberately intercept responses **after** database
commit:

| Lost/delayed response | Required durable result and next behavior |
|---|---|
| admission Set-Cookie lost | one unreachable live family may remain; retry uses a new token and cap; no secret recovery |
| rotation Set-Cookie lost | old token succeeds only inside existing grace; after equality it denies/revokes as 019 specifies; reauthentication is safe outcome |
| logout clearing response lost | family already revoked; repeated request denies and clears cookie |
| older active/grace response arrives after rotated response | it must not replace the new cookie; selected runtime coordination is proven |
| five admission responses lost | five live families exist; sixth denies generically; service-only bulk revocation restores login without direct deletion |

Use a real browser/proxy to reorder responses. If the runtime cannot prevent an
older response from overwriting a newer rotated cookie, stop. Do not lengthen
grace or add raw successors to storage as a workaround.

`request_id` reuse tests must prove it provides correlation only. Repeating an
admission with a new secret can create another family up to the cap; repeating
logout/revocation is idempotent state transition; cleanup retry is another
bounded attempt.

- `CUTOVER-RUN-011`: Every ambiguous response test MUST assert exact committed
  row/audit/cookie effects and the safe reauthentication path. A client-visible
  success alone is not evidence.

## Cloudflare ingress and cache gate

Complete this gate in target-equivalent staging and repeat the non-destructive
probes immediately before production bridge.

### Exclusive origin

Inventory every public and alternate hostname, load balancer address, platform
default domain, origin IP, and IPv4/IPv6 path in the restricted infrastructure
system. Configure Full (strict) TLS plus either account-specific zone/per-host
Authenticated Origin Pulls or Cloudflare Tunnel. Restrict the origin firewall
and application virtual host accordingly.

From an external probe and an authorized direct-network probe, require:

- public hostname through Cloudflare succeeds;
- origin IP with public Host/SNI fails before application or returns a fixed
  non-application denial;
- alternate/default hostnames fail;
- a forged Cloudflare client certificate/header fails;
- a Cloudflare request reaches the application with the exact overwritten
  trusted Host/forwarded-host/client-IP policy; and
- duplicate/malformed client-IP headers fail closed rather than selecting a
  browser value.

Global Cloudflare AOP with the shared certificate is insufficient when an
account-specific certificate or Tunnel is the selected proof. Record only
reachability booleans and infrastructure version identifiers, never IPs or
certificates.

### Cache rules

Inspect rule source/order and use Cloudflare Trace without recording cookies.
The last matching effective rule must bypass:

```text
Cookie contains __Host-cs2cup-session
Cookie contains cs2cup_session
Authorization header present
/admin and /admin/**
/media and /media/**
/photos and /photos/**
authentication/session endpoints
Server Action request header present
method not GET or HEAD
```

No later Cache Everything, Edge TTL, status-code TTL, response-header removal,
or Worker Cache API path may override this. Worker private/provider/RDB fetches
must use `cache: 'no-store'` and never call cache `put`.

Probe each protected namespace with anonymous, malformed cookie, valid legacy,
valid new, both cookies, invalid-new-plus-valid-legacy, admin/non-admin, 2xx,
redirect, 401/403/404/405, RSC, prefetch, Server Action, and error responses.
Repeat each request from at least two edge locations where available. Require:

- canonical private no-store origin directive preserved;
- `CF-Cache-Status` never `HIT`, `STALE`, `UPDATING`, or another served-cache
  state;
- no authenticated body or Set-Cookie appears on a later anonymous request;
- HTML/RSC/prefetch/query variants do not collide; and
- invalid-new-plus-valid-legacy always follows new-cookie denial.

Run a declared non-secret fake reserved-attestation header through the public
edge and prove it is stripped/overwritten, never echoed. No production debug
endpoint may expose the replacement.

- `CUTOVER-RUN-012`: Direct-origin success, untrusted address/attestation
  acceptance, conflicting rule precedence, stripped no-store, or one protected
  cache hit blocks `CF-Connecting-IP`, bridge, and application mode.

## Deploy migration 020 and the inert 2B.3a/2B.3b legacy images

1. Work from the exact approved 2B.3a commit and image digest.
2. Take a consistent database backup and complete an isolated restore test with
   the previous image and representative public/admin writes.
3. Confirm all session integrations and cleanup schedules are disabled and
   mode is exact `legacy` fleet-wide.
4. Apply migration 020 with the repository runner and independent expected
   database name. Record normalized checksum and aggregate before/after proof.
5. Replay the runner; inspect exact wrapper signatures, definitions, owners,
   search paths, ACLs, RLS, and unchanged state.
6. Run the previous immutable production image against the migrated restored
   and target schema. Complete current login, console actions, draft media,
   logout, and public flows.
7. Deploy the 2B.3a image to a small canary, then fleet-wide, while release
   configuration keeps the unused flag absent or exactly `legacy`. Verify the
   new adapters remain unreachable; parser unit results, not runtime startup
   selection, are the 2B.3a mode evidence.
8. Run the complete legacy browser suite and compare aggregate identity/session
   counts to the post-migration baseline.
9. Observe at least one normal operational window for new 020 RPC calls,
   session/identity deltas, provider call shape, cache changes, errors, locks,
   latency, and secret-scan alerts. All cutover-specific traffic/deltas must be
   zero.
10. After the 2B.3a observation is approved, select the exact approved 2B.3b
    commit/image and repeat backup compatibility, production-build, browser,
    privacy, and configuration gates appropriate to its new wiring.
11. Prove an absent flag starts 2B.3b in `legacy` and every malformed value
    fails application startup. Then deploy its canary and fleet with mode still
    `legacy`; verify Proxy, login, logout, and DAL preserve legacy behavior and
    create no admission, authorization, new-cookie, or attestation traffic.
12. Observe a complete normal operational window and approve the inert 2B.3b
    baseline before any 2B.3c scheduler or mode work.

An application rollback at this point routes to the recorded previous image;
migration 020 remains installed. A schema defect receives an append-only 021
forward fix. Never drop 020 wrappers or ledger state to make the old image work.

- `CUTOVER-RUN-013`: Both 2B.3a and 2B.3b legacy observations must show zero admission,
  authorization, new-cookie, attestation, cleanup, and ordinary-traffic
  identity/session effects. Non-zero state blocks all further work.

## Enable the bounded cleanup scheduler

Enable cleanup first in staging with no live cutover sessions. The scheduler
uses only the trusted service RPC, no direct private relation, a secret-store
credential, and one invocation every 15 minutes:

```text
batch size:            250 per relation
maximum batches/run:   4
wall budget:           30 seconds
request UUID:          fresh for every batch
overlap:               allowed and tested
returned/logged data:  aggregate deletion counts and fixed result only
```

Seed only synthetic disposable staging rows through normal RPCs and advance
test-controlled time only where the migration test controls permit it. Prove
24-hour eligibility equality, live/revoked/expired behavior, locked-row skip,
two-worker overlap, partial budget, provider/database timeout, and retry.

Then enable in production while still `legacy`. An empty run is expected.
Alert on three consecutive failures or 60 minutes without success. A scheduler
incident does not authorize an unbounded query/delete, private row export, or
session-validity workaround.

- `CUTOVER-RUN-014`: Cleanup MUST be healthy before bridge creates durable
  session/throttle state, but its health MUST NOT be used as evidence that
  expiry/revocation checks are correct.

## Pre-bridge fleet drain and readiness

Before the first bridge login:

1. Complete every provider, browser, response-loss, migration, Cloudflare,
   scheduler, and rollback rehearsal above against the exact image.
2. Verify every production instance runs the same 2B.3-capable digest in
   `legacy`; remove old instances, queued revisions, autoscaling templates,
   warm pools, disaster targets, and jobs that can route HTTP.
3. Prove the load balancer cannot resurrect the previous revision and that
   health checks expose the reviewed digest/mode only to operations.
4. Record the previous compatible 2B.3 image as rollback target. The pre-2B.3
   image is removed from automatic rollback.
5. Verify database connection capacity for one session-use write plus one
   administrator-authorization read per authenticated request and rehearse
   expected admin page/media concurrency.
6. Confirm CloudBase and database provider status, alerting, incident owners,
   secret versions, and exact mode-change mechanism.
7. Freeze direct edits to `admin_user` and Principal status. An emergency
   authority change uses the reviewed service revocation procedure and records
   only aggregate effect.
8. Agree on a short administrator login window so one designated operator is
   the first new sign-in before ordinary administrators are invited to sign in.

- `CUTOVER-RUN-015`: No pre-2B.3 HTTP instance or automatic rollback target may
  remain once `bridge` can issue a new-only cookie.

## Bridge enablement and canary

Change the fleet atomically to exact `bridge`; reject a partially updated
fleet. Record the transition time as the **last possible legacy-cookie issuance
time**, because `legacy` mode could issue one immediately before the change.
The drain deadline is exactly that timestamp plus eight hours.

Before inviting ordinary use, the designated administrator performs one clean
login in a fresh browser. Verify, without recording private values:

- both throttle dimensions consumed before provider calls, then only account
  cleared after complete success;
- one exact provider double proof with three equal subjects, exact client ID,
  ACTIVE status, and the independently approved issuer pin;
- exactly one Principal/AuthIdentity/bridge or the exact idempotent existing
  mapping; exactly one family/current token and one `session.created` event;
- no more than five live families and no unexpected identity/profile/role row;
- only the new cookie is stored, with exact attributes/deadline; legacy absent;
- provider token discarded inside the proof call and absent from all browser,
  persistent application, database, cache, and evidence surfaces;
- the new session still loads admin page/RSC/draft media and performs one
  harmless reversible test action;
- each request produces one use/touch, then one administrator-authorization
  read and one valid downstream attestation, not another touch; and
- logout revokes exactly that family and clears both names.

Repeat sign-in once for ongoing canary observation. Exercise a controlled
rotation and grace request, then logout. Do not force token replay against a
production family merely to demonstrate the test; replay evidence comes from
disposable staging.

During canary, also exercise one existing legacy-only browser. It must continue
to work, receive no new/renewed cookie, create no Principal/family, and follow
the old allowlist. An invalid new cookie placed beside that valid legacy cookie
must deny and clear both.

Abort bridge immediately for a provider mismatch, unexpected
identity/bridge, cap error, missing audit, duplicate touch, wrong cookie,
legacy reissue/lazy mint, downgrade fallback, secret observation, cache hit,
direct-origin success, elevated deadlocks/timeouts, or material regression.

- `CUTOVER-RUN-016`: Bridge canary success is exact state-transition evidence,
  not merely a 200 page or visible console.

## Bridge observation and legacy drain

Keep `bridge` for the complete interval through the recorded eight-hour drain
deadline. Do not reset the deadline based on first new login or an estimated
average legacy age. Monitor only fixed aggregate signals:

- provider proof success/generic failure/timeout and latency;
- admission success/generic policy denial/operational failure, plus restricted
  aggregate cap health without per-attempt or identity labels;
- application versus legacy authorization success, denial, and latency;
- active/grace/rotated/generic-denial result counts;
- family/token/throttle/audit aggregate counts and oldest eligible cleanup age;
- cleanup batches/deletions/duration/failures;
- database connections, locks, deadlocks, timeouts, write volume, and latency;
- new/legacy cookie-name presence counts only if the edge can count names
  without retaining values;
- protected cache status, origin bypass, reserved-header, CSRF, and secret-scan
  alerts; and
- fleet digest/mode consistency.

Legacy successful use may continue before the deadline and does not create an
application session. New sign-in always creates only a new session. Provider
outage may deny legacy/new login while existing application sessions continue;
do not turn that availability difference into fallback.

At/after the deadline, run a legacy-only browser probe made from a cookie
issued immediately before bridge in the rehearsal environment and require
denial by provider expiry/current policy. Production transition does not depend
on seeing every browser return. Require no pre-2B.3 instance, no legacy issuance
path in bridge, healthy scheduler, stable error/latency, and all security probes
before application mode.

- `CUTOVER-RUN-017`: The earliest application-mode transition is the exact
  recorded last-legacy-issuance time plus eight hours. A mode change before
  that instant is forbidden even if aggregate legacy traffic is zero.

## Application-mode transition

Change the complete fleet atomically from `bridge` to `application`. Verify:

1. a valid new cookie continues without reauthentication and uses one touch;
2. new rotation, grace, expiry, revocation, and logout retain exact behavior;
3. legacy-only and no-cookie requests are unauthenticated and legacy is
   cleared;
4. both-cookie requests use only the new cookie and clear legacy;
5. invalid-new-plus-valid-legacy denies and clears both;
6. new login performs provider proof/admission, discards the provider token,
   and sets only new;
7. current administrator actions and draft media retain behavior;
8. no provider call occurs on normal application-session use;
9. no cache, attestation, CSRF, privacy, ingress, or scheduler invariant changes;
   and
10. every instance reports the same application mode and exact digest.

Observe for at least one complete eight-hour application absolute lifetime and
one additional successful cleanup interval before proposing legacy contraction.
Longer observation may be selected from traffic/risk; it never makes a failed
gate acceptable.

- `CUTOVER-RUN-018`: Application mode is accepted only after new, legacy-only,
  and both-cookie browser matrices pass at the deployed edge and aggregate
  database effects match the model.

## Legacy compatibility contraction

Open a separate PR after stable application observation. It may remove legacy
verification/issuance branches, `cs2cup_session` reads, obsolete provider-token
cookie helpers, and legacy-only tests only when it preserves:

- unconditional clearing/ignoring of `cs2cup_session` at protected boundaries
  for at least the reviewed compatibility horizon;
- application-cookie authorization, one-touch attestation, CSRF, no-store,
  provider sign-in exchange, logout, and rollback behavior;
- migrations 018–020 and all identity/session/throttle/audit rows;
- a rollback image that understands the application cookie; and
- a regression test proving a legacy cookie can never regain authority.

The contraction uses the repository's expand/deploy/contract discipline and
its own canary. It does not drop migration 019/020 RPCs or remove legacy
`admin_user.user_id` while that value is still needed to admit a newly verified
CloudBase administrator. Replacing the allowlist source is a later explicit
authorization migration.

- `CUTOVER-RUN-019`: Legacy-cookie code retirement and administrator-allowlist
  replacement are different changes. Neither may be smuggled into first
  application traffic or inferred from `role_assignment`.

## Rollback matrix

### Before migration 020

No cutover state exists. Revert the documentation/application release normally.
No database action is required.

### After migration 020, before bridge

Route to the recorded previous image. Leave migration 020 and its ledger/ACLs
installed and inert. Require unchanged legacy login/admin/logout and aggregate
session state. Repair a defect with 021 or later.

### During bridge

1. Stop further sign-in traffic and mode changes.
2. Keep or route to the recorded **2B.3-capable** image; never use pre-2B.3.
3. Prefer staying `bridge` while fixing a non-authentication product defect.
4. If the application-session path itself is unsafe, keep fail-closed bridge
   semantics on the last healthy 2B.3-capable image, stop new login, and take
   protected traffic unavailable if necessary. Do not select `legacy`: it
   ignores the new cookie and can fall back to legacy.
5. Revoke affected new families through service-only single/Principal-wide
   RPCs as the incident requires. Do not delete rows or tokens.
6. Preserve migration 020, bridges, token lineage, throttle, and audit.
7. Re-run provider/ingress/cache/privacy probes before any bridge resume and
   record a new rollout decision before any bridge resume.

### During application mode

Prefer rollback to the last healthy application-capable digest in
`application`. If compatibility is required, `bridge` can still accept new
sessions while legacy-only state should already be expired; monitor for any
unexpected legacy success. `legacy` is not a safe rollback mode after bridge
because it deliberately ignores the new name and may accept legacy.

### After legacy contraction

Rollback only to an application-capable pre-contraction image. Restoring a
pre-2B.3 image or provider-token fallback requires a new security review and is
not an incident shortcut.

### Database disaster

Normal rollback never restores the pre-migration backup because that would
discard legitimate post-backup writes. If a database defect prevents every
compatible image, stop writes and follow the separately authorized disaster
recovery process. Prefer a narrow append-only forward migration. Never edit
019/020, their checksums, or ledger; never drop/truncate private state or audit.

- `CUTOVER-RUN-020`: Every rollback target MUST understand all credentials
  already issued or fail them closed. Convenience does not authorize a
  downgrade-capable pre-2B.3 image.
- `CUTOVER-RUN-021`: Application rollback retains schema and evidence. Direct
  data deletion, down migration, ledger mutation, expiry extension, grace
  extension, or token reconstruction is prohibited.

## Incident playbooks

### Provider outage or mismatch

- Stop new login/cutover transitions; do not enable local JWKS or relax exact
  fields in production.
- Existing application sessions continue through database authorization.
  Legacy sessions and new sign-ins may fail closed.
- Verify official provider status and redacted fixed outcome rates.
- If a documented provider contract changed, keep application mode for existing
  sessions, prepare a reviewed adapter/ADR update, and repeat staging proof.
- Never log a live token to ask provider support for help.

### Family cap reached

- Return generic login failure; do not reveal count or devices.
- Confirm only aggregate live-family count and expiry health through restricted
  operations.
- With identity-owner approval, use the service-only Principal-wide revocation
  command and normal audit path, then reauthenticate.
- Do not delete oldest rows, raise the cap ad hoc, clear audit, or infer that a
  repeated request ID identifies an unreachable family.

### Suspected token replay or invalid-new downgrade attempt

- Keep new-cookie precedence and generic denial; clear both cookie names.
- Preserve migration 019's terminal token-reuse revocation/audit.
- Inspect aggregate security-event counts and origin/cache/access controls;
  never export the token digest or cookie.
- Revoke the Principal's sessions if incident scope requires it and rotate
  attestation/provider/service secrets only when exposure evidence warrants.

### Authenticated cache hit

- Stop traffic shift; disable the offending Cache Rule/Worker cache path and
  purge affected cache scope using approved Cloudflare operations.
- Route protected traffic to a verified bypass or take it unavailable; do not
  accept continued exposure during investigation.
- Treat any body/cookie exposure as a data-security incident, preserve
  sanitized evidence, revoke affected sessions, and repeat every edge probe.

### Direct-origin or trusted-header bypass

- Disable `CF-Connecting-IP` trust and bridge/application login immediately;
  fail closed if no other proven source exists.
- Restrict origin networking/mTLS/Tunnel and rotate attestation secret if an
  internal signed header may have been reachable.
- Repeat public/direct IP, alternate-host, duplicate-header, Host/SNI, cache,
  and CSRF probes before resuming.

### Database/session authorization outage

- Fail the current authenticated request closed with private no-store 503;
  grant no authority, fallback, or replacement cookie, while preserving the
  presented cookies for bounded retry.
- Do not cache a prior authorization or fall back to provider/legacy in
  application mode.
- Roll back to the last compatible image if code caused the outage; use forward
  migration for schema defects.
- Session cleanup may pause; validity checks may not.

## Exact go/no-go records

### 2B.3a merge

All must be true:

- the diff is limited to the reviewed ADR/runbook, migration 020, pure
  production-remote CloudBase proof and fingerprint/session/cookie/CSRF
  adapters, their deterministic database/unit tests, and necessary
  lifecycle/package/environment-example/CI wiring;
- primary links were checked on the review date;
- facts, repository decisions, inference, and unavailable staging evidence are
  visibly separate;
- migration 020 lifecycle/ACL and the explicitly 2B.3a-scoped admission
  concurrency harness, remote-provider/fingerprint/session/cookie/CSRF adapter
  tests, build, packaging, and old-image compatibility pass;
- session RPC default/maximum deadlines, strict calendar/clock and login-retry
  parsing, complete transport-error remapping, and the forced-failure dynamic
  stdout/stderr redaction canary pass;
- admission claim tests deny missing, malformed, `anon`, `authenticated`, and
  `club_admin`, while the signed `service_role` reaches only the expected
  non-secret boundary;
- no new dev/test-local `VerifiedProviderProof` adapter is claimed; existing
  `lib/jwt.ts` remains legacy-only;
- mode-parser units prove absence → `legacy` and malformed input → parser
  rejection, without claiming application-startup enforcement; and
- no Proxy/login/logout/DAL/attestation/browser/scheduler wiring or
  runtime/deployment action occurred.

### 2B.3b merge/deploy in legacy

All must be true:

- complete wiring CI/preflight and independent reviews pass;
- the explicit dev/test-local `VerifiedProviderProof` adapter passes its local
  issuer/audience/expiry/signature/subject vectors, and production-mode plus
  production-build tests prove it cannot be selected;
- production build/browser/response-loss/privacy tests pass;
- absent mode defaults to legacy; malformed mode fails startup;
- no production JWKS/local-proof selection is possible, and legacy
  `lib/jwt.ts` is not treated as new-proof evidence;
- ordinary legacy traffic leaves 018–020 state unchanged;
- migration backup restore and forward-fix plan pass; and
- no cleanup or session traffic is enabled.

### 2B.3c bridge go

All must be true:

- exact target release passed fresh provider staging proof;
- exact issuer/client/three-subject/ACTIVE evidence has two reviewers;
- browser cookie/attestation/CSRF/response-order matrix passes;
- Cloudflare origin/header/cache matrix passes at the deployed edge;
- scheduler is bounded, healthy, overlap-tested, and privacy-safe;
- every fleet instance is the same 2B.3-capable digest in legacy;
- pre-2B.3 rollback/autoscaling targets are drained;
- database capacity/latency/locks are within rehearsed bounds;
- designated canary, owners, abort threshold, and compatible rollback are
  recorded; and
- the mode change is atomic.

### Application go

All must be true:

- bridge canary exact state evidence and ongoing application sessions pass;
- recorded last legacy issuance plus eight hours has elapsed;
- no bridge code issued or lazily minted legacy sessions;
- provider/session/database/cache/privacy/ingress/scheduler signals are stable;
- new/legacy/both-cookie application-mode probes pass;
- no pre-2B.3 instance or rollback target exists; and
- rollback to a reviewed application-capable image is rehearsed.

### Legacy contraction go

All must be true:

- at least one complete eight-hour application-session lifetime and another
  cleanup interval passed in stable application mode;
- zero legacy authorization success is observed after the drain;
- application/new-cookie and legacy-denial browser matrices still pass;
- the contraction PR preserves `admin_user.user_id` admission unless a separate
  authority ADR/migration replaces it;
- rollback uses an application-capable image; and
- migrations/private state/audit remain untouched.

If any item is unknown, skipped, stale for another release/environment, or
supported only by a screenshot without reproducible evidence, the answer is
**no-go**.

- `CUTOVER-RUN-022`: Go/no-go is conjunctive. No individual owner, successful
  canary, provider status page, green PR, or business urgency can waive a
  missing gate.

## Operational source references

Provider facts:

- CloudBase [`/auth/v1/signin`](https://docs.cloudbase.net/http-api/auth/auth-sign-in)
- CloudBase [PG authentication/JWT claims](https://docs.cloudbase.net/authentication-v2/auth/auth-pg)
- CloudBase [`/auth/v1/user/me`](https://docs.cloudbase.net/http-api/auth/user-me)
- CloudBase [token introspection](https://docs.cloudbase.net/http-api/auth/auth-token-introspect)
- CloudBase [token lifecycle settings](https://docs.cloudbase.net/authentication-v2/auth/token)
- CloudBase [refresh/token grant](https://docs.cloudbase.net/http-api/auth/auth-grant-token)
- CloudBase [sign-out](https://docs.cloudbase.net/http-api/auth/auth-sign-out)

Framework/security facts:

- Next.js [Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy),
  [cookies](https://nextjs.org/docs/app/api-reference/functions/cookies), and
  [data/Server Action security](https://nextjs.org/docs/app/guides/data-security)
- [NIST SP 800-63B-4 Session Management](https://pages.nist.gov/800-63-4/sp800-63b/session/)
- OWASP [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
  [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html),
  [CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
  and [Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

Cloudflare facts:

- Workers [`fetch`](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
  and [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- Cache Rules [bypass on cookie](https://developers.cloudflare.com/cache/how-to/cache-rules/examples/bypass-cache-on-cookie/),
  [settings](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/),
  and [last-conflicting-rule precedence](https://developers.cloudflare.com/cache/how-to/cache-rules/order/)
- [Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)
  and its [origin-isolation explanation](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/explanation/)

These sources do not certify this deployment. Exact issuer, provider responses,
timeouts, cookie behavior, Next build routing, Worker code, Cache Rules,
authenticated origin, header overwrites, scheduler, and rollback compatibility
must be proven for the exact target release as described above.
