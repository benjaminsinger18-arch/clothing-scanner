# Measuring classification accuracy

Claude's weights cannot be fine-tuned through the API, so accuracy work here means prompt and ensemble tuning, which first needs a way to measure whether a change helped. Three pieces of infrastructure exist for that.

## Golden eval set

`server/eval/golden/` holds 81 openly licensed photos from Wikimedia Commons (license and author per file in `ATTRIBUTIONS.md`) covering all 8 categories: tops, bottoms, outerwear, dresses, footwear, accessories, activewear and underwear-sleepwear. `labels.json` lists the expected fields for each. Its own `README.md` explains the entry format and how each field is graded.

These are clean product and museum photos, not the messy phone photos the app really sees. A good score here means "didn't obviously break," not "accurate on real usage." Add real phone photos alongside them over time.

## Running the eval

```bash
npm run eval --workspace=server
npm run eval --workspace=server -- --min-pass-rate=80
```

The runner calls the real classification pipeline on every entry (real Claude, Vision and Gemini calls, no mocking) and reports per-field pass rates plus an estimated dollar cost for the run, using the hand-maintained price table in `server/eval/pricing.ts`.

By default it is a report and exits 0. With `--min-pass-rate=<0-100>` it becomes a gate: exit 1 if passed field checks divided by total graded field checks falls below the threshold. A malformed value fails before any paid call.

It is deliberately not in CI. Each run costs real money, and the threshold should come from this set's measured baseline, not a guess.

## Logs the server keeps

Both files live in `server/data/` (gitignored). On Render's free tier they are wiped on every restart unless the `HF_BUCKET_*` variables are set, in which case they are restored from a Hugging Face bucket at startup and re-synced after every write (`server/src/lib/bucketSync.ts`).

- **`corrections.jsonl`**: every verified user correction, with the original classification, the user's text, the verified result and a photo thumbnail if the client sent one. A biased sample (only scans someone bothered to fix) but a good source of real misclassifications.
- **`classifications.jsonl`**: every successful `/classify` and `/barcode-lookup` result, without the photo. Unbiased. Each line records `latencyMs` and token usage across every Claude and Gemini call the scan made.

## Reading the logs

```bash
npm run summarize --workspace=server
```

Prints usage stats from the classification log: unrecognized rate, how often the Gemini rescue or the Vision brand fill fired, brand confidence distribution, latency by rescue path, and an estimated cost per path.

## Promoting corrections into the golden set

```bash
npm run promote-corrections --workspace=server            # dry run
npm run promote-corrections --workspace=server -- --apply
```

The dry run lists every promotable correction and flags which garment type and category combinations are new coverage. `--apply` copies the image into `golden/images/` and appends a `labels.json` entry. `golden/promoted-corrections.json` records what has been promoted so reruns do not duplicate. It is intentionally a two-step process: a correction's photo is a real person's phone photo, worth a look before it is committed. Only the compressed thumbnail is available, so promoted images are lower resolution than the rest of the set.
