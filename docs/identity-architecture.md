# Unified identity and access architecture

Status: implementation contract
Scope: accounts, membership eligibility, tournament registration ownership, staff access, and
platform administration
Audience: product, design, frontend, backend, operations, and security maintainers

## Decision summary

The project has one account model and one session model for every person and every signed-in
surface.

- Username and password are the default way to create and access an account.
- Account creation is immediate; an administrator never has to approve the ability to sign in.
- Moderation approves membership eligibility. Pending and rejected applicants retain their account.
- Passkeys are optional authenticators added from Account security. They improve sign-in and
  phishing-resistant reauthentication but do not create a separate identity.
- Participants, reviewers, tournament staff, and platform owners use the same account and cookie.
- Membership gates ordinary participation. Resource relationships and scoped roles gate specific
  registrations and administrative capabilities.
- Every protected operation is authorized against current server-side state.
- Legacy participant and administrator systems are migration inputs, not permanent parallel paths.

The distinction that keeps the system understandable is:

```text
authentication          eligibility           authorization
"is this your account?" "may you participate?" "may you do this here now?"
        |                       |                         |
 password / Passkey     membership approval    relationship / scoped role
        +-----------------------+-------------------------+
                                |
                         one account + session
```

## Product model

| Concept      | Product meaning                                     | It must never mean                  |
| ------------ | --------------------------------------------------- | ----------------------------------- |
| Account      | One person, profile, security methods, and sessions | A team, event, browser, or role     |
| Membership   | Eligibility to participate in the community         | Login permission or staff authority |
| Registration | A team entry for one tournament                     | A person's identity                 |
| Work access  | Named capabilities for an explicit scope and time   | A second administrator account      |

This model intentionally avoids the current user-facing concepts of participant principals,
management tokens, account claims, separate administrators, and Passkeys as accounts.

## Goals

1. Let a person create an account, sign in, and understand their next step without administrator
   availability.
2. Make a delayed review transparent and useful rather than a locked waiting room.
3. Give reviewers one prioritized queue and enough evidence to decide without switching tools.
4. Give every person one security center, recovery path, and device/session list.
5. Make tournament ownership and work permissions explicit, scoped, revocable relationships.
6. Preserve strong WebAuthn and authorization properties while removing long-lived bearer-link
   authority and split cookies.
7. Remain small, bounded, observable, and reliable on the existing Cloudflare deployment.

## Non-goals

- Turning every roster nickname into an account.
- Treating profile or registration contact text as verified identity or recovery data.
- Legal or government identity proofing.
- A general organization-directory or social-graph product.
- Client-side role enforcement.
- Manual production deployment from a contributor machine.

## Domain model

### Account

An account has a random, non-PII identifier; a unique normalized username; a display name; an
independent security state; a WebAuthn user handle; a security version; and timestamps.

Account status controls whether authentication is accepted:

```text
active <----> locked
   |
   +----> merging ----> merged
   |
   +----> deletion_pending ----> deleted
```

A newly self-created account starts `active`. Membership status does not appear in this state
machine. `locked` is reserved for account security or abuse handling, never an alias for “waiting
for membership review”.

Every active account has at least one active credential. The initial credential is a password.

### Password credential

One active username/password credential belongs to one account. It stores:

- normalized username and its presentation form;
- versioned KDF algorithm and parameters;
- random salt, derived verifier, and pepper version;
- failure count, latest failure, and temporary lock time;
- latest successful authentication time and a single-use verification nonce;
- creation/update/revocation timestamps and compare-and-swap revision.

Passwords are never reversible, logged, placed in events, or sent to breach screening in plaintext.
Unknown usernames execute a dummy KDF. Authentication errors do not reveal which field failed.

### Passkey credential

An account may have multiple active Passkeys. A credential stores its immutable account binding,
credential ID and public key, plus counter, transport, backup/device metadata, user label, status,
timestamps, and revision.

Every non-legacy registration references the exact consumed, signed-in `passkey_enrollment`
intent. A Passkey sign-in session references the consumed `passkey_sign_in` intent. User verification
is required in both browser options and server verification.

Removing a Passkey revokes existing sessions until normalized authentication history supports a
safe narrower invalidation rule.

### Session

The browser stores exactly one random bearer token in `__Host-cs2cup_session`. D1 stores only its
hash. A session stores:

- account ID and the account security-version snapshot;
- authentication method and exact proof reference;
- creation, bounded activity, idle expiry, and absolute expiry;
- latest base-authentication time;
- nullable phishing-resistant and recovery-proof times;
- whether the session is recovery-restricted;
- coarse display metadata and explicit revocation state.

Password sessions bind a unique verification nonce written by the credential compare-and-swap
update. Passkey sessions bind a unique consumed authentication intent. One proof cannot mint two
sessions.

Normal sessions have a seven-day idle and thirty-day absolute lifetime. Activity writes are
throttled. Sensitive capabilities require recent authentication; privileged capabilities may also
require a recent Passkey. Recovery sessions are shorter and cannot access normal business data.

### Membership application

An application belongs to an already active account. Its state machine is independent of login:

```text
draft ---> pending ---> in_review ---> approved
  |          |              |
  |          |              +----> changes_requested ----> pending
  |          +-------------------> changes_requested ----> pending
  |          +-------------------> rejected
  +------------------------------> withdrawn
```

`rejected` is a final decision on one submission, not on the account. Policy may allow a later new
application. An account has at most one open application and at most one active membership.

An application stores minimal review data, a versioned evidence shape, submission and update times,
optional reviewer assignment, and a compare-and-swap revision. Changes retain immutable review and
audit history. Free text has strict length limits and never becomes authentication or recovery data.

The service may add trusted evidence from a configured adapter. Only an explicit policy maps that
evidence to automatic approval.

### Membership

Membership is the eligibility relationship created by approval or trusted policy. It stores the
account, membership kind, active/suspended/revoked state, provenance, effective time, and decision
reference.

Membership unlocks participation capabilities such as final tournament-registration submission.
It does not grant content administration, registration review, staff access, or platform ownership.

### Membership review

Review actions are append-only and actor-attributed. A reviewer must have:

- an active normal session;
- the current `identity_reviewer` or `platform_owner` platform role;
- recent authentication;
- a different account from the applicant.

Actions include assign, start review, request changes, approve, reject, and record reminder. Every
state transition has the expected application revision, so concurrent reviews fail rather than
overwrite each other.

Reason categories are stable code values rendered as localized copy. Optional notes are bounded.
Approving membership does not grant a work role.

### Tournament registration relationship

A tournament registration is the resource currently stored as `team`. An account relationship is
`owner` or `manager`:

- exactly one active owner exists for each account-managed registration;
- an owner can view, edit, invite/remove managers, and transfer ownership;
- a manager can view and edit but cannot transfer ownership or delete the registration;
- roster names do not grant account access;
- transfers require acceptance, recent authentication, and one audited transaction.

Creating or finally submitting a registration requires active membership. Viewing or editing a
saved draft may remain available while membership is pending, allowing useful work during review.

### Scoped role

Roles choose version-controlled capability sets. Rows do not contain arbitrary capabilities.

| Role                | Scope      | Purpose                                                             |
| ------------------- | ---------- | ------------------------------------------------------------------- |
| `platform_owner`    | Platform   | Platform configuration and explicit cross-tournament capabilities   |
| `identity_reviewer` | Platform   | Membership-review queue and decisions                               |
| `organizer`         | Tournament | Event, registration, schedule, results, media, and staff management |
| `referee`           | Tournament | Event view and result reporting                                     |
| `check_in_operator` | Tournament | Check-in read and write                                             |

Role assignments include grantor, reason, grant and expiry time, revocation, revision, and exact
scope. The UI only exposes a role after all matching routes and actions enforce its capabilities.

### Security event

Security events are immutable, shaped, correlated, and actor-attributed. They include minimum
coarse request context and never include passwords, cookies, bearer values, full WebAuthn payloads,
or unnecessary contact data.

Anonymous attacker-controlled failures use bounded aggregate buckets rather than unbounded event
rows. Account-bound successes and security changes produce durable events in the same batch as the
state change.

## Primary journeys

### Create account and apply

1. The visitor opens `/register` and sees what an account provides and what requires membership.
2. They enter username, display name, password, and password confirmation.
3. The server validates the shaped input, screens the password, derives the verifier, and atomically
   creates the active account, password credential, session, and event.
4. The browser receives the one session cookie and continues to `/account/welcome`.
5. The person may submit the membership form now or later. Skipping never invalidates the account.
6. Submission opens one application and shows the status timeline.

The success screen never says “your account is awaiting approval”. It says the account exists and
membership is awaiting review.

### Wait for membership review

The account page remains the durable source of truth. It shows:

- current state in words and iconography;
- submission and latest-update times;
- the normal review target and elapsed wait;
- any reviewer request and the exact next action;
- effects on current product capabilities.

Before the review target, no escalation action appears. After it, the person can send one bounded,
idempotent reminder per cooldown period. A reminder changes neither submission time nor priority
evidence and never creates a duplicate application.

The UI does not display an exact queue position or guaranteed completion time. Reviewer assignment,
priority, withdrawals, and concurrent decisions make those values unreliable.

If tournament registration closes soon, the account page surfaces the deadline and the reviewer
queue derives a deadline-risk priority. A reviewer may still reject; urgency never bypasses policy.

### Review membership

1. `/admin/identity` shows counts, oldest wait, overdue count, deadline-risk count, and assignments.
2. The default queue sorts by deadline risk, overdue age, then submission time.
3. A reviewer opens an application, sees normalized account/evidence data and immutable history,
   then starts or assigns review.
4. One primary decision is made: approve, request changes, or reject.
5. The database transition, membership row when applicable, event, and in-app notification state are
   committed together.
6. The applicant sees the result on their next request. A configured notification adapter may also
   deliver it from the outbox.

The queue has no password, secret, raw session, or recovery controls. Assisted account recovery is
a separate, delayed workflow.

### Sign in

1. `/login` presents username/password as the primary form.
2. The server applies aggregate request limits, normalizes the username, runs a real or dummy KDF,
   and applies per-credential failure limits.
3. Success atomically records the credential proof, creates a session, and writes the event.
4. Existing unified cookies rotate; conflicting legacy cookies are revoked and cleared.
5. If the device supports WebAuthn, “Use Passkey” remains a visible secondary action.

Both methods land on the same return path and produce the same account context. Only assurance
metadata differs.

### Add a Passkey

1. The signed-in person opens Account security.
2. Recent password authentication or a current Passkey confirms the action.
3. The service creates a short-lived enrollment intent bound to account and current session.
4. The WebAuthn ceremony creates the credential and consumes the intent atomically.
5. The security page shows the new labeled credential and offers recovery-code setup if absent.

Passkey setup is never forced during account creation or membership review.

### Administrative work

There is no separate administrator authentication system. The same `/login` page authenticates a
platform owner or staff member. `/admin` resolves the unified session and requires the relevant
capability. Normal participants see neither hidden data nor a misleading second login prompt.

Sensitive administration requires recent authentication. The highest-risk operations require
recent phishing-resistant authentication after a Passkey has been enrolled for that account.

## Waiting and notification policy

The initial normal review target is 24 hours and is product configuration, not a security promise.

- At submission: show the target and in-app timeline.
- At eight hours: notify reviewers inside the administrative queue if still unseen.
- At 24 hours: mark overdue, raise its queue priority, and enable one applicant reminder.
- After each reminder: enforce a cooldown and show when another reminder would become available.
- Near a tournament deadline: add deadline-risk priority and show the real cutoff to both sides.

External notification is optional until a verified delivery channel is configured. Contact text in
an application is not implicitly trusted for security or recovery messages. Delivery failures never
change membership authority.

Future institutional SSO, verified school email, or controlled invitation adapters may auto-approve
matching claims. The policy result and evidence provenance are recorded; the authentication and
membership models remain unchanged.

## Authorization model

Every protected call supplies:

```text
authenticated context + named capability + concrete resource + optional stronger assurance
```

The kernel checks session validity, account security version, recovery restriction, required
assurance, current membership when the capability requires eligibility, current role or resource
relationship, exact scope, grant time, expiry, and revocation.

The session cookie never carries roles, membership, or registration ownership. UI navigation is a
convenience only. Server actions, route handlers, exports, media endpoints, and private queries all
enforce the same capability boundary.

## Password and recovery policy

- Minimum 15 Unicode code points, maximum 128, NFC normalization.
- No composition rules, password hints, periodic expiry, or silent truncation.
- Full paste and password-manager support.
- Breached-password screening on creation and change.
- Native PBKDF2-HMAC-SHA-256 with 600,000 iterations, random salt, and versioned pepper.
- Per-request aggregate limits and bounded per-credential temporary lockout.
- Generic authentication responses and dummy work for unknown usernames.
- Password changes require recent password or Passkey confirmation.
- Credential replacement increments the account security version and revokes other sessions.

Recovery codes are high-entropy, single-use, purpose-bound, and stored only as hashes. Assisted
recovery requires a separate case, a reviewer other than the subject, a minimum delay, immutable
history, and a short recovery-restricted session. The restricted session can only finish credential
replacement. Completion revokes every previous session.

Membership reviewers cannot reset a password from the membership queue.

## Request and storage protections

- State-changing browser requests require exact same-origin CSRF validation.
- Cookies are Secure, HttpOnly, SameSite=Lax, Path=/, and use the `__Host-` prefix.
- Return paths are relative allowlisted application paths, never caller-provided origins.
- Opaque IDs and tokens use cryptographically secure 32-byte values.
- Bearer secrets are hash-only in D1; plaintext is returned once and never logged.
- Credential/session creation and its proof/event use one D1 batch or transaction boundary.
- Updates use revisions and fresh write nonces; concurrent state changes fail closed.
- Security-sensitive reads use authoritative D1 state.
- JSON metadata has schema and length limits.
- Logs contain stable categories and correlation IDs, not secrets or uncontrolled personal text.

## Legacy migration

The deployed system currently has a Passkey-based participant principal and a singleton
administrator account. Migration follows explicit cohorts:

1. Deploy unified tables and read-only compatibility maps.
2. Let the legacy owner complete a one-hour, one-use bootstrap into a unified account with a newly
   derived password and the first platform-owner role.
3. Map legacy Passkey public material and registration ownership losslessly; never copy sessions.
4. For a migrated cohort, all new reads and writes use unified services only.
5. A unified sign-in revokes and clears both legacy cookies.
6. Convert durable registration management links into bounded migration grants.
7. Remove legacy login and cookie code after cohort metrics and browser flows pass.

Legacy password hashes are never imported as unified password credentials. Ambiguous person records
are queued for an explicit merge that requires proof of both accounts and revokes every session.

## Operational and performance contract

Cloudflare Workers, D1, Static Assets, and R2 are sufficient for this workload when the application
keeps a disciplined boundary:

- static images and fonts do not enter the Worker module graph;
- authentication uses native Web Crypto rather than bundled crypto implementations;
- routes import only server services needed for that surface;
- public client components never import reviewer or provider code;
- queries are indexed and bounded; list routes paginate;
- activity and reminder writes are throttled;
- anonymous failures are aggregated in expiring buckets;
- cleanup jobs have explicit retention, batch size, and checkpoint limits.

The production Worker must remain below the repository's 2,900 KiB gzip budget. A full OpenNext
build and `npm run cf:size` are release gates.

## Accessibility and interface contract

- Password is the single primary action on login; Passkey is a clearly visible secondary action.
- Each state has a textual name and next action; color is never the only signal.
- Touch targets are at least 44 by 44 CSS pixels.
- Forms retain entered non-secret values after shaped validation errors.
- Password fields allow paste and expose current/new-password autocomplete tokens.
- Status messages use appropriate `status` or `alert` semantics without stealing focus.
- Dialogs trap and restore focus; destructive actions require explicit confirmation.
- Keyboard-only and reduced-motion paths are first-class.
- Private pages and responses use no-store, no-index, and no-referrer policies.

## Release gates

An identity release is complete only when all applicable checks pass:

- fresh and upgrade D1 migrations, foreign-key check, and repeated no-op apply;
- schema state-machine and provenance tests;
- password, session, membership, recovery, and authorization service tests;
- WebAuthn virtual-authenticator sign-in and enrollment tests;
- signup, login, pending, changes-requested, approved, rejected, reminder, and reviewer browser flows;
- keyboard and automated accessibility checks;
- legacy conflict and cutover tests;
- full format, type, lint, repository safety, and source-size checks;
- production build and compressed Worker budget.

Contributors never deploy directly. Merge to the protected branch is the only production delivery
path, and CI/CD owns migrations and deployment.

## External patterns considered

GitLab and Discourse support account-level approval, where pending users cannot sign in. That model
is useful for fully closed instances but creates a fragile waiting room. Tailscale lets a user
authenticate while withholding protected network access. Slack separates organization identity
from open, by-request, invite-only, or hidden workspace membership, and supports trusted-domain
auto-join. Google Groups keeps join requests separate from the person's Google account.

This project adopts the shared principle from the latter systems: establish identity first, then
approve access to a bounded domain. It adds an explicit status timeline and overdue workflow because
reviewers are volunteers and tournament deadlines are real product constraints.

## References

- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [GitLab user moderation](https://docs.gitlab.com/administration/moderate_users/)
- [Discourse user approval](https://meta.discourse.org/t/configuring-and-managing-the-sign-up-flow-with-user-approval/112128)
- [Tailscale user approval](https://tailscale.com/docs/features/access-control/user-approval)
- [Slack workspace access modes](https://slack.com/help/articles/115001915507-Manage-workspace-access-in-an-Enterprise-organization)
- [Slack approved-domain signup](https://slack.com/help/articles/115004856503-Manage-how-people-join-your-workspace)
- [Google Groups membership requests](https://support.google.com/a/users/answer/9303222?hl=en)
