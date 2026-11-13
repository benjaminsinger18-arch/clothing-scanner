# Setup

How to run Clothing Scanner locally, on a phone, as a website, and for a remote tester.

## Project layout

```text
clothing-scanner/
├── app/                   # Expo React Native app (iOS, Android, web)
├── server/                # Express / TypeScript backend
└── packages/shared-types/ # Types shared between app and server
```

This is an npm workspace. One `npm install` from the repo root installs all three packages.

```bash
git clone https://github.com/benjaminsinger18-arch/clothing-scanner.git
cd clothing-scanner
npm install
```

## 1. Backend

```bash
cd server
cp .env.example .env        # Windows (Command Prompt): copy .env.example .env
# fill in ANTHROPIC_API_KEY at minimum
npm run dev
```

The server listens on `http://localhost:3000`. Check it with:

```bash
curl http://localhost:3000/health
```

You can exercise the endpoints without the app. See [API.md](API.md) for request shapes and example `curl` calls.

## 2. Mobile app (Expo Go)

A physical phone cannot reach `localhost`, so find your computer's LAN IP first:

```bash
ipconfig      # Windows: "IPv4 Address" under the active Wi-Fi adapter
ifconfig      # Mac / Linux
```

```bash
cd app
cp .env.example .env        # set EXPO_API_URL=http://<your-LAN-IP>:3000
npx expo start
```

Scan the QR code with **Expo Go** (App Store / Play Store). Phone and computer must be on the same Wi-Fi network. The first launch asks for camera and photo-library permissions.

Restart `expo start` after editing `.env`; Expo reads it only at startup.

## 3. Website (no install at all)

Expo exports the app as a static site via `react-native-web`. Every screen runs unmodified; the camera launch falls back to the browser's native file or camera input.

```bash
cd app
npx expo start --web
```

### Deploy the site to Vercel

1. Import the repo at <https://vercel.com/new>. Leave **Root Directory** as the repo root (not `app/`), because the build needs the whole workspace to link `@clothing-scanner/shared-types`. `vercel.json` sets the build command and output directory.
2. Under **Settings > General > Framework Preset**, set **Other**. `vercel.json` sets `"framework": null`, but a dashboard value chosen earlier can override it.
3. Under **Settings > Environment Variables**, add `EXPO_API_URL` (your deployed backend URL) and, if the backend has `APP_SHARED_SECRET` set, `EXPO_APP_SHARED_SECRET`. `app/app.config.js` reads both at build time, so set them before the first deploy. They end up in the shipped bundle, as anything the client needs to call the backend must.
4. Deploy. Every push to the connected branch redeploys.

React Native Web is a different runtime from the native app, so check the capture flow in a real mobile browser after the first deploy.

## 4. Deploy the backend to Render

A `render.yaml` blueprint is included.

1. On <https://dashboard.render.com/>, choose **New > Blueprint** and connect this repo. Render creates the web service from the blueprint.
2. Set the environment variables Render prompts for (they are marked `sync: false`). `ANTHROPIC_API_KEY` and `SERPAPI_KEY` are the ones that matter; the rest are optional (see the key table below).
3. Set `APP_SHARED_SECRET` to a long random string. Without it the deployed URL is open to anyone who finds it.
4. Render gives you a URL such as `https://clothing-scanner-server.onrender.com`. Put it in `app/.env` as `EXPO_API_URL`.

Free-tier Render services spin down after about 15 minutes idle and take a few seconds to wake. Expect the first request after a lull to be slow.

## 5. Let a remote tester use it

Expo Go needs to reach both the Metro bundler and the backend. With the backend on Render, tunnel Metro:

```bash
cd app
npx expo start --tunnel
```

The first run installs `@expo/ngrok`. Your computer must stay on with the tunnel running for the whole session. The tester scans the QR code with Expo Go as usual.

## 6. Build a distributable binary (EAS)

EAS Build produces a real `.ipa`, `.apk` or `.aab` that installs without Expo Go.

1. `npm install -g eas-cli` (or use `npx eas-cli`).
2. `cd app && eas login` with a free Expo account.
3. `eas build:configure` links the project to your account and writes `extra.eas.projectId` into `app.json`.
4. Pick a profile from `app/eas.json`: `development` (dev client, points at `localhost`), `preview` (internal distribution, points at the Render backend), or `production` (same backend, `autoIncrement` on).
5. `eas build --profile preview --platform ios` (or `android`, or `all`). EAS builds in the cloud and returns an install link.
6. If the backend has `APP_SHARED_SECRET` set, store `EXPO_APP_SHARED_SECRET` with `eas env:create` scoped to the profile rather than in the committed `eas.json`.

`app.json` ships placeholder identifiers (`com.clothingscanner.app`). Replace them with your own reverse-DNS identifier before submitting to a store.

## Backend auth

Set `APP_SHARED_SECRET` on the server and `EXPO_APP_SHARED_SECRET` in `app/.env` to the same value. The app sends it as an `X-App-Secret` header and the server rejects any request to a paid endpoint without it. `/health` stays open for Render's health checks.

This is a deterrent, not real security: the secret ships inside the app bundle. It stops casual abuse of a bare URL. Replace it with per-user auth before real users. Leave it unset for local development and auth is skipped entirely.

## API keys

| Key                     | Required?   | Used for                                                                                                                    | Free tier and caps                                                                    |
| ----------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`     | Yes         | Classification (Claude Sonnet 5), outfit keywords and barcode text (Claude Haiku 4.5), correction verification (web search) | Web search is billed at $10 per 1,000 searches; the server caps corrections at 50/day |
| `SERPAPI_KEY`           | For pricing | Google Shopping listings behind price ranges, reviews and outfit matches                                                    | 250 searches/month free; the server throttles at 220                                  |
| `GOOGLE_VISION_API_KEY` | No          | Logo detection to fill a missing brand, and a hint for one retry when Claude cannot identify the item                       | 1,000 units/month per feature; throttled at 900                                       |
| `GEMINI_API_KEY`        | No          | Rescue pass when Claude returns "unrecognized" (Gemini 3.1 Pro)                                                             | No free tier; fractions of a cent per call, capped at 300/day                         |
| `HF_BUCKET_*` (4 vars)  | No          | Persist the correction and classification logs to a Hugging Face bucket so they survive Render restarts                     | Free bucket; see `server/.env.example` for the one-time setup                         |
| `AFFILIATE_TAG_*`       | No          | Append an affiliate query string to outbound marketplace links                                                              | Inert unless set                                                                      |

Where to get them: Anthropic at <https://console.anthropic.com/>, SerpApi at <https://serpapi.com/>, Google Vision at <https://console.cloud.google.com/> (enable the Cloud Vision API, then create an API key), Gemini at <https://aistudio.google.com/>.

Without `SERPAPI_KEY`, `/price-search` returns `status: "unavailable"` and outfit matches show keyword ideas with no purchasable items. The server prints which keys are missing on startup.
