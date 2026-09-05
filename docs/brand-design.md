# Ningli Esports public experience

## Brand system

The public identity uses the existing club mark, `lib/brand.ts`, and three core colors:

- Club blue `#0b4d87` for action, emphasis, and featured tournaments.
- Paper `#f1efe8` for public reading surfaces.
- Ink `#171817` for type, the navigation shell, and the footer.

Large Chinese serif headlines and condensed numeric typography carry the homepage identity.
Operational sections use 22–29px sans-serif headings; page headings use 32–56px type. Form inputs
use at least 16px, interactive labels generally use 14–15px, and controls have 44px tap targets.
Keep the club mark,
canonical club name, and shared tagline consistent across the site, exported cards, and app icons.
Do not use decorative status indicators to imply a live stream or a verified result.

## Public journeys

- The homepage connects current tournaments, participation steps, and recent club news.
- The tournament directory supports Unicode search, game/season/status filters, and browser-local
  follows. Filters survive reload and can be shared through the URL. Follows are device-local,
  do not require sign-in, and do not imply notification delivery or cross-device sync.
- Tournament pages expose registration capacity, deadlines, participation steps, calendar export,
  follow controls, and sharing. The server remains authoritative for registration eligibility.
- Team lookup includes names, tags, departments, captains, and roster nicknames.
- Public tournament, team, match, and news pages provide context-specific sharing.
- Registration remains visible in the homepage and tournament overview first screens. The directory
  puts search ahead of the card list; mobile filters stack without abbreviating the selected value.
- Tournament navigation stays below the site header while scrolling. Mobile overview content puts
  the entry panel before team previews; map lists and participation instructions can be expanded.
- Account creation preserves the originating tournament through sign-in, signup, and membership
  application links. Password visibility controls and local confirmation validation assist entry;
  server validation still applies. Native form error redirects preserve the same safe context.
- Contact copy controls provide a selectable fallback. Empty archives link back to live tournaments.

Functional content must not wait for decorative entrance animations. Identify the team or match
before presenting its share tools. Keep dense schedules readable without turning section titles into
poster headlines. The interface must not imply that following a tournament sends notifications.

## Sharing and access

Share dialogs offer clipboard copy, a selectable link fallback, native sharing when supported, and
a downloadable 720 by 900 PNG with the club identity and a real QR code. QR generation runs locally
in the browser and loads only when a dialog opens. It never uses an external QR service. Native
dialog behavior provides keyboard containment and Escape dismissal; closing restores trigger focus.
Dialogs render outside their trigger's section so footer and hero styles cannot override their
typography or colors. On small screens, sharing actions precede the card preview, and the close
control stays visible while scrolling. Link inputs use 16px text to avoid mobile focus zoom.

Links use `NEXT_PUBLIC_SITE_URL`. Preview cards therefore point to the configured preview origin;
production must supply its canonical public origin. Public page metadata and organization/website
structured data describe the club. Search engines and messaging apps decide whether and when to
render previews; the UI does not promise delivery or ranking.

The web app manifest and generated icons support home-screen entry points. No service worker is
installed and no offline access is advertised. Account data must not enter public offline caches.
The footer includes platform-specific home-screen instructions, public navigation, and the RSS feed.

The site header starts as a server-rendered native directory. Its interactive enhancement loads in
an isolated client chunk; a failed download keeps the document links usable without replacing the
page with a client error. Enhancement also waits while a visitor is focused inside the native header.
This fallback covers failed enhancement downloads, not a fully JavaScript-free rendering mode;
Next.js still uses a streaming document shell. A no-script notice explains how to resume loading.

## Validation

### Grid and motion contract

The September 2026 visual pass draws on the [Swiss National Library's account of the
International Style](https://www.nb.admin.ch/en/the-international-style-1950-1970): deliberate
typographic hierarchy, precise alignment, restrained color, and a strong composition.
This is an adaptation for a Chinese esports club, not a claim to reproduce a historical standard.

`app/layout-tokens.css` owns the 1536px outer container, safe-area-aware page insets, 24px desktop
and 16px mobile gutters, and an 8px spacing scale. The navigation, homepage sections, tournament
pages, and footer share the same content edges. Open three- and four-column groups align with the
12-column desktop grid; tournament content uses eight columns plus a four-column entry rail.
Reading columns and auth forms have intentionally narrower measures. Form labels align to the
top of their rows: a longer hint must never change a neighboring input's position or height.

The homepage also takes inspiration from the [Lando Norris official site](https://landonorris.com/)
for a singular, expressive first screen, and [Pentagram's Nuverse identity](https://www.pentagram.com/work/nuverse)
for motion rooted in a brand symbol and a sense of connection. No reference assets or layouts
are copied. The existing club emblem, Chinese display type, and converging bracket routes remain
the primary visual language.

Motion uses CSS and existing SVG artwork, without video, WebGL, or an animation dependency.
Mouse response is limited to 12px horizontally, 9px vertically, and a small emblem tilt; action
targets never follow the pointer. A visible toggle pauses decoration. System reduced-motion
preferences disable it, touch devices receive no pointer parallax, and the hero suspends ambient
animation when off screen or when the document is hidden. Scroll reveals use IntersectionObserver
and leave content visible if the enhancement is unavailable. Keyboard-focused content is never
hidden by a reveal. Mobile headings and artwork must not obscure the registration action.

### Authentication experience

The [GitHub sign-in page](https://github.com/login) informs the clear primary action and separation
of password, passkey, signup, and recovery entry points. The
[GOV.UK error-message guidance](https://design-system.service.gov.uk/components/error-message/)
informs actionable language, retaining entered information, and associating feedback with the
affected input. Internal security codes and breached-password terminology are not user guidance.

Display names are optional at signup and default to the username on the server. This does not
alter username validation, password screening, CSRF protection, rate limits, or authorization.
Password managers retain the native autocomplete attributes. Errors are cleared when the related
input changes, submitted values cannot be edited during a pending request, and validation focus
is restored after inputs are re-enabled. Auth content is top-aligned so an error does not move the
submit button. An interrupted signup offers a contextual sign-in route rather than claiming that
no account was created. Recovery explains the existing backup-code and passkey paths and offers
a contact route without promising an unverified reset.

`node scripts/layout-browser.mjs` checks shared edges at six widths and aligned, equal-height
auth controls. `node scripts/home-motion-browser.mjs` covers pointer, keyboard, pause/resume,
live reduced-motion changes, off-screen suspension, touch, and first-screen actions.
`node scripts/auth-feedback-browser.mjs` covers optional profile information, server rejection,
plain-language feedback, stable button positions, retained input, network interruption, and
recovery alternatives. All three run in the browser smoke gate against the loopback fixture.

`npm run test:discovery` checks filter parsing, Unicode matching, public visibility, and URL round trips.
`node scripts/discovery-browser.mjs` verifies search, follows, PNG export, focus restoration,
metadata, app icons, mobile overflow, and accessibility against the disposable loopback fixture.
The browser check is included in both smoke and full browser gates.
`node scripts/share-browser.mjs` exercises eight share entry points at five viewport sizes,
including a narrow phone and landscape. It checks theme isolation, contrast, expanded access tips,
focus restoration, and clipboard, native-share, and image-generation failures. Run it with
`SHARE_BROWSER=webkit` for an additional WebKit pass.
`node scripts/frontend-browser.mjs` checks first-screen actions and sticky navigation at 320, 390,
768, and 1440px, scans 19 additional mobile routes, and exercises signup continuation, password
controls, clipboard failure, and native form recovery. Identity browser suites also save desktop
and mobile account, security, registration, and workbench screenshots for visual review.
`node scripts/header-fallback-browser.mjs` repeats failed-chunk checks and verifies native keyboard
navigation, public content visibility, and absence of uncaught client errors.

## Next design pass

Account overview, account security, and operations screens retain their existing dark workspace
layouts. They receive regression coverage in this pass, not a complete visual redesign. Next work
should simplify their mobile information hierarchy, bring long-form field labels and input controls
onto the shared type scale, and make lengthy membership and registration states easier to scan.
