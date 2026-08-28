# ADR 0003: Explicit data and HTTP cache boundaries

- Status: Accepted
- Date: 2026-08-28
- Tracking: [#13](https://github.com/Egger0/cs2cup/issues/13)
- Scope: Phase 2B.1

## Context

Before this decision, [`lib/rdb.ts`](../../lib/rdb.ts) accepted an optional
transport credential and inferred the cache policy with
`credential !== 'admin'`. That happened to keep the only privileged credential
out of the Next.js Data Cache, but it was not a durable security boundary:

- a later participant/session credential would have entered the cacheable GET
  branch automatically;
- `revalidate: false` meant no-store only inside the repository wrapper, while
  the same value has a different meaning in the native Next.js fetch API;
- public search queries omitted a policy and relied on route-level dynamic
  behavior; and
- relation-wide `select=*` projections could silently add a newly introduced
  column to a shared cache entry.

The HTTP boundary was also incomplete. Media handler responses used `no-store`,
but administrator redirects and framework-generated canonical redirects did
not consistently send a cache policy. This matters because `Set-Cookie` alone
does not prohibit storage, and redirects and errors can otherwise be cached by
intermediaries. See [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) and
[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html).

Phase 2B will add authenticated participant and application-session data. Its
implementation cannot begin while credential names, data visibility and cache
scope remain coupled.

## Decision

### Cache classes

Every server-side data access and every application response belongs to one of
three classes:

| Class | Data eligibility | Next Data Cache | Shared HTTP/edge cache |
|---|---|---|---|
| `public-revalidate` | Published, user-independent DTO from an approved anonymous relation | Allowed for an explicit positive TTL and reviewed tags | Allowed only for a route that separately satisfies the Full Route Cache contract |
| `public-no-store` | Public but live, high-cardinality, query-driven, or authorization-adjacent data | Forbidden | Forbidden |
| `private-no-store` | Any session, identity, role, allowlist, unpublished, ownership, contact, moderation, rate-limit, audit, or privileged mutation data | Forbidden | Forbidden |

Authentication state never selects a cache mode. Adding another credential or
repository adapter does not change this classification.

All cacheable public call sites in this adoption slice use a 300-second data
TTL. This is a reviewed current value, not a repository-wide maximum:
`PublicDataCache` accepts any positive safe integer so a future TTL change is a
visible call-site decision. `next.config.ts` uses `expireTime: 600` to bound the
stale window that Next emits for ISR HTTP responses; it does not limit the Data
Cache TTL. A lower dependent fetch revalidation time controls the route's
effective revalidation frequency, so the current feed is 300 seconds.

### Repository API

[`lib/rdb.ts`](../../lib/rdb.ts) exposes separate capability-shaped functions:

| API | Endpoint | Cache contract |
|---|---|---|
| `selectPublicRows`, `selectPublicRow` | anonymous | caller MUST provide `cache: {mode:'revalidate', seconds, tags}` or `cache: {mode:'no-store'}` |
| `selectPrivateRows`, `selectPrivateRow` | server-private | always `cache:'no-store'`; no cache option is accepted |
| `insertPrivateRows`, `updatePrivateRows`, `deletePrivateRows` | server-private | always `cache:'no-store'` |
| `callPublicFunction` | anonymous | POST and always `cache:'no-store'` |
| `callPrivateFunction` | server-private | POST and always `cache:'no-store'` |

The public relation allowlist is deliberately narrow:

```text
club_member
game
match
match_map_public
photo_public
player_public
post
site_setting
team_public
tournament
```

The only public RPC in this slice is `registration_status`. The anonymous
product action `submit_team_rate_limited` remains a private call because its
payload contains registration contact data and it requires the privileged
server transport.

TypeScript rejects a private relation or privileged RPC passed to a public
API. The transport repeats the public allowlist check at runtime. Public reads
also use explicit column projections, so adding a column to a relation cannot
silently add it to a shared cached DTO. Database RLS and views remain the
authoritative exposure boundary; this allowlist and projection are additional
application defenses, not substitutes for database policy.

[`lib/rdb-cache-policy.ts`](../../lib/rdb-cache-policy.ts) is the adapter seam
between the repository contract and the current Next.js fetch options. It
rejects non-positive TTLs, more than 128 tags, and tags outside the documented
1–256 character range. A Cloudflare adapter may replace this translation, but
must preserve the three repository classes. See the official
[Next.js fetch API](https://nextjs.org/docs/app/api-reference/functions/fetch).

### Current call-site classification

The 59 repository calls at adoption are fixed as follows:

- 14 `public-revalidate` reads: site settings, tournaments, published entry and
  roster views, public matches/maps/photos, members, posts, and games;
- 6 `public-no-store` reads: registration status, four search relations, and
  the public media authorization lookup; and
- 39 `private-no-store` reads, writes, and RPCs across authentication,
  administrator content/match operations, unpublished media and anonymous
  registration submission.

Search remains no-store even though its results are public. Its arbitrary user
input would create an unbounded cache-key space and make negative-result
caching difficult to invalidate safely.

### HTTP response contract

Every response under these namespaces that can depend on authentication,
authorization, publication state, private data, or application failure is
private and non-storable, regardless of method or status:

```text
/admin
/admin/**
/media
/media/**
/photos
/photos/**
```

The canonical response directive is:

```text
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
```

Tests parse directives without relying on their order. They require all five
directives and reject `public`, `s-maxage`, and `immutable`.

The policy is applied in two places:

1. `next.config.ts` supplies a namespace-level header before configured
   redirects, Proxy, and filesystem routing. This covers routed 404/405
   responses, the login page, Server Components, RSC payloads and Server
   Actions. See [Next.js headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers)
   and [Proxy execution order](https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
2. Direct Proxy redirects/404s and the guarded media handler set the same value
   themselves. The explicit local response remains correct if routing changes
   later.

Next.js emits its automatic trailing-slash 308 before custom headers. That
response contains no identity-dependent body, cookie mutation, authorization
decision, or resource-existence decision; it only maps a protected path to the
same canonical path. It is therefore a documented structural exception rather
than a reason to move trailing-slash handling into a Proxy that would run on
every public request. Tests require its exact status and Location. Cloudflare
deployment still bypasses the complete protected namespace, including this
redirect.

The media URL is authorization- and publication-sensitive: one key can be an
anonymous 404, administrator 200, published anonymous 200, then immediately a
404 after withdrawal. Every state is no-store, and `/media/**` remains excluded
from the shared Next image optimizer.

### Public route behavior in this slice

`/search`, `/tournaments/[slug]`, registration and schedule are explicitly live
public routes. Search has high-cardinality input; overview and registration
read the live capacity RPC; schedule reads request search parameters. Their
HTML responses remain no-store.

The shared public layout exports `revalidate = 0`. Per Next's documented route
segment contract, this keeps its HTML request-rendered while preserving an
explicit positive `next.revalidate` on a descendant fetch. It deliberately does
not use `dynamic = 'force-dynamic'`, because that setting is equivalent to
`fetchCache = 'force-no-store'` and would override every descendant fetch.

The production image is built without a database and currently uses a build
fallback. Keeping the shared HTML request-rendered prevents fallback/empty HTML
from being persisted in the Full Route Cache while ordinary public pages can
still use explicit `public-revalidate` entries in the Data Cache. Live routes
use `dynamic = 'force-dynamic'` locally, which intentionally makes all their
descendant fetches no-store. Enabling public HTML ISR is a separate reviewed
change that must:

- provide `generateStaticParams` or an equivalent runtime-ISR contract for
  dynamic paths;
- prove fallback content is not frozen during the database-free image build;
- keep live/query routes dynamic; and
- inspect `.next/prerender-manifest.json` plus origin response headers.

This follows the current
[Next.js caching model](https://nextjs.org/docs/app/guides/caching-without-cache-components),
[route segment configuration](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config),
and [ISR requirements](https://nextjs.org/docs/app/guides/incremental-static-regeneration).

`React.cache(getCurrentAdmin)` remains allowed only as request-scoped memoization.
It is not a persistent session cache; React invalidates it between server
requests. It MUST NOT be replaced by `unstable_cache`, `use cache`, or a
module-level session result. See [React `cache`](https://react.dev/reference/react/cache)
and the [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication).

### Cloudflare constraints

The Cloudflare migration must preserve this origin contract:

- cache rules MUST bypass `Authorization`, the application-session cookie, and
  `/admin*`, `/media*`, `/photos*`, authentication and session endpoints;
- protected responses MUST never be overridden by an Edge TTL or Cache
  Everything rule;
- the CDN MUST forward the `rsc` request header; when
  `next-router-prefetch` is present it MUST forward that header too; cache keys
  MUST retain the complete query string including `_rsc`, so HTML, RSC and
  prefetch payloads cannot collide (see the official
  [Next.js CDN guide](https://nextjs.org/docs/app/guides/cdn-caching));
- Next tag/path invalidation is not an outer-CDN purge protocol, so HTML cannot
  enter an additional Cloudflare cache before dual HTML/RSC invalidation is
  designed and tested; and
- the final static-asset manifest MUST exclude ignored local `public/photos/**`
  objects. Worker-first `/photos/*` routing is defense in depth, not a reason to
  upload private legacy assets.

Cloudflare's default cache key does not include cookies. Its default behavior
and origin directives therefore cannot be treated as per-user partitioning.
See [default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/),
[cache keys](https://developers.cloudflare.com/cache/how-to/cache-keys/),
[bypass on cookie](https://developers.cloudflare.com/cache/how-to/cache-rules/examples/bypass-cache-on-cookie/),
and [Workers static assets](https://developers.cloudflare.com/workers/static-assets/binding/).

Next currently emits `s-maxage=300, stale-while-revalidate=300` for the feed,
but that header does not promise the same stale behavior on Cloudflare.
Cloudflare documents that `s-maxage` implies `proxy-revalidate` and disables
`stale-while-revalidate`; an Edge TTL rule can also override the origin
directives. Migration acceptance MUST therefore verify the selected adapter's
actual ISR/revalidation behavior at the edge (including expiry, concurrent
requests and purge) instead of treating the Node origin header as a portable
Cloudflare ISR contract. See Cloudflare's
[Origin Cache Control](https://developers.cloudflare.com/cache/concepts/cache-control/).

The generic Workers Cache API is data-center local and is not a replacement
for Next ISR. A later architecture decision must select and validate a Next.js
Workers adapter before mapping revalidation and purge behavior. See the
[Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
and [Cloudflare's Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/).

## Normative rules for later agents

- `CACHE-001`: Unclassified data and responses fail closed to no-store.
- `CACHE-002`: Only an approved anonymous relation and explicit projection may
  use `public-revalidate`.
- `CACHE-003`: Private/session data cannot accept a caller-selected persistent
  cache policy.
- `CACHE-004`: All mutations and RPC calls are no-store, even when an RPC is
  read-only.
- `CACHE-005`: High-cardinality search and publication/authorization checks are
  no-store.
- `CACHE-006`: Authentication, allowlist, role, ownership, revocation and
  session results never persist across requests.
- `CACHE-007`: A response influenced by Cookie, Authorization, user identity,
  unpublished data, or `Set-Cookie` is private no-store.
- `CACHE-008`: Identity/data-dependent 3xx, 4xx and 5xx responses use the same
  private no-store directive as protected 200 responses; the bodyless,
  identity-independent trailing-slash 308 is the only current exception.
- `CACHE-009`: Public HTML and RSC cannot enter an outer CDN until their cache
  keys and invalidation are designed together. The CDN must forward `rsc`,
  preserve `next-router-prefetch` when present, retain `_rsc` in the cache key,
  and purge HTML/RSC variants together.
- `CACHE-010`: Adding an authenticated participant transport requires a new
  private-no-store API; it must not widen the public API or add a credential
  branch to cache selection.
- `CACHE-011`: Future account chrome must not make the shared public layout
  read a session; account state belongs in a private route or isolated private
  endpoint.
- `CACHE-012`: Cloudflare deployment fails if the asset manifest contains
  `/photos/**` or if any protected probe returns an edge cache hit.
- `CACHE-013`: Cloudflare deployment cannot infer ISR semantics from Next's
  origin `Cache-Control` header; adapter-level expiry, revalidation,
  concurrency and purge probes must pass at the deployed edge.

## Verification

The deterministic transport test captures real fetch calls and proves:

- public revalidation emits only `next.revalidate/tags`;
- public no-store emits only `cache:'no-store'`;
- the shared public layout uses `revalidate = 0`, not `force-dynamic`, so it
  cannot override explicit positive fetch revalidation;
- private GET, every table mutation, and both RPC transports are no-store;
- public relation/function allowlists reject private names;
- row lookup preserves policy and forces `limit=1`;
- invalid TTL/tag bounds fail closed; and
- network errors retain the repository `RdbError(503)` contract.

Compile-time tests reject missing public policy, private relations/RPCs in the
public API, caller-selected credentials, and cache options on private reads.

Production container and isolated-browser tests cover anonymous, invalid,
non-admin and admin documents; RSC; canonical 308 targets; login; guarded
media draft/publish/withdraw transitions; and `/photos/**` rejection. Public
tests prove the feed remains shared-cacheable while live/query routes remain
no-store.

## Consequences and non-goals

This change makes visibility and caching explicit without changing login,
logout, current administrator authority, registration behavior, database
schema, or the current CloudBase token cookie. Phase 2B.2 adds the revocable
session store; Phase 2B.3 performs the compatible opaque-cookie cutover.

The explicit API is intentionally more verbose. That is the review surface:
adding a public relation, public RPC, projection, tag, or persistent cache now
requires a visible code change and corresponding security evidence.
