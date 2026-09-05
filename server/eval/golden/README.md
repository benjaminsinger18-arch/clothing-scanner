# Golden eval set

Seeded with 10 openly-licensed stock photos from Wikimedia Commons (see `ATTRIBUTIONS.md` for
license/author per file) spanning tops, bottoms, outerwear, and dresses. **These are a supplement,
not a replacement for real phone photos** — they're clean/museum/product-style photography, not the
messy real-world phone photos (odd lighting, wrinkled fabric, cluttered backgrounds) the app actually
has to handle. Treat a good score against this set as "didn't obviously break," not "definitely
accurate on your real usage" — add your own real photos alongside these over time.

Footwear, most accessories, activewear, and underwear/sleepwear have no entries yet (Wikimedia
rate-limited the download partway through) — see `ATTRIBUTIONS.md`'s "still missing" section.

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
behavior. Keep this set to roughly 15-30 photos so a run stays cheap and fast; grow it over time as
you curate more (a good source: photos from `server/data/corrections.jsonl` where a scan actually
got something wrong — see that file's own doc comment in `server/src/lib/correctionLog.ts`).
