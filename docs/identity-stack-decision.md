# Identity implementation stack decision

Status: accepted for implementation
Decision date: 2026-09-03
Related contract: `docs/identity-architecture.md`

## Decision

Build one project-owned identity kernel on Cloudflare D1 and Web Crypto.

- Username and password are the default account creation and sign-in method.
- Passkeys are an optional account-bound convenience and phishing-resistant step-up method.
- Account creation is immediate. Moderation approves membership eligibility, not the account.
- Participant, reviewer, staff, and platform-owner access use one account and one session cookie.
- Server-side capability checks, not separate login pages or client-visible roles, protect workspaces.
- Institutional SSO, verified email, and invite codes are future verification adapters that can
  approve trusted membership applications without changing the account or session model.

The implementation uses the dependencies already present in the Worker:

- Web Crypto for PBKDF2-HMAC-SHA-256, keyed preprocessing, random secrets, and token hashing;
- `@simplewebauthn/server` and `@simplewebauthn/browser` for WebAuthn ceremonies;
- D1 for accounts, password verifiers, Passkeys, sessions, membership, roles, recovery, and audit;
- project-owned, server-only services as the only database and policy boundary used by routes.

No hosted identity UI, second authorization framework, or parallel administrator identity is added.

## Product boundary

The product exposes four concepts:

| Concept      | Meaning                                     | Created or changed by                    |
| ------------ | ------------------------------------------- | ---------------------------------------- |
| Account      | The person and their sign-in methods        | The person immediately                   |
| Membership   | Eligibility to participate in the community | Application plus review or trusted proof |
| Registration | A team entry in one tournament              | An eligible account                      |
| Work access  | A scoped, expiring capability grant         | An authorized reviewer or owner          |

A pending or rejected membership never invalidates the person's password, Passkeys, sessions, or
security settings. It only withholds membership-gated business capabilities. Abuse controls may
independently lock an account through the account security state.

## Password profile

The password implementation follows the current NIST shape and the OWASP fallback suitable for the
runtime:

- accept Unicode and normalize to NFC;
- require at least 15 Unicode code points and allow at most 128;
- do not require composition rules or periodic rotation;
- screen new and changed passwords against the Pwned Passwords range API;
- hash in the Worker with native PBKDF2-HMAC-SHA-256 at 600,000 iterations;
- store a random per-credential salt, versioned parameters, and a derived verifier;
- apply a versioned server-held pepper outside D1;
- use a dummy derivation for unknown usernames and a generic authentication failure;
- rate-limit by privacy-preserving aggregate keys and temporarily lock repeated credential failures.

Argon2 is not currently available in the Workers crypto runtime. The OWASP scrypt fallback at its
recommended parameters exceeds the Worker's 128 MB memory limit in a representative runtime probe.
PBKDF2 therefore provides the deployable memory-safe choice without adding a JavaScript crypto
bundle. Parameters are stored per credential so a later native Argon2 implementation can migrate on
successful authentication.

Password creation and change fail closed when breach screening cannot complete. Authentication
does not make a network request. The Pwned Passwords request sends only the first five hexadecimal
characters of a SHA-1 digest and requests padded responses; SHA-1 is used only for this lookup, not
for password storage.

## Membership moderation profile

The initial deployment uses self-service membership applications:

1. The person creates a username/password account and receives a normal session.
2. They submit identity and eligibility evidence from the signed-in account.
3. The account remains usable while the application is pending, in review, needs changes, or is
   rejected.
4. An authorized reviewer approves membership, requests changes, or rejects with a shaped reason.
5. Approval activates the membership relationship immediately. It never issues an activation link
   or asks the person to set their password again.

The waiting experience is part of the workflow. The account page shows the application state,
submission time, normal review target, elapsed wait, latest action, and the next available action.
After the target time, one idempotent reminder is available. Reviewer queues prioritize oldest wait
and relevant tournament deadlines. Exact queue positions are not shown because concurrency and
priority make them misleading.

When a trusted verification adapter is enabled, policy may automatically approve an application
for a configured institutional issuer, verified domain, or controlled invitation. Manual review
remains the exception path. An adapter proves an eligibility claim; it does not create another kind
of account or session.

## One kernel

New routes use these boundaries:

| Boundary               | Owns                                                      |
| ---------------------- | --------------------------------------------------------- |
| Account service        | Account creation, profile state, username uniqueness      |
| Password service       | Policy, screening, KDF, verification, change, lockout     |
| Passkey service        | Ceremony policy and credential lifecycle                  |
| Session service        | One hash-only cookie, rotation, assurance, revocation     |
| Membership service     | Application state, review, eligibility gate, reminders    |
| Authorization service  | Current relationships, scoped roles, capability decisions |
| Security event service | Shaped, actor-attributed, append-only events              |
| Notification adapter   | Delivery only; never creates sessions or grants access    |

Routes parse transport input and call these services. They do not construct authorization SQL or
issue independent identity cookies. UI components never infer authority from a visible badge.

## Recovery

Normal password changes require recent password or Passkey confirmation. They rotate password
material, increment the account security version, and revoke other sessions.

Recovery codes are generated only from a recently authenticated account and stored as single-use
hashes. Assisted recovery is a last resort: it requires a separate case, a different authorized
reviewer, an enforced delay, immutable review history, and a restricted recovery session. That
session can only replace credentials and cannot access registrations or staff workspaces. Completing
recovery revokes every older session.

No contact value from a registration or membership form is silently treated as a verified recovery
identity.

## Migration and cutover

Existing participant Passkeys and registration ownership are migrated by explicit provenance maps.
Existing administrator password hashes are not copied into the new credential table. The singleton
legacy owner performs a one-time, short-lived bootstrap that sets a new password and receives the
initial platform-owner role.

During cutover:

- one cohort uses only unified state;
- a successful unified sign-in revokes and clears legacy sessions;
- legacy bearer management links become migration grants, not permanent account credentials;
- sessions are never converted;
- ambiguous accounts are not automatically merged;
- rollback retains a unified compatibility reader or enters read-only maintenance mode.

The end state has one `__Host-cs2cup_session` cookie. Legacy participant and administrator cookies
and login routes are removed only after migration invariants and browser flows pass.

## Runtime and deployment gates

Cloudflare is treated as the target platform, not the explanation for avoidable overhead:

- use native Web Crypto rather than bundled password-crypto polyfills;
- keep provider adapters out of public client bundles;
- store static assets outside the Worker module graph;
- bound D1 reads and writes per request;
- aggregate anonymous failure telemetry rather than append one row per attempt;
- keep the compressed Worker below the repository's 2,900 KiB budget.

Every identity milestone must pass schema invariants, service tests, authorization tests, browser
keyboard/accessibility checks, the full quality suite, an OpenNext production build, and the Worker
size gate.

Production changes are delivered only by the repository CI/CD workflow. Local tooling may migrate
and test only the explicitly local D1 configuration; it must not deploy or mutate production.

## Options not selected

- **Account-level approval:** appropriate for closed instances that must reveal nothing before
  approval, but it blocks sign-in, status visibility, profile correction, and security setup. That
  creates avoidable support load for a volunteer-run tournament community.
- **Passkey-only enrollment:** a Passkey proves control of an authenticator, not community
  eligibility, and is not a complete recovery path.
- **Separate administrator login:** duplicates identities, cookies, recovery, and support concepts.
- **Hosted authentication:** may be reconsidered if operations require it, but currently adds a
  second source of truth and hosted UI without removing project-specific membership and
  authorization work.
- **A large authentication framework beside the legacy stack:** duplicates session and WebAuthn
  machinery during migration and jeopardizes the Worker budget. Reconsider only as a measured
  replacement, not an addition.

## References

- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [GitLab user moderation](https://docs.gitlab.com/administration/moderate_users/)
- [Tailscale user approval](https://tailscale.com/docs/features/access-control/user-approval)
- [Slack workspace access modes](https://slack.com/help/articles/115001915507-Manage-workspace-access-in-an-Enterprise-organization)
- [Google Groups membership requests](https://support.google.com/a/users/answer/9303222?hl=en)
- [Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Pwned Passwords API](https://haveibeenpwned.com/API/V3#PwnedPasswords)
