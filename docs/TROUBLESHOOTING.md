# Troubleshooting

- **"Could not reach the backend."** Confirm the server is running, the phone and computer are on the same network, and `EXPO_API_URL` in `app/.env` uses the LAN IP, not `localhost`. Restart `expo start` after editing `.env`.
- **Plain-text "Not Found" from the deployed Render backend.** A free-tier quirk around cold starts (`x-render-routing: no-server` in the response headers). It resolves on retry within a second or two. If it persists, check the Render dashboard for a deploy or crash error.
- **First request after a lull is slow.** Free-tier Render services spin down after about 15 minutes idle. Hit `/health` to warm it.
- **`classification_failed` or 502 from `/classify`.** Check that `server/.env` has a valid `ANTHROPIC_API_KEY`, then read the server console for the underlying error.
- **401 `unauthorized`.** `EXPO_APP_SHARED_SECRET` in `app/.env` does not match the server's `APP_SHARED_SECRET`. Set both to the same value and restart `expo start`.
- **"Couldn't identify a clothing item."** Expected for non-clothing or unclear photos. Retake with a single garment filling most of the frame in good light.
- **No estimated retail price.** SerpApi found nothing for that item. Common for older or discontinued pieces, or when `SERPAPI_KEY` is not set.
- **Reviews tab is empty or sparse.** Possible for a niche item even with the 40-result pool, since not every Google Shopping listing carries a rating. If it happens on common items, check the server console for SerpApi errors.
- **Barcode scan says "no product found."** General UPC databases cover clothing thinly; many private-label items were never registered. Use "Take Photo Instead."
- **Provider quota.** `GET /usage` (or the Settings screen in the app) shows how close each provider is to its cap. Counters are per process and reset on server restart.
