# ADR 0001: Guard anonymous registration at the database boundary

- Status: Accepted
- Date: 2026-08-28
- Tracking: [#12](https://github.com/Egger0/cs2cup/issues/12)

## Context

Team registration is anonymous today. Browser checks and separate
read-then-write counters can be raced, skipped or fail open. Raw client
addresses are personal data and should not be retained merely to enforce an
abuse limit. The application also needs a rolling migration path that keeps the
old server version usable until it has drained.

CloudBase adds an important database-boundary constraint. Its public PostgREST
gateway exposes RPCs from the `public` schema and documents that PostgreSQL
function `EXECUTE` grants are not enforced for those calls. A revoked grant is
therefore useful defense in depth for direct PostgreSQL and local PostgREST, but
is not authorization for a CloudBase-reachable `SECURITY DEFINER` function.

## Decision

- A trusted server derives a versioned HMAC-SHA-256 fingerprint from one
  explicitly configured, ingress-owned address source. IPv4 addresses remain
  exact; IPv6 privacy addresses share their stable `/64`. Raw addresses are
  never stored.
- Production accepts only `x-real-ip` or `cf-connecting-ip`, and remains
  fail-closed until staging proves the selected ingress overwrites that header
  and the origin cannot be reached around the ingress. There is no legacy
  forwarding-header fallback.
- PostgreSQL takes a transaction-scoped advisory lock for the fingerprint,
  records the attempt, checks the one-hour window and submits the team in one
  transaction. Invalid and failed submissions consume capacity.
- Privileged implementations live in the non-exposed `app_private` schema as
  `SECURITY INVOKER` routines. Request roles, the local admin role and the
  managed service role receive no schema or function access there.
- Every gateway-reachable privileged wrapper is `SECURITY DEFINER`, has a fixed
  search path, and validates the signed `request.jwt.claims.role` inside its
  body before delegating. Database ownership is not a claims bypass. Dedicated
  loopback-only authenticators model `anon` and `service_role` for local
  PostgREST without using a superuser connection.
- Deployment uses expand/deploy/contract. Expand migrations 014 and 017 add
  the atomic guard and claims-checked compatibility wrappers. After the new
  image is healthy and old instances drain, contract migration 014 removes
  local compatibility access and contract migration 017 physically drops the
  two legacy public registration endpoints.
- The migration runner records normalized SHA-256 checksums, validates the
  repository and ledger in both directions, and refuses every contract batch
  unless its exact expand migration and checksum are present. The coordinated
  rollback recreates guarded compatibility wrappers and clears only contract
  ledger entries 014 and 017; it does not undo the private-core architecture.
- Registration status and submission responses do not reveal whether a guessed
  unpublished tournament slug exists.

## Consequences

- Concurrent submissions cannot exceed the per-fingerprint database limit.
- Invalid and failed attempts consume quota, closing a cheap abuse path at the
  cost of occasional inconvenience for users sharing an address.
- Operators must configure a dedicated HMAC secret and explicitly proven client
  address source before production traffic is shifted. Missing configuration
  rejects registration.
- The CloudBase admin API key remains a highly privileged server credential.
  Claims checks reduce the exposed RPC surface but do not make that key safe for
  browsers, logs or client bundles.
- A rollback after contraction must restore compatibility before traffic moves
  to the old image. The exact sequence is defined in the
  [registration rollout runbook](../runbooks/registration-rate-limit-rollout.md).
- Address fingerprints remain an interim anonymous-user control. Account
  ownership, challenge-based abuse protection and edge limits can supplement or
  replace it in later phases.

## Alternatives considered

- Browser or user-agent fingerprints were rejected because clients control and
  rotate them, while collecting more attributes would worsen privacy.
- An application-only counter was rejected because separate count and insert
  operations are raceable and process-local state does not coordinate replicas.
- PostgreSQL grants alone were rejected as the CloudBase RPC authorization
  boundary because the managed gateway does not enforce them.
- An edge-only limit was rejected as the sole control because ingress products
  and hosting architecture will change; edge limiting remains defense in depth.
- Requiring participant accounts immediately was deferred to the product and
  identity phase so this boundary can ship independently.
