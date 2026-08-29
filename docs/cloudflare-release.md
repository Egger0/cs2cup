# Cloudflare release checklist

All production Cloudflare resources, secrets, and deployment authority belong
to `@Egger0`. Contributors must not create or deploy equivalent resources from
a personal Cloudflare account. The repository does not create, modify, or
delete account-side Access/Zero Trust configuration.

## One-time target-account setup

1. Create a dedicated PostgreSQL runtime login that inherits `club_admin` and
   no broader role. It must not have superuser, database creation, role
   creation, replication, or RLS-bypass privileges. Keep its password private
   in the target account's approved secret workflow.
2. Create a cache-disabled Hyperdrive configuration in the target account.
   Supply the direct TLS origin connection through the approved secret workflow
   or dashboard, never a committed file, command argument, or shell history.
   The Wrangler option is `--caching-disabled`.
3. Replace `SET_BY_EGGER0_IN_TARGET_CLOUDFLARE_ACCOUNT` in `wrangler.jsonc`
   with the returned configuration ID. Before promotion, `@Egger0` must run
   `wrangler hyperdrive get <ID>` in the target account and attach output
   showing `caching.disabled=true` to the release record. This is a blocking
   read-after-write gate: Hyperdrive writes do not invalidate cached `SELECT`
   results.
4. Bind the private production R2 bucket as `CS2CUP_MEDIA`. Do not enable an R2
   public endpoint.
5. Set `NEXT_PUBLIC_SITE_URL` to the exact HTTPS production origin in both the
   Workers Builds build variables and the Worker's runtime variables. Wrangler
   owns `PHOTO_UPLOAD_DRIVER=r2` and
   `REGISTRATION_CLIENT_IP_SOURCE=cf-connecting-ip`; `keep_vars=true` preserves
   target-account variables deliberately managed outside the repository.
6. Store `ADMIN_AUTH_PEPPER` and `REGISTRATION_FINGERPRINT_SECRET` as Worker
   secrets. Do not reuse either value for another purpose. The application has
   no `CF_ACCESS_ISSUER`, `CF_ACCESS_AUDIENCE`, Access JWT, JWKS, or D1 binding.
7. Keep `workers_dev=false` and `preview_urls=false`. Attach only the reviewed
   production route so an unmanaged alternate hostname cannot become an
   unexpected entry point.

If an older release already has a Cloudflare Access application, leave that
account-side configuration unchanged during the canary and initial traffic
shift. It is not part of the new runtime. The account owner removes it only
after the application-owned login, logout, and recovery path are verified in
production.

## Generate and custody the authentication pepper

Generate exactly 32 random bytes and encode them as unpadded base64url. One
portable operator-side generation command is:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

The result is one 43-character line. Capture it directly in the approved
secret manager, then enter it through the interactive
`wrangler secret put ADMIN_AUTH_PEPPER` prompt in the target account. Do not
place the value in source control, a command argument, a ticket, build output,
or logs. Credential provisioning must receive the exact same value from the
secret manager. Losing or changing it makes every stored password verifier
unusable until credentials are reprovisioned.

## Data and credential cutover

The order is intentional: migrate first, provision the credential second, and
only then deploy code that calls the migration-022 RPCs.

1. Take a PostgreSQL backup and complete a restore test.
2. Inject the migration-owner `MIGRATION_DATABASE_URL` from the target secret
   store, set `MIGRATION_EXPECT_DATABASE` to the exact database name, and run
   expand migrations over that direct TLS connection. Never migrate through
   Hyperdrive or with the runtime login.

   ```bash
   npm run stack:migrate
   ```

3. Confirm migration 022 is present. Inject the same
   `MIGRATION_DATABASE_URL`, `MIGRATION_EXPECT_DATABASE`, and
   `ADMIN_AUTH_PEPPER`; then set the explicit mutation acknowledgement:

   ```bash
   export ADMIN_CREDENTIAL_ALLOW_MUTATION=1
   ```

4. Read a unique administrator password of at least 15 characters without
   echoing it or putting it on the command line, and stream it to the guarded
   provisioning command:

   ```bash
   export ADMIN_USERNAME='choose-real-administrator-name'
   IFS= read -r -s ADMIN_PASSWORD
   printf '\n'
   printf '%s' "$ADMIN_PASSWORD" |
     npm run admin:credential -- --username "$ADMIN_USERNAME" --password-stdin
   unset ADMIN_PASSWORD ADMIN_USERNAME ADMIN_CREDENTIAL_ALLOW_MUTATION
   ```

   The command independently checks the URL database name, verifies migration
   022, generates a new 16-byte salt, performs the 600,000-iteration derivation,
   and writes through the migration-owner-only function. Running it again for
   the same username rotates the verifier, increments its version, and revokes
   all previous sessions in the same transaction.
5. Copy every legacy media object to R2 with the exact existing storage key.
6. Compare key count, byte size, and checksum coverage. Keep the legacy source
   intact until the rollback window expires.
7. Deploy a canary Worker with the target Hyperdrive and R2 bindings and both
   required secrets.

Unset direct database and pepper variables from the operator shell as soon as
provisioning and migration work is complete.

## Canary verification

The 600,000-iteration PBKDF2 path runs inside the Worker, including for an
unknown username. Before promotion, record Worker CPU time and wall latency for
one valid login and one invalid login, and confirm both stay comfortably below
the target account's configured CPU limit. Do not load-test the production
login or consume its rate-limit windows to perform this check.

Verify all of the following on the canary:

- public reads, registration, and all administrator mutations reach the exact
  expected PostgreSQL database;
- a valid password creates a `Secure`, `HttpOnly`, `SameSite=Strict` cookie and
  reaches `/admin`;
- wrong credentials return the generic failure without creating a session;
- logout revokes the PostgreSQL session, expires the cookie, and the old cookie
  no longer reaches an admin page;
- password rotation through `admin:credential --password-stdin` revokes a
  canary session and only the new password logs in;
- draft media requires an administrator session, published media remains
  public, and unauthorized/absent objects are indistinguishable 404 responses;
- database and R2 dependency failures return 503 instead of authorization or
  not-found responses.

## Required gates

```bash
npm ci
npm run check
npm run cf:check
```

Attach the gate output, Hyperdrive cache evidence, migration ledger, credential
provisioning result (never its secrets), and canary CPU evidence to the release
record. The isolated migration and administrator E2E gates, rather than the
production canary, must show that the sixth account attempt and the 31st
trusted-network attempt return `Retry-After` and that the 15-minute windows are
atomic under concurrency. They must also show that usernames sprayed after a
network block create no account throttle rows, same-token session admission is
idempotent, and the bounded 24-hour cleanup drains expired state.

## Promotion and account cleanup

1. Shift traffic to the verified Worker and repeat login, one admin read, one
   reversible admin mutation, logout, and public-media checks on the production
   hostname.
2. Drain old instances, then apply post-deploy contractions over the direct TLS
   migration connection:

   ```bash
   npm run stack:contract
   ```

3. Verify migration-022's post-deploy contract and
   `begin_local_admin_login`, `create_local_admin_session`,
   `use_local_admin_session`, and `end_local_admin_session` remain active after
   the immutable historical migration-021 contraction.
4. If the target account previously used Cloudflare Access for this site, the
   account owner now removes that application/policy and verifies the
   production hostname again. The repository and release automation do not
   perform this account-side deletion.

## Rollback and recovery

- Keep the previous Worker version deployable and the PostgreSQL backup and
  legacy media source intact. Migration 022 is additive; do not edit or reverse
  an applied migration to roll back application code.
- Before the traffic shift, abort by leaving the current production Worker and
  any existing account-side policy unchanged. After the shift but before old
  account-side Access cleanup, roll back traffic first and investigate without
  changing schema or secrets.
- After an old Access application has been removed, prefer recovery on the new
  application-owned authentication version. If an emergency requires an older
  Access-dependent Worker, the target-account owner must restore and verify the
  exact former account-side protection before exposing that Worker; repository
  automation cannot do this safely.
- If Hyperdrive or PostgreSQL connectivity fails, roll traffic back before
  changing schema. Restore from the tested backup only after confirming the
  database target and preserving incident evidence.
- If `ADMIN_AUTH_PEPPER` was misconfigured but the correct value is still in
  the secret manager, restore that exact Worker secret; do not modify the
  database credential. If the pepper is irretrievably lost, enter a maintenance
  window that blocks administrator traffic, generate a new pepper, update the
  Worker secret, and immediately rerun `admin:credential --password-stdin` for
  each administrator with the same new pepper. New logins fail closed during
  the short verifier mismatch; existing token sessions are revoked only when
  provisioning commits, which is why administrator traffic must remain
  blocked. Verify fresh login and logout before reopening administration.
- A suspected password or session compromise uses the same credential-rotation
  command first; its transaction revokes every existing session. Rotate the
  pepper only when the pepper itself may be exposed, because doing so requires
  reprovisioning every administrator.
- R2 rollback points to the retained legacy object source only after verifying
  key parity. Never overwrite or delete the only copy during incident response.
