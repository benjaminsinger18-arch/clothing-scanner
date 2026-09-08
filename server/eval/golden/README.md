# Golden eval set

Seeded with 60 openly-licensed stock photos from Wikimedia Commons (see `ATTRIBUTIONS.md` for
license/author per file) spanning all 8 categories (tops, bottoms, outerwear, dresses, footwear,
accessories, activewear, underwear-sleepwear). **These are a supplement, not a replacement for real
phone photos** — they're clean/museum/product-style photography, not the messy real-world phone
photos (odd lighting, wrinkled fabric, cluttered backgrounds) the app actually has to handle. Treat
a good score against this set as "didn't obviously break," not "definitely accurate on your real
usage" — add your own real photos alongside these over time.

## Adding an entry

1. Drop a real clothing photo into `images/` (jpg, ~any resolution — no need to match the app's
   own 1280px compression, since the point here is measuring model behavior on realistic input).
2. Add an object to `labels.json`:
   ```json
   {
     "filename": "navy-tshirt-01.jpg",
     "expected": {
       "garmentType": "t-shirt",
       "category": "tops",
       "color": "navy",
       "pattern": "solid",
       "gender": "unisex",
       "brandGuess": null
     }
   }
   ```

`expected` fields, and how `runEval.ts` grades each:
- `category`, `gender` — exact match (both are enums).
- `garmentType`, `color`, `pattern` — case-insensitive substring match in either direction (e.g.
  expected `"t-shirt"` passes against actual `"cotton t-shirt"`). Generous on purpose — mismatches
  still print in full for you to judge.
- `brandGuess` — `null` on both sides passes; one `null` and one string fails; two strings use the
  same substring rule as above.
- `style` — omit it. It's too subjective to grade as pass/fail.
- `brandConfidence` — omit it. It's never graded pass/fail; instead `runEval.ts` prints a separate
  "brand confidence calibration" section so you can eyeball whether confidence looks reasonable.

Any `expected` field you leave out simply isn't graded for that item — useful when you're only
confident about some of what's in a photo.

## Cost note

Every eval run makes real Claude Sonnet 5 calls (plus Vision/Gemini if those keys are configured)
against every entry here — there's no mocking, since the whole point is measuring real model
behavior. This set has grown well past the original "roughly 15-30 photos" cost guidance (60 as of
this writing, across nine expansion rounds) — a full run costs proportionally more than it used to;
if that starts to matter, run against a subset rather than shrinking the set back down.

Grow it over time as you curate more. The best source: real corrections logged via the "Suggest a
fix" flow (`server/data/corrections.jsonl` — see that file's own doc comment in
`server/src/lib/correctionLog.ts`), where a scan actually got something wrong. Run
`npm run promote-corrections --workspace=server` to review what's promotable (dry run by default —
see that script's own header comment) and `-- --apply` to actually add entries. Give each promoted
entry its own `ATTRIBUTIONS.md` row same as everything else, noting the source as "user correction"
(no license/attribution needed, but worth flagging that it isn't a Wikimedia Commons photo like the
rest of the set) — and note that these are lower-resolution than the rest of the set (see the
script's own comment for why).
