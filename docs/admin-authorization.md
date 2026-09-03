# Staff authorization foundation

Authentication proves which private subject is present. Authorization decides what that subject
may do to a concrete platform or tournament resource. Those facts stay separate: roles are never
stored in session cookies and are checked against D1 on every protected request.

## Identities and scope

- The existing singleton `admin_account` remains the emergency platform identity. Its explicit
  `platform_owner` assignment grants platform and tournament capabilities.
- Tournament staff use an existing `participant_principal` and Passkey session. This avoids a
  second password account system while keeping the participant pages and staff workspace as
  separate interfaces.
- A tournament assignment is valid for exactly one tournament. A route or action must derive a
  child resource's tournament from D1 rather than trusting a client-supplied relationship.
- Tournament-entry ownership remains in `tournament_entry_owner`; a staff role never grants
  ownership of a participant's registration.

## Capability matrix

| Role                | Scope          | Capabilities                                                                                 |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| `platform_owner`    | Platform       | Every named staff capability                                                                 |
| `organizer`         | One tournament | View, configure, registration review/export, check-in, bracket, schedule, results, and media |
| `referee`           | One tournament | View and write results                                                                       |
| `check_in_operator` | One tournament | View the event and read/write its check-in desk                                              |

Code checks capability names, never role names. Menu visibility is only presentation and does not
replace checks in pages, server actions, route handlers, and private queries.
`tournament.view` exposes only the minimum event name and status needed to enter a workspace; it
does not grant access to registration details, contact data, check-in records, or other admin pages.

An assignment is active only while `revoked_at IS NULL` and `expires_at` is either null or later
than the current request time. Missing tables, missing assignments, unknown roles, invalid resource
scope, expiration, and revocation all fail closed.

## Rollout and rollback

Apply `0012_staff_authorization.sql` before deploying code that calls the capability helper. The
migration backfills administrator id `1`, and a trigger supplies the same explicit assignment when
a fresh database creates that account after migrations have run. There is no implicit id-based
authorization bypass.

The first enforcement stage protects the existing control room with `platform.manage`; its visible
behavior remains unchanged for the assigned owner. A later, separate stage may expose only the
two check-in capabilities to an assigned Passkey principal. All other current admin surfaces remain
owner-only until individually migrated and tested.

Rolling application code back leaves the additive assignment tables unused, but it also restores
the legacy singleton behavior and stops honoring assignment revocation. If rollback follows an
account or session compromise, delete existing `admin_session` rows and rotate the administrator
credential before serving the old code. Do not drop authorization data during rollback. Emergency
recovery should restore the single explicit owner row through protected maintainer database access,
then revoke that access again after the incident is resolved. Production migration and recovery
remain maintainer-only operations and are intentionally absent from repository scripts.
