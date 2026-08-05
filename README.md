# Clothing Scanner

Photograph a piece of clothing and get back: what it is, an estimated price range,
reviews, cheaper/pricier alternatives, and outfit-pairing suggestions.

See `.claude/plans` (or the plan this repo was scaffolded from) for the full design.

**Status:**
- Phase 1 ✅ — image capture + Claude vision classification, end-to-end.
- Phase 2 ✅ — Similar Items / Price Comparison tabs backed by real eBay Browse API
  listings. Two separate price ranges are shown: an **estimated new price** (from
  eBay listings filtered to new/unworn condition) and an **estimated resale value**
  (from all eBay listings, which skew secondhand). eBay is a secondhand-heavy
  marketplace, so these are kept distinct rather than blended into one misleading
  number — true cross-retailer *new* pricing arrives with SerpApi in Phase 3.
  Reviews and Outfit Matches tabs are still mocked (Phases 3–4).

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

Test the price search directly (Phase 2, requires eBay keys):

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
- **No "estimated new price" shown, only resale** — normal for items eBay mostly sells
  used (common for older/discontinued items); the UI already caveats this.

## Required API keys

- `ANTHROPIC_API_KEY` (Phase 1) — from https://console.anthropic.com/ (used for vision classification)
- `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` (Phase 2) — from https://developer.ebay.com/:
  1. Sign up for a free developer account (individual, no business entity needed).
  2. Create an application keyset under **Application Keys** — you'll get a "Client ID" (App ID)
     and "Client Secret" (Cert ID) pair.
  3. **Use the production keyset, not sandbox** — sandbox returns fake catalog data, not real
     listings, which defeats the point of price estimation.
  4. Paste both values into `server/.env`.

  The backend handles OAuth token exchange/caching itself (client-credentials grant) —
  no further eBay-side setup needed. If these are missing, `/price-search` degrades
  gracefully (`status: "unavailable"`) instead of crashing; check the server console for
  a reminder.

Later phases will also need `SERPAPI_KEY`.
