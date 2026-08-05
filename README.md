# Clothing Scanner

Photograph a piece of clothing and get back: what it is, an estimated price range,
reviews, cheaper/pricier alternatives, and outfit-pairing suggestions.

See `.claude/plans` (or the plan this repo was scaffolded from) for the full design.

**All 5 tabs are now backed by real data — every planned phase (1-4) is built.**

**Status:**
- Phase 1 ✅ — image capture + Claude vision classification, end-to-end.
- Phase 2 ✅ — real eBay Browse API listings power Similar Items / Price Comparison.
- Phase 3 ✅ — SerpApi (Google Shopping) adds cross-retailer new/retail pricing and
  review/rating snippets, merged alongside eBay's data. Two price ranges are shown:
  an **estimated new/retail price** (eBay new-condition listings + Google Shopping)
  and an **estimated resale value** (all eBay listings, which skew secondhand) — kept
  separate rather than blended into one misleading number.
- Phase 4 ✅ — Outfit Matches asks Claude (text-only, cheap) for 3-5 complementary
  keyword phrases based on the identified item, then searches eBay for real
  purchasable items per suggestion. This is a heuristic, not a trained
  outfit-compatibility model (see plan's research notes — no accessible API for that
  exists) — good for casual pairing ideas, not a styling authority.
- `/price-search` and `/outfit-suggestions` merge/degrade per-provider — **eBay and
  SerpApi work independently**, so if you're waiting on eBay approval you can still
  set up `SERPAPI_KEY` now and get real Google Shopping data while eBay shows as
  unavailable. Outfit Matches only needs `ANTHROPIC_API_KEY` + eBay (SerpApi is
  intentionally skipped there — see "Required API keys" below).

## What's left (not built)

Everything in the original plan's 5 phases is done except **Phase 5 polish**:
pricing and outfit data already fetch independently in parallel once the item is
classified (each tab shows its own loading/error state), but there's no staged
"Identifying item… → Finding prices… → Finding outfit matches…" progress text
during the initial classify step, no image-compression tuning beyond the Phase 1
baseline, and no production build (EAS Build) if you want a distributable binary
instead of Expo Go. None of that blocks using the app today.

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

Test the price search directly (works with either or both of eBay/SerpApi configured):

```
curl "http://localhost:3000/price-search?garmentType=denim%20jacket&category=outerwear&color=blue&brandGuess=Levi%27s&brandConfidence=medium"
```

Test outfit suggestions directly (requires `ANTHROPIC_API_KEY`; eBay optional — falls
back to keyword-only suggestions with no purchasable items if eBay isn't configured):

```
curl -X POST http://localhost:3000/outfit-suggestions ^
  -H "Content-Type: application/json" ^
  -d "{\"garmentType\":\"denim jacket\",\"category\":\"outerwear\",\"color\":\"blue\",\"pattern\":\"solid\",\"style\":\"casual\",\"brandGuess\":null,\"brandConfidence\":\"none\"}"
```

### 2. Mobile app

Find your PC's LAN IP first (needed since a physical phone can't reach `localhost`):

```
ipconfig          # look for "IPv4 Address" under your active Wi-Fi adapter
```

```
cd app
copy .env.example .env      # set EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3000
npx expo start
```

Scan the QR code with **Expo Go** (App Store / Play Store) on your phone — phone and PC
must be on the same Wi-Fi network. The first launch will ask for camera and photo
library permissions.

## Letting a remote collaborator test the app

The steps above only work if your friend's phone is on the *same Wi-Fi network* as
this PC — Expo Go needs to reach both the Metro bundler and the backend. If they're
somewhere else, two things need to be reachable over the internet instead:

**1. Deploy the backend (one-time setup)** — a `render.yaml` blueprint is included:

1. Push this repo to GitHub (already done if you're reading this from there).
2. Go to https://dashboard.render.com/ → **New** → **Blueprint** → connect this repo.
   Render reads `render.yaml` and creates the web service automatically.
3. In the Render dashboard, set the `ANTHROPIC_API_KEY` / `EBAY_CLIENT_ID` /
   `EBAY_CLIENT_SECRET` / `SERPAPI_KEY` env vars (they're marked `sync: false` in the
   blueprint, so Render prompts for them rather than expecting them in the repo).
4. Once deployed, Render gives you a stable URL like
   `https://clothing-scanner-server.onrender.com`. Put that in **both** your and your
   friend's `app/.env` as `EXPO_PUBLIC_API_URL` (instead of the LAN IP).

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
each of which costs real money (Claude/eBay/SerpApi calls). Set `APP_SHARED_SECRET`
on the server to a long random string, and `EXPO_PUBLIC_APP_SHARED_SECRET` in
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
  are on the same network, and `EXPO_PUBLIC_API_URL` in `app/.env` uses the LAN IP, not
  `localhost`. Restart `expo start` after editing `.env` (Expo only reads it at startup).
- **Occasional plain-text "Not Found" from the deployed Render backend** — a known
  free-tier quirk (`x-render-routing: no-server` in the response headers) that happens
  around cold starts / instance transitions, not an app bug. It resolves itself on
  retry within a second or two. If it persists across several retries, check the
  Render dashboard for an actual deploy/crash error instead.
- **"classification_failed" / 502 from `/classify`** — check `server/.env` has a valid
  `ANTHROPIC_API_KEY` and the server console for the underlying error.
- **401 "unauthorized"** — `app/.env`'s `EXPO_PUBLIC_APP_SHARED_SECRET` doesn't match
  the server's `APP_SHARED_SECRET`. Make sure both are set to the exact same value,
  and restart `expo start` after editing `.env`.
- **"Couldn't identify a clothing item"** — expected behavior for non-clothing or very
  unclear photos; retake with a single garment filling most of the frame in good light.
- **No "estimated new/retail price" shown, only resale** — means neither eBay's
  new-condition search nor SerpApi found anything; common for older/discontinued
  items, or if `SERPAPI_KEY` isn't configured yet.
- **Reviews tab is empty** — expected for many items; not every Google Shopping
  listing includes a rating, and eBay listings never do.

## Required API keys

- `ANTHROPIC_API_KEY` — from https://console.anthropic.com/ (used for vision classification; required for the app to do anything at all)
- `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` — from https://developer.ebay.com/:
  1. Sign up for a free developer account (individual, no business entity needed) —
     approval isn't always instant.
  2. Create an application keyset under **Application Keys** — you'll get a "Client ID" (App ID)
     and "Client Secret" (Cert ID) pair.
  3. **Use the production keyset, not sandbox** — sandbox returns fake catalog data, not real
     listings, which defeats the point of price estimation.
  4. Paste both values into `server/.env`.

  The backend handles OAuth token exchange/caching itself (client-credentials grant) —
  no further eBay-side setup needed.
- `SERPAPI_KEY` — from https://serpapi.com/ (sign up, key is issued immediately, no
  approval wait). Free tier is 250 searches/month; the backend proactively throttles
  at 220/month to leave headroom (see `server/src/lib/rateLimitTracker.ts`).

`/price-search` merges whichever of eBay/SerpApi are configured — either can be
missing and the endpoint still returns whatever data the other provides
(`status: "unavailable"` only when *neither* source works). Check the server console
on startup for a reminder of which keys are missing.
