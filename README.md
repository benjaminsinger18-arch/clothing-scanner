# Clothing Scanner

Photograph a piece of clothing and get back: what it is, an estimated price range,
reviews, cheaper/pricier alternatives, and outfit-pairing suggestions.

See `.claude/plans` (or the plan this repo was scaffolded from) for the full design.

**Status:**
- Phase 1 ✅ — image capture + Claude vision classification, end-to-end.
- Phase 2 ✅ — real eBay Browse API listings power Similar Items / Price Comparison.
- Phase 3 ✅ — SerpApi (Google Shopping) adds cross-retailer new/retail pricing and
  review/rating snippets, merged alongside eBay's data. Two price ranges are shown:
  an **estimated new/retail price** (eBay new-condition listings + Google Shopping)
  and an **estimated resale value** (all eBay listings, which skew secondhand) — kept
  separate rather than blended into one misleading number. The Reviews tab now shows
  real rating data where Google Shopping provides it. Outfit Matches is still mocked
  (Phase 4).
- `/price-search` merges whichever providers are configured — **eBay and SerpApi work
  independently**, so if you're waiting on eBay approval you can still set up
  `SERPAPI_KEY` now and get real Google Shopping data while eBay shows as
  unavailable.

## Project layout

```
clothing-scanner/
├── app/                # Expo React Native app
├── server/              # Express/TypeScript backend
└── packages/
    └── shared-types/     # Types shared between app and server
```

## Setup

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

### Troubleshooting

- **"Could not reach the backend"** — confirm the server is running, your phone and PC
  are on the same network, and `EXPO_PUBLIC_API_URL` in `app/.env` uses the LAN IP, not
  `localhost`. Restart `expo start` after editing `.env` (Expo only reads it at startup).
- **"classification_failed" / 502 from `/classify`** — check `server/.env` has a valid
  `ANTHROPIC_API_KEY` and the server console for the underlying error.
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
