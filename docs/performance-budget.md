# Performance and resource budget

The deployable unit is not the repository or `node_modules`. Cloudflare enforces its Worker
limit against the gzip-compressed Worker bundle. Files served through Workers Static Assets are
uploaded separately and do not count toward that script limit.

## Current baseline

Measured with Wrangler 4.127.0 on 2026-09-04:

| Build                                 | Worker gzip size |
| ------------------------------------- | ---------------: |
| Next 16 Turbopack + minified OpenNext |      2801.35 KiB |
| Next 16 Webpack + minified OpenNext   |      1847.96 KiB |

Production pins Webpack because its current OpenNext server output is 953.39 KiB smaller after
gzip than the equivalent Turbopack output. Production minification is configured in
`wrangler.jsonc`. The repository budget is 2300 KiB, leaving substantial space below Cloudflare
Workers Free's 3072 KiB script limit. CI runs `npm run cf:size` after the OpenNext build and fails
before deployment if the budget is exceeded.

Production source maps are uploaded out of band so minification does not make operational stack
traces unreadable. They do not enter the Worker runtime or its script-size calculation.

The production-local browser run passes all five representative routes. Total transfer is
427–439 KiB, JavaScript is 145–150 KiB, images are 35 KiB, CLS is 0, and the slowest measured LCP
is 1.58 seconds. Local startup profiling reports 19.8 ms of active initialization CPU in a 104.2 ms
profile window, comfortably below the platform's one-second startup limit. Run the same check
against the Worker preview with:

```sh
E2E_BASE_URL=http://127.0.0.1:8787 npm run perf
```

## Runtime plan

Production identity routes require Workers Paid. Password records deliberately use 600,000
PBKDF2 iterations; local Web Crypto measurements take about 150 ms and cannot fit Workers Free's
10 ms request CPU limit. Do not weaken the password KDF to fit that limit. Workers Paid's default
30-second request CPU allowance leaves ample headroom without a custom increase.

## What belongs where

- Application code and server-only dependencies belong in the Worker.
- Fonts, images, and immutable downloads belong in Workers Static Assets when they ship with the
  application, or R2 when they are uploaded or managed at runtime.
- Display-sized derivatives are generated before the build. Large source artwork is excluded from
  the public asset upload when only its derivative is used by the site.
- D1 stores relational application data. KV is not a default destination for large files.
- `.next`, `.open-next`, and `node_modules` are local generated directories and are excluded from
  version control. Their disk usage does not describe the upload size.

## Growth rules

1. Run `npm run cf:build && npm run cf:size` for changes that add server dependencies or routes.
2. Inspect `.open-next/server-functions/default/handler.mjs.meta.json` when the budget regresses.
3. Prefer Web Platform APIs already present in Workers over general-purpose Node.js packages.
4. Keep generated media out of server modules. The Open Graph image is rendered once before the
   Next.js build so Resvg, Yoga, and font binaries do not enter the Worker bundle.
5. Use a multi-Worker split only after simpler dependency and static-asset changes are exhausted;
   it adds deployment and preview constraints.
