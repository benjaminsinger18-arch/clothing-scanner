# How it was built

The app went up in phases. Each one shipped behind the same five-tab Results screen, so the UI never had to change shape as the data behind it got real.

## Phase 1: identify the garment

Camera or photo-library capture in Expo, compressed on device to a 1.2 MB base64 budget (`compressForUpload` tries 1280px/0.8 down to 600px/0.5 and stops at the first preset that fits), then `POST /classify` to an Express backend that asks Claude for a structured classification: garment type, category, color, pattern, style, gender and a brand guess with a confidence level.

## Phase 2: price it

SerpApi's Google Shopping results power the Similar Items and Price Comparison tabs. An earlier eBay integration was removed for being unreliably available; resale pricing came back later without a second vendor by recognizing resale marketplaces (Poshmark, ThredUp, The RealReal, Depop, Grailed, eBay) inside the same Google Shopping pool and splitting them out. A resale range only appears once 3 or more resale listings turn up.

Each range is narrowed in three steps rather than shown as a raw min and max: IQR outlier removal, a 10th/90th percentile trim, then a hard cap at 25 percent either side of the median. The last step is a product decision, trading some honesty about cross-model spread for a tight, predictable number. Similar Items still shows every listing found.

## Phase 3: reviews

Review snippets come from a 40-result SerpApi pool rather than the 12 shown for browsing. Google Shopping does not guarantee a rating on every result, so filtering a 12-item pool made review availability a coin flip from scan to scan. A bigger pool costs the same single SerpApi call against quota.

## Phase 4: outfit matches

Claude (text only, cheap) suggests 3 to 5 complementary keyword phrases with the item's gender baked in, and SerpApi fetches real items for the first phrase only, to protect the tightest quota in the app. This is a heuristic, not a trained outfit-compatibility model.

## Then the rest

- **Vision ensemble.** Google Vision runs in parallel with every Claude call: a detected logo fills a missing brand (tagged "via logo detection" in the app), and its best guess seeds one retry when Claude cannot identify the item.
- **Gemini rescue.** Gemini 3.1 Pro once ran on every scan for brand cross-validation. Live measurement showed it pushed average classify time from a steady 2.2 to 2.6 seconds up to an unpredictable 3 to 7.7 seconds, so it became rescue-only: it runs only when Claude returns "unrecognized."
- **Barcode scanning.** A second entry point via UPCitemdb, normalized into the same classification shape so the Results screen is unchanged.
- **Corrections.** "This isn't right?" lets the user describe the item; Claude verifies the claim with a real web search before restructuring it, and shows up to 3 sources.
- **Closet, outfits, insights.** Saved items live in expo-sqlite. "Mark as worn today" logs a wear and shows cost-per-wear (saved price median divided by wears). My Outfits assembles named combinations of your own pieces by id, so an outfit always reflects the current closet. Insights aggregates total value, category and color breakdown, and a "haven't worn in 90+ days" list.
- **Settings.** Export the closet as JSON through the native share sheet, clear it, and watch provider quota bars.
- **Prefetching.** Pricing and outfit fetches start the instant classification resolves, before the Results screen mounts.
- **Engineering foundations.** ESLint 9 flat configs per workspace, Prettier at 120 columns, a husky pre-commit hook, Vitest on the pure logic (price math, resale heuristic, rate-limit counters, shared-secret auth), and a GitHub Actions workflow that typechecks, lints, format-checks and tests every push.
- **Eval harness.** An 81-image CC-licensed golden set, a runner with an optional pass-rate gate and per-run cost estimate, a log summarizer, and a script that promotes verified user corrections into the golden set. An early bug here is worth remembering: the grader assigned the array returned by `classifyImage` into a variable typed as a single result, so every eval graded 0 percent on every field, silently, until a live single-image run exposed it.

## Not built

Store submission (paid developer accounts on both sides) and app-side tests.
