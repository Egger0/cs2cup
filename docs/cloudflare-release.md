# Cloudflare release checklist

All production Cloudflare resources and deployment authority belong to
`@Egger0`. Contributors must not create or deploy equivalent resources from a
personal Cloudflare account.

## One-time target-account setup

1. Create a dedicated PostgreSQL login that inherits `club_admin` and no
   broader role. Store its password only in the target secret manager.
2. Create a cache-disabled Hyperdrive configuration in the target account.
   Supply the direct TLS connection through the target account's approved
   secret workflow (or the dashboard), never a committed file or shell
   history. The Wrangler option is `--caching-disabled`.

3. Replace `SET_BY_EGGER0_IN_TARGET_CLOUDFLARE_ACCOUNT` in `wrangler.jsonc`
   with the returned configuration ID.
   Before promotion, `@Egger0` must run `wrangler hyperdrive get <ID>` in the
   target account and attach output showing `caching.disabled=true` to the
   release record. This is a blocking authorization and read-after-write gate:
   Hyperdrive writes do not invalidate cached `SELECT` results.
4. Bind the private production R2 bucket as `CS2CUP_MEDIA`. Do not enable an R2
   public endpoint.
5. Create a self-hosted Access application covering both `/admin` and
   `/admin/*`. Use an explicit administrator Allow policy; do not use an
   Everyone or Bypass rule.
6. Store `CF_ACCESS_ISSUER` (the exact HTTPS team origin),
   `CF_ACCESS_AUDIENCE` (the application AUD), and
   `REGISTRATION_FINGERPRINT_SECRET` as the target Worker's required secrets.
7. Set `NEXT_PUBLIC_SITE_URL` to the exact production origin in both the
   Workers Builds build variables and the Worker's runtime variables. Wrangler
   owns `PHOTO_UPLOAD_DRIVER=r2` and
   `REGISTRATION_CLIENT_IP_SOURCE=cf-connecting-ip`; `keep_vars=true` preserves
   target-account variables that are deliberately managed outside the repo.
8. Keep the repository's `workers_dev=false` and `preview_urls=false` settings.
   Attach the reviewed production route in the target account and protect every
   alternate hostname.

## Data cutover

1. Take and restore-test a PostgreSQL backup.
2. Run expand migrations over a direct TLS connection, never Hyperdrive.
3. Copy every legacy media object to R2 with the exact existing storage key.
4. Compare key count, byte size, and checksum coverage; keep the legacy source
   intact until rollback expires.
5. Deploy a canary Worker and verify public reads, registration, all admin
   mutations, draft/public media, Access logout, and outage responses.
6. Shift traffic, drain old instances, then run contract migrations.

## Required gates

```bash
npm ci
npm run check
npm run cf:check
```

Before promotion, also verify that an anonymous request to `/admin` is stopped
by Access, an allowed administrator reaches it, an invalid JWT is rejected by
the Worker, and no alternate hostname bypasses the policy.

## Rollback

- Keep the previous Worker version deployable.
- Do not reverse migration 021 by reintroducing application sessions.
- If database connectivity fails, roll traffic back before changing schema.
- R2 rollback points to the retained legacy object source only after verifying
  key parity; never overwrite or delete the only copy during incident response.
