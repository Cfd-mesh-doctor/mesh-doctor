# Mesh Doctor web app

The website and web app for Mesh Doctor. It is a static single-page app (Vite, React, TypeScript) that runs in
the browser and talks to the Mesh Doctor engine on the user's own computer (`meshdoctor serve`, `/api/v1`). It has
no server of its own: the host (Vercel) only serves the built files, and no case data ever goes to it.

| Address | What |
|---|---|
| `/` | the website |
| `/demo` | the app on answers recorded from public example cases; needs no engine |
| `/how-it-works` | how the repair and the checks work, step by step, from `docs/how-it-works.md` (its tables are kept equal to the doc's by a test) |
| `/accuracy` | the accuracy check: the public Ahmed body against the wind tunnel, from `docs/validation.md` (its table and commands are kept equal to the doc's by a test) |
| `/gallery` | the pictures the toolkit's scripts make for the public Ahmed body, from `docs/gallery.md` (its sections, captions and pictures are kept equal to the doc's by a test) |
| `/connect` | pairing this browser with an engine |
| `/app` | the app on your own engine |
| `/estimate` | the size estimator: memory, solve time and cloud cost for a cell count, from measured runs (a browser port of `skills/cfd-results/scripts/size_estimate.py`); needs no engine, and the fields live in the address so an estimate can be shared |
| `/report` | the report viewer: opens a `meshdoctor report` file (`.mdreport.json`, `.json.gz` or exported `.html`) in the browser, with the residual chart and the repair map when the report has them; needs no engine, and the file is never uploaded |

**Pairing:** `meshdoctor pair --open` opens `https://<site>/connect#key=…&engine=http://localhost:8765`. The key
after `#` stays in the browser and goes only to the engine, in the `X-MD-Key` header of every request. The engine
answers only the site addresses in its `app_origins` setting. The engine address must be
`http://localhost:<port>` or `http://127.0.0.1:<port>`: the site's Content-Security-Policy can't name `[::1]`.
The whole safety model is in [docs/safety.md](../docs/safety.md).

## Develop

Needs Node 22.12 or newer (CI uses 24) and, for `check:api` / `gen:api`, Python 3.

```bash
cd app
npm ci
npm run dev
```

The dev server runs at `http://localhost:5173`; `/demo` works straight away. To use a real engine, add the dev
address to the engine's `app_origins` (in `~/.config/meshdoctor/config.ini`, or `MESHDOCTOR_APP_ORIGINS`), restart
`meshdoctor serve`, and open the `localhost:5173` link that `meshdoctor pair` prints.

## Checks

CI runs all of these (`.github/workflows/ci.yml`, job `app`).

| Command | What it checks |
|---|---|
| `npm run check:api` | `src/engine/openapi.json` and `schema.d.ts` match the engine's API table; after changing the API, `npm run gen:api` remakes them |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |
| `npm test` | unit and screen tests (Vitest, jsdom) |
| `npm run build` | the production build, in `dist/` |
| `npm run e2e` | browser tests (Playwright) on the built site, served with the real security headers from `vercel.json`, against a mocked engine; the installed Microsoft Edge locally, Chromium in CI (without Edge: `npx playwright install chromium`, then `PW_CHANNEL=chromium`) |

## Where things are

- `src/engine/`: the API client, pairing, errors in plain words, and the data hooks.
- `src/demo/`: the recorded answers behind `/demo` (`fixtures.json`, from the public Ahmed-body and pitzDaily
  cases only, times shifted and folders renamed).
- `src/report/`: reading report files in the browser and working out what they say (`map.ts`: the repair map's
  picture and marks, drawn by `pages/report/RepairMap.tsx`); `testReport.ts` is a small made-up report for the tests.
- `src/pages/`, `src/components/`: the screens and the design system.
- `e2e/`: the Playwright tests.
- `vercel.json`: security headers and routing; `vite preview` serves the same headers.

## Rules

- Exact versions only, and no install scripts (`.npmrc`).
- No inline scripts: the Content-Security-Policy forbids them. Code goes in `src/`, or `public/*.js` if it must
  run before the app (as `theme.js` does, to avoid a flash of the wrong theme).
- No simulation data, personal paths or names: `python3 tools/data_guard.py --tree` from the repository root.
- GPL-3.0-or-later, like the rest of the repository.
