# Backend API

Express server in `server/`, one file per route under `server/src/routes/`. JSON in, JSON out. Images travel as base64 JPEG in the request body (limit 10 MB).

## Auth

When `APP_SHARED_SECRET` is set on the server, every endpoint except `/health` requires the header `X-App-Secret: <that value>` or returns `401 { "error": "unauthorized" }`. When it is unset, auth is skipped.

## `GET /health`

Liveness check used by Render. Always open.

```json
{ "status": "ok" }
```

## `POST /classify`

Identify the garment in a photo. Runs Claude Sonnet 5 (forced structured output) and Google Vision (labels and logos) in parallel; if Claude returns "unrecognized", tries Gemini 3.1 Pro, then one Claude retry seeded with Vision's best guess. A detected logo fills in a missing brand at "low" confidence, tagged `brandSource: "vision-logo"`.

```bash
curl -X POST http://localhost:3000/classify \
  -H "Content-Type: application/json" \
  -d '{"imageBase64": "<base64 jpeg>"}'
```

Response (trimmed). `classifications` is an array because a photo can contain more than one item; the first entry is the primary subject.

```json
{
  "classifications": [
    {
      "garmentType": "denim jacket",
      "category": "outerwear",
      "color": "blue",
      "pattern": "solid",
      "style": "casual",
      "gender": "men",
      "brandGuess": "Levi's",
      "brandConfidence": "medium",
      "brandSource": "claude",
      "confidence": 0.91
    }
  ],
  "model": "claude-sonnet-5"
}
```

`model` is `"gemini-3.1-pro"` when the rescue pass produced the result. An unrecognized photo returns `{ "status": "unrecognized" }`.

## `GET /price-search`

Google Shopping listings via SerpApi, with an estimated retail range and, when at least 3 resale-marketplace listings appear, an estimated resale range. Ranges are narrowed by IQR outlier removal, a 10th/90th percentile trim and a cap of 25 percent either side of the median (`server/src/lib/priceMath.ts`). Up to 40 raw results are fetched; 12 are shown as similar items, and reviews are taken from the whole pool.

```bash
curl "http://localhost:3000/price-search?garmentType=denim%20jacket&category=outerwear&color=blue&brandGuess=Levi%27s&brandConfidence=medium"
```

Returns `status: "unavailable"` when `SERPAPI_KEY` is not set.

## `POST /outfit-suggestions`

Asks Claude Haiku 4.5 for 3 to 5 complementary keyword phrases (gender baked in, such as "men's navy chino pants"), then searches SerpApi for real items for the first phrase only, to protect the SerpApi quota.

```bash
curl -X POST http://localhost:3000/outfit-suggestions \
  -H "Content-Type: application/json" \
  -d '{"garmentType":"denim jacket","category":"outerwear","color":"blue","pattern":"solid","style":"casual","gender":"men","brandGuess":null,"brandConfidence":"none"}'
```

Without `SERPAPI_KEY` the keywords come back with no purchasable items.

## `GET /barcode-lookup?upc=<code>`

Looks up a UPC/EAN on UPCitemdb (keyless trial tier, shared 100/day pool, throttled to 80/day here) and normalizes the match into the same classification shape as `/classify`. Brand comes from the database match (`brandSource: "barcode"`, `brandConfidence: "high"`); garment type, category, pattern and style are inferred from the listing text by Claude Haiku 4.5. A "no product found" result is common for clothing, which is thinly covered in UPC databases.

## `POST /correct-classification`

Takes the original classification plus free text from the user describing what the item really is. Claude runs a real web search to verify the correction before restructuring it into the standard shape, and returns up to 3 corroborating sources. Two Claude calls are needed because structured output and web search cannot be forced in the same call. Capped at 50/day. Verified corrections are appended to `server/data/corrections.jsonl`.

## `GET /usage`

Current soft-cap counters per provider (SerpApi, Vision, Gemini, UPCitemdb, Claude web search) from `rateLimitTracker.ts`. Counts are per process and reset on restart.

```json
{ "serpapi": { "count": 42, "cap": 220, "period": "month" }, "vision": { "count": 130, "cap": 900, "period": "month" } }
```

The app's Settings screen shows these as progress bars that turn amber past 75 percent and red past 95 percent.

## Error shape

Unhandled errors return `500 { "error": "internal_error" }`. `/classify` returns `502 { "error": "classification_failed" }` when the model call itself fails (usually a missing or invalid `ANTHROPIC_API_KEY`).
