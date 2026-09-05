# Clothing Scanner

Photograph a piece of clothing and get back: what it is, an estimated price range,
reviews, cheaper/pricier alternatives, and outfit-pairing suggestions.

See `.claude/plans` (or the plan this repo was scaffolded from) for the full design.

**All 5 tabs are now backed by real data — every planned phase (1-4) is built.**

**Status:**
- Phase 1 ✅ — image capture + Claude vision classification, end-to-end.
- Phase 2 ✅ — SerpApi (Google Shopping) listings power Similar Items / Price
  Comparison, with a single **estimated retail price** range shown. (This app
  originally also integrated eBay for a secondhand/resale price signal alongside
  retail; eBay was removed entirely — it was unreliably available — so SerpApi is
  now the sole price/listing source, and there's no resale-value estimate anymore.)
  The low/high shown is narrowed in three steps (`computePriceRange` in
  `server/src/lib/priceMath.ts`), not a raw min/max: (1) IQR/Tukey fence
  outlier removal, for a search that's mostly one tight cluster plus a
  genuine-but-wildly-priced outlier or two (e.g. a $400+ heritage-line
  reissue next to a run of $60-80 regular jackets); (2) a mild 10th/90th-
  percentile trim of whatever survives step 1, for categories with no clean
  outlier at all — some brand+category searches (e.g. "Gucci belt") span a
  smooth, continuous range across genuinely different product tiers with no
  gap to detect, which step 1 alone can't tighten; (3) a hard cap at ±25% of
  the median (`MAX_RELATIVE_SPREAD`), which only ever narrows further and
  guarantees a small, predictable gap even for a category diverse enough
  that steps 1-2 alone still leave a wide-looking (if statistically honest)
  range — a deliberate product decision, not a statistical one, prioritizing
  a tight number over one that fully reflects real cross-model price spread.
  `similarItems`/reviews still show every listing found, trimmed extremes
  included — only the summary range is affected.
- Phase 3 ✅ — review/rating snippets, sourced from a much larger SerpApi
  Google Shopping pool than what's actually displayed (`searchSerpApi` in
  `server/src/services/serpApiClient.ts` requests up to 40 raw results via
  SerpApi's `num` param; `similarItems` still shows 12 for browsing, but
  `reviews` and `estimatedNewRange` are computed from the full 40-item pool).
  Google Shopping doesn't guarantee a rating on every result, so filtering an
  already-tiny pool (the old behavior — 12 requested, 12 kept) meant whether
  any ratings survived was mostly luck, which is what caused reviews
  availability to vary wildly scan to scan; a bigger pool gives the rating
  filter far more to work with. `num` costs the same one SerpApi call against
  quota regardless of how many results it returns (confirmed live). Reviews
  are sorted by review count (ties broken by rating) so the most
  socially-validated listings surface first.
- Phase 4 ✅ — Outfit Matches asks Claude (text-only, cheap) for 3-5 complementary
  keyword phrases based on the identified item, then searches SerpApi for real
  purchasable items for the first suggestion (capped — see "Required API keys"
  below for why only one). This is a heuristic, not a trained
  outfit-compatibility model (see plan's research notes — no accessible API for that
  exists) — good for casual pairing ideas, not a styling authority.
- Gendered pairings ✅ — every classification now includes a `gender` field
  ("men" | "women" | "unisex" — see `ClassificationResult` in
  `packages/shared-types`), inferred from a visible wearer's apparent gender
  presentation or, absent one, the garment's own cut/styling. Outfit Matches
  passes this through to Claude's keyword-suggestion call, which bakes the
  gender directly into each suggested phrase (e.g. "men's navy chino pants")
  so the downstream SerpApi search comes back correctly gendered rather than a
  mixed/ungendered result. Shown on the Results screen's Overview tab and
  editable via the existing "Suggest a fix" correction flow if it's wrong.
- `/price-search` and `/outfit-suggestions` both degrade gracefully without
  `SERPAPI_KEY` configured — `/classify` still works, just with no pricing/listing
  data and keyword-only outfit ideas.
- Vision ensemble ✅ — `/classify` now runs **Google Cloud Vision** (web, label, and
  logo detection) in parallel with every single classification call, not just as a
  fallback for outright failures. Used for (1) **brand augmentation** — a detected
  logo fills in a low-confidence/no brand guess (capped at "low" confidence, tagged
  `brandSource: "vision-logo"`, shown in the app as "via logo detection" so it's
  never confused with a guess Claude itself vouches for) and (2) **unrecognized-item
  rescue** — Vision's best guess seeds a hint for one retry Claude pass, now cheaper
  to trigger since Vision starts alongside Claude's first call. Runs concurrently,
  so it adds ~zero latency on the common path. Optional: unset
  `GOOGLE_VISION_API_KEY` to skip it entirely.
- Gemini rescue ✅ — `/classify` calls **Gemini 3.1 Pro** as a second, independent
  full classification (not just entity detection like Vision) **only when Claude's
  own pass comes back "unrecognized"** — if Gemini's independent pass succeeds
  where Claude didn't, Gemini's whole result is used directly (`model:
  "gemini-3.1-pro"` on the response), tried before the older Vision-hint rescue
  path. This used to run on *every* scan (for brand cross-validation too), but
  that was reverted after live measurement: Gemini 3.1 Pro spends real time
  "thinking" internally even at its lowest setting, and running it in parallel on
  every scan pushed average classify time from a consistent ~2.2-2.6s to an
  unpredictable 3-7.7s — a real, user-visible slowdown for a benefit (brand
  fill-in on already-correctly-identified items) that mattered far less than
  fixing outright misses. It's rescue-only now, so that cost is only paid on a
  genuine failure, not on every scan. Optional: unset `GEMINI_API_KEY` to skip it
  entirely. **Note:** unlike every other optional provider here, Gemini 3.1 Pro has
  no free tier — see "Required API keys" below before enabling it.
- Barcode scanning ✅ — a second entry point alongside the photo flow: scan a
  UPC/EAN barcode on a clothing tag (in-app live camera via `expo-camera`, new
  "Scan Barcode" button on the Capture screen) and the backend looks it up via
  **UPCitemdb** (`GET /barcode-lookup`, keyless free trial tier, no signup) and
  normalizes the match into the exact same classification shape the photo flow
  produces — brand comes straight from the database match (`brandConfidence:
  "high"`, `brandSource: "barcode"`, no guessing), garmentType/category/pattern/
  style are a cheap text-only Haiku inference pass over the sparse product-listing
  text. From there it's the *same* Results screen, unmodified — pricing and outfit
  matches work identically regardless of how the item was identified. **Coverage
  caveat:** general UPC databases have historically thin coverage for clothing
  specifically (lots of private-label/fast-fashion items were never registered) —
  a "no product found" result is common and expected, not a bug; the scan screen
  offers "Try Again" and "Take Photo Instead" for exactly that reason. UPCitemdb's
  trial tier is capped at 100 requests/day *shared across all anonymous callers*,
  not just this app — the backend throttles its own usage to 80/day to leave
  headroom for others on that same pool.
- Correction ✅ — a "This isn't right? Suggest a correction" link on the Results
  screen (Overview tab) lets the user type free text describing what the item
  actually is. Unlike just re-guessing, the backend verifies it: Claude runs a
  real **web search** (Anthropic's server-side `web_search` tool) to confirm the
  correction before structuring it into the same classification shape every other
  path produces (`POST /correct-classification`) — brand/garment details are
  trusted from that verified research, not the user's unverified claim alone or a
  blind re-guess. Up to 3 corroborating sources are shown ("Verified via: ...")
  when the search found citable results. This needed two separate Claude calls,
  not one — Anthropic's docs confirm that forcing structured tool output in the
  same call as web search preempts the search entirely, so this app can't combine
  them the way `/classify`/`/barcode-lookup` combine schema-forcing with a single
  call. **Note:** unlike every other feature here, this uses raw `fetch` against
  Anthropic's REST API directly rather than the `@anthropic-ai/sdk` client the
  rest of the backend uses — the installed SDK version predates this tool and
  bumping it risked regressing the three existing Claude-dependent endpoints for
  a feature that doesn't need the bump. Also has no free tier ($10 per 1,000
  searches + token costs, same disclosure as Gemini) — but only runs when a user
  explicitly submits a correction, not per-scan, so real volume/cost is tiny;
  capped at 50/day as a pure runaway-cost circuit breaker.

## What's left (not built)

Phase 5 polish is now done:
- Prefetched results — `PreviewScreen` (and `BarcodeScanScreen`/
  `CorrectionScreen`, which reach Results the same way) kicks off pricing +
  outfit-suggestion fetches (`app/lib/prefetchResults.ts`) the instant
  classification resolves, passed to `ResultsScreen` via navigation params
  instead of waiting for it to mount and start them itself — closes a real gap
  where that work only started after the screen-transition animation finished.
  `ResultsScreen` still shows its own per-tab loading spinners while those
  fetches resolve (there's no multi-stage loading text on the classify
  spinner itself, just "Identifying item…"); per-tab "Try again" refetches
  fresh rather than reusing a stale prefetched promise.
- Image-compression tuning — `compressForUpload` tries a few width/quality
  presets (1280px/0.8 down to 600px/0.5) and stops at the first one whose
  base64 payload fits a 1.2MB budget, instead of a single fixed pass. Most
  photos still take the first (highest-quality) pass unchanged; only unusually
  large originals fall through to smaller presets. Logs total time + which
  preset was used (dev builds only).
- Production build (EAS Build) — config is in place (`app/eas.json`, plus
  `bundleIdentifier`/`package` in `app/app.json`); see "Building a
  distributable binary (EAS)" below. Actually running a build needs your own
  Expo account login, which nobody but you can do.

The only thing genuinely unbuilt is submitting to the App Store / Play Store
(needs paid developer accounts on both sides) — out of scope unless you want
this distributed beyond internal testing.

## Project layout

```
clothing-scanner/
├── app/                # Expo React Native app
├── server/              # Express/TypeScript backend
└── packages/
    └── shared-types/     # Types shared between app and server
```

## Setup

Clone the repo.

```
git clone https://github.com/benjaminsinger18-arch/clothing-scanner.git
```

This is an npm workspace — run `npm install` once from the repo root (`clothing-scanner/`)
to install both `app/` and `server/` dependencies together.

```
npm install
```

### 1. Backend

```
cd server
copy .env.example .env      # then fill in ANTHROPIC_API_KEY
npm run dev
```

Server listens on `http://localhost:3000` by default. Verify with:

```
curl http://localhost:3000/health
```

Test classification directly (skips the app):

```
curl -X POST http://localhost:3000/classify ^
  -H "Content-Type: application/json" ^
  -d "{\"imageBase64\": \"<base64 jpeg data>\"}"
```

Test the price search directly (requires `SERPAPI_KEY`; returns no listings without it):

```
curl "http://localhost:3000/price-search?garmentType=denim%20jacket&category=outerwear&color=blue&brandGuess=Levi%27s&brandConfidence=medium"
```

Test outfit suggestions directly (requires `ANTHROPIC_API_KEY`; `SERPAPI_KEY`
optional — falls back to keyword-only suggestions with no purchasable items if it
isn't configured):

```
curl -X POST http://localhost:3000/outfit-suggestions ^
  -H "Content-Type: application/json" ^
  -d "{\"garmentType\":\"denim jacket\",\"category\":\"outerwear\",\"color\":\"blue\",\"pattern\":\"solid\",\"style\":\"casual\",\"gender\":\"men\",\"brandGuess\":null,\"brandConfidence\":\"none\"}"
```

### 2. Mobile app

Find your PC's LAN IP first (needed since a physical phone can't reach `localhost`):

```
ipconfig          # look for "IPv4 Address" under your active Wi-Fi adapter
```

```
cd app
copy .env.example .env      # set EXPO_API_URL=http://<your-LAN-IP>:3000
npx expo start
```

Scan the QR code with **Expo Go** (App Store / Play Store) on your phone — phone and PC
must be on the same Wi-Fi network. The first launch will ask for camera and photo
library permissions.

## Building a distributable binary (EAS)

Everything above runs through Expo Go, which is great for development but requires
Expo Go installed and (for LAN mode) matching Wi-Fi. EAS Build produces a real `.ipa`/
`.apk`/`.aab` you can install directly or hand to a tester — no Expo Go, no dev server
needing to stay running.

1. `npm install -g eas-cli` (or use `npx eas-cli` for the commands below without a
   global install).
2. `cd app && eas login` — needs a free Expo account (https://expo.dev/signup).
3. `eas build:configure` — links this project to your Expo account and writes an
   `extra.eas.projectId` into `app.json`. One-time, per Expo account.
4. Pick a profile from `app/eas.json`:
   - `development` — includes the dev client, points at `localhost` (simulator/emulator
     only, or edit the profile's `EXPO_API_URL` to your LAN IP for a device).
   - `preview` — internal-distribution build (installable via a link EAS gives you, no
     store needed) pointed at the deployed Render backend — closest to what a remote
     tester should install.
   - `production` — same backend URL, `autoIncrement` on for repeat store submissions.
5. `eas build --profile preview --platform ios` (or `android`, or `all`). EAS builds in
   the cloud; you'll get a QR code / URL to install the result once it finishes.
6. If the deployed backend has `APP_SHARED_SECRET` set (see "Backend auth" below), also
   set `EXPO_APP_SHARED_SECRET` for the build — don't put a real secret in
   `eas.json` since it's committed to git; use `eas env:create` (or the Expo dashboard)
   to store it instead, scoped to the profile you're building.

`app.json`'s `ios.bundleIdentifier` / `android.package` are currently placeholder
values (`com.clothingscanner.app`) — fine for internal builds via step 5, but you'll
want your own reverse-DNS identifier before ever submitting to the App Store / Play
Store.

## Running as a website (no Expo Go, no app install at all)

Expo can also export this app as a static website via `react-native-web` — open a
URL in any browser (including a phone browser) instead of installing anything.
Everything under `app/screens` runs unmodified; `expo-image-picker`'s camera launch
falls back to the browser's native file/camera input on web.

**Try it locally first:**

```
cd app
npx expo start --web
```

**Deploy to Vercel:**

1. Push this repo to GitHub (skip if already there).
2. Go to https://vercel.com/new and import the repo. Vercel will detect the included
   `vercel.json` (repo root) automatically — leave the project's **Root Directory**
   as the repo root, don't point it at `app/` (or `server/`), since the build needs
   to see the whole npm workspace to link `@clothing-scanner/shared-types`.
3. Under **Settings → General → Framework Preset**, make sure it's set to **Other**.
   `vercel.json` sets `"framework": null` to force this, but if Vercel's
   auto-detection picked something else before that file existed (e.g. it noticed
   `express` — a `server/` dependency, hoisted into the root `node_modules` by the
   npm workspace — and assumed this is a Node.js server project), the dashboard
   setting can stick and override it; set it explicitly to be safe.
4. Before the first deploy, add these under **Settings → Environment Variables**
   (same values as `app/.env` — see "Mobile app" setup above):
   - `EXPO_API_URL` — your deployed Render backend URL.
   - `EXPO_APP_SHARED_SECRET` — only if the backend has `APP_SHARED_SECRET` set.

   `app/app.config.js` reads these from `process.env` at build time and re-exposes
   them via `extra` for the app to read through `expo-constants` — note they still
   end up in the shipped bundle either way (unavoidable for anything the client
   needs to call the backend with), same as Metro's `EXPO_PUBLIC_*` auto-inlining
   would do. Either way, they must be set *before* the build runs, not after.
5. Deploy. Vercel runs `vercel.json`'s `buildCommand` (builds `shared-types`, then
   `expo export --platform web` inside `app/`) and serves the static `app/dist`
   output, with a rewrite so client-side navigation doesn't 404 on refresh.
6. Any push to the connected branch redeploys automatically.

This is genuinely a different runtime than the native app (React Native Web renders
DOM instead of native views), so double-check the capture flow in a real mobile
browser after your first deploy — camera permission prompts and file-input behavior
vary more across browsers than across iOS/Android.

## Letting a remote collaborator test the app

The steps above only work if your friend's phone is on the *same Wi-Fi network* as
this PC — Expo Go needs to reach both the Metro bundler and the backend. If they're
somewhere else, two things need to be reachable over the internet instead:

**1. Deploy the backend (one-time setup)** — a `render.yaml` blueprint is included:

1. Push this repo to GitHub (already done if you're reading this from there).
2. Go to https://dashboard.render.com/ → **New** → **Blueprint** → connect this repo.
   Render reads `render.yaml` and creates the web service automatically.
3. In the Render dashboard, set the `ANTHROPIC_API_KEY` / `SERPAPI_KEY` /
   `GOOGLE_VISION_API_KEY` / `GEMINI_API_KEY` env vars (they're marked `sync: false`
   in the blueprint, so Render prompts for them rather than expecting them in the
   repo — `GOOGLE_VISION_API_KEY` and `GEMINI_API_KEY` can both be left blank,
   they're optional; remember Gemini has no free tier if you do set it, see
   "Required API keys" below).
4. Once deployed, Render gives you a stable URL like
   `https://clothing-scanner-server.onrender.com`. Put that in **both** your and your
   friend's `app/.env` as `EXPO_API_URL` (instead of the LAN IP).

   Free-tier Render web services spin down after ~15 min idle and take a few seconds
   to wake back up on the next request — fine for testing, just expect the first
   request after a lull to be slow.
5. Also set `APP_SHARED_SECRET` (any long random string) — see "Backend auth" below.
   Without it, the deployed URL is wide open to anyone who finds it.

**2. Tunnel Expo itself** so the QR code works from anywhere, not just your LAN:

```
cd app
npx expo start --tunnel
```

(First run installs `@expo/ngrok` if it's not already present — accept the prompt.)
Your friend scans that QR code with Expo Go, same as normal. Your PC still needs to
stay on and `expo start --tunnel` running for the whole session — this isn't a
hosted app, it's your dev server, just reachable remotely.

## Backend auth

Once the backend is deployed publicly (e.g. Render), its URL is no longer private —
anyone who finds it can hit `/classify`, `/price-search`, or `/outfit-suggestions`,
each of which costs real money (Claude/SerpApi calls). Set `APP_SHARED_SECRET`
on the server to a long random string, and `EXPO_APP_SHARED_SECRET` in
`app/.env` to the *same* value — the app sends it as an `X-App-Secret` header, and
the server rejects any request to a paid endpoint without it (`/health` stays open,
since Render's own health checks hit it with no headers).

This is a **deterrent, not real security** — the secret ships inside the app bundle
and is extractable by anyone who unpacks it. It stops casual/automated abuse of the
bare URL, not a determined attacker. Fine for this project's scale (you + friends
testing); if this ever goes to real users, replace it with per-user auth instead.

Leave `APP_SHARED_SECRET` unset for local dev — auth is skipped entirely when it's
not configured, so `npm run dev` works with zero setup.

### Troubleshooting

- **"Could not reach the backend"** — confirm the server is running, your phone and PC
  are on the same network, and `EXPO_API_URL` in `app/.env` uses the LAN IP, not
  `localhost`. Restart `expo start` after editing `.env` (Expo only reads it at startup).
- **Occasional plain-text "Not Found" from the deployed Render backend** — a known
  free-tier quirk (`x-render-routing: no-server` in the response headers) that happens
  around cold starts / instance transitions, not an app bug. It resolves itself on
  retry within a second or two. If it persists across several retries, check the
  Render dashboard for an actual deploy/crash error instead.
- **"classification_failed" / 502 from `/classify`** — check `server/.env` has a valid
  `ANTHROPIC_API_KEY` and the server console for the underlying error.
- **401 "unauthorized"** — `app/.env`'s `EXPO_APP_SHARED_SECRET` doesn't match
  the server's `APP_SHARED_SECRET`. Make sure both are set to the exact same value,
  and restart `expo start` after editing `.env`.
- **"Couldn't identify a clothing item"** — expected behavior for non-clothing or very
  unclear photos; retake with a single garment filling most of the frame in good light.
- **No "estimated retail price" shown** — means SerpApi found nothing for that
  item; common for older/discontinued items, or if `SERPAPI_KEY` isn't configured
  yet.
- **Reviews tab is empty or sparse** — possible for a niche/uncommon item even
  with the larger 40-item search pool (see Phase 3 above); not every Google
  Shopping listing includes a rating, and some categories genuinely have few
  rated listings. If this is happening on common, popular items, something's
  wrong — check the server console for SerpApi errors.

## Improving classification accuracy

Claude's own weights can't be fine-tuned via the API, so accuracy work here means prompt/ensemble
tuning — which first needs a way to measure whether a change actually helped. A few pieces of
infrastructure exist for that:

- **Correction log** (`server/data/corrections.jsonl`) — every time a user submits a correction via
  the "Suggest a fix" flow (see "Correction" above) and it's successfully verified, the original
  (wrong) classification, the user's correction text, the verified result, and the photo thumbnail
  (if the client sent one) are appended as one JSON line (see `server/src/lib/correctionLog.ts`).
  This is local-disk, gitignored, and **not persisted on a Render free-tier deploy by default** — no
  persistent disk there, so it survives local dev restarts but is wiped on every Render
  restart/redeploy *unless* bucket sync is configured (see `HF_BUCKET_*` under "Required API keys"
  below) — when set, this file is restored from a Hugging Face Storage Bucket at server startup and
  re-synced there after every write. A good source of real-world misclassification examples to
  curate into the golden eval set below. Note this is a *biased* sample — only scans someone bothered
  to correct.
- **Classification log** (`server/data/classifications.jsonl`) — every successful `/classify` and
  `/barcode-lookup` call (not just corrections) appends its result — unbiased, since it's every scan,
  not just known failures (see `server/src/lib/classificationLog.ts`). Deliberately doesn't store the
  photo (scan volume is much higher than corrections; the correction log above already covers
  image-carrying failures). Same Render free-tier caveat — and the same optional bucket-sync
  mitigation — as the correction log. Run `npm run summarize --workspace=server` to print real
  usage-pattern stats from it: unrecognized rate, how often Gemini's rescue pass or Vision's
  brand-fill signal fires, brand confidence distribution.
- **Eval harness** (`server/eval/`) — a golden set of expected classification fields
  (`server/eval/golden/`, seeded with 10 openly-licensed Wikimedia Commons stock photos — see its
  own README for format, licensing (`ATTRIBUTIONS.md`), and why stock photos are a supplement to
  real phone photos, not a replacement) and a runner (`npm run eval --workspace=server`) that calls
  the real classification pipeline against each one and reports per-field pass rates. Makes real
  Claude/Vision/Gemini calls (no mocking) — see `server/eval/golden/README.md` for cost guidance and
  grading rules. This is a report, not a CI gate; there's no CI in this repo yet.

## Required API keys

- `ANTHROPIC_API_KEY` — from https://console.anthropic.com/ (used for vision classification; required for the app to do anything at all).
  Also powers the correction feature's web-search verification pass (`POST
  /correct-classification`) — no separate key needed, but that endpoint draws on
  Anthropic's `web_search` tool, billed at **$10 per 1,000 searches** plus normal
  token costs, with no free tier. Only runs when a user submits a correction (not
  per-scan), capped at 50/day in `rateLimitTracker.ts` as a runaway-cost guard.
- `SERPAPI_KEY` — from https://serpapi.com/ (sign up, key is issued immediately, no
  approval wait). This is the sole price/listing data source in the app (an earlier
  version also integrated eBay; it was removed entirely for being unreliably
  available). Free tier is 250 searches/month; the backend proactively throttles at
  220/month to leave headroom (see `server/src/lib/rateLimitTracker.ts`). It's the
  tightest quota in the app, shared between `/price-search` (~80-100 calls/month at
  this project's usage estimate) and a dedicated, smaller slice reserved for Outfit
  Matches (capped to the *first* suggested keyword phrase only, not all 3-5 — see
  the comments in `server/src/routes/outfitSuggestions.ts` and
  `rateLimitTracker.ts` for the arithmetic behind that cap).
- `GOOGLE_VISION_API_KEY` — optional, from https://console.cloud.google.com/:
  1. Create (or pick) a project, then enable the **Cloud Vision API** for it.
  2. **Credentials** → **Create Credentials** → **API key**. No OAuth/service-account
     setup needed — the REST endpoint this app calls (`images:annotate`) accepts a
     plain API key.
  3. Paste it into `server/.env`. Free tier is 1,000 units/month *per feature type*
     (web/label/logo detection each get their own allotment); the backend throttles
     at 900/month to leave headroom (see `rateLimitTracker.ts`). Leave unset to skip
     Vision entirely — `/classify` still works with Claude alone, just without the
     logo-detection brand boost or the unrecognized-item rescue pass.
- `GEMINI_API_KEY` — optional, from https://aistudio.google.com/ (API keys section
  — sign up, key is issued immediately). Paste it into `server/.env`.
  **Unlike every other key above, this one has no free tier at all** — Gemini 3.1
  Pro is billed from the first call (~$2/M input tokens, ~$12/M output tokens as of
  writing). A single classification call is roughly 1,500-2,000 tokens all in, so
  in practice this runs to fractions of a cent per scan — at this project's
  ~80-100 scans/month estimate that's well under a dollar a month, but it's real
  money from the very first request, unlike everything else in this list. The
  backend caps it at 300 calls/day (see `rateLimitTracker.ts`) purely as a
  runaway-cost circuit breaker, not quota protection. Leave unset to skip Gemini
  entirely — `/classify` still works with Claude (+ Vision) alone, just without
  Gemini's brand cross-validation or its unrecognized-item rescue pass.
- `HF_BUCKET_S3_ENDPOINT` / `HF_BUCKET_NAME` / `HF_BUCKET_ACCESS_KEY_ID` /
  `HF_BUCKET_SECRET_ACCESS_KEY` — optional, all four together persist
  `corrections.jsonl`/`classifications.jsonl` to a Hugging Face Storage Bucket (see
  `server/src/lib/bucketSync.ts`) so they survive Render free-tier restarts/redeploys.
  Setup is manual and one-time: create a bucket at https://huggingface.co/new-bucket
  (or `hf buckets create <name>`), then generate S3 credentials from a User Access
  Token's dropdown ("Generate S3 credentials", **Write** scope) at
  https://huggingface.co/settings/tokens — `HF_BUCKET_S3_ENDPOINT` is the resulting
  gateway URL scoped to your namespace (e.g. `https://s3.hf.co/your-username`), and
  the access key ID / secret access key come from that same step. Leave any of the
  four unset to skip this entirely — both logs stay local-disk-only, exactly as
  before this existed.

`/price-search` returns `status: "unavailable"` when `SERPAPI_KEY` isn't configured
(there's no other source to fall back to). Check the server console on startup for
a reminder of which keys are missing.
