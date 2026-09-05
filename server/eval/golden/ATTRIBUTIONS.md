# Image attributions

All photos in `images/` are from [Wikimedia Commons](https://commons.wikimedia.org), openly
licensed, downloaded via the Commons API with license metadata verified per-file at download time.
CC BY / CC BY-SA licenses require attribution — listed below. Public domain / CC0 files don't
legally require it but are credited anyway for traceability back to source.

These are stock/museum/personal photos, not photos of your own scanned items — see the note in
`README.md` about why they're a supplement to real phone photos, not a replacement.

Downloaded originals were resized/recompressed to match the app's own upload profile (max 1280px on
the long edge, JPEG quality 85 — see `app/lib/compressImage.ts`) rather than kept at their original
resolution, so the eval measures accuracy against roughly what the classifier actually receives in
production, not artificially higher-detail input. This also cut the set from ~26MB to ~2.6MB.

| Local file | Commons title | License | Author | Source |
|---|---|---|---|---|
| aclu-constitution-tee.jpg | ACLU Constitution Tee, 2016.jpg | CC BY-SA 4.0 | JackGavin | [link](https://commons.wikimedia.org/wiki/File:ACLU_Constitution_Tee,_2016.jpg) |
| damien-hirst-butterfly-hoodie.jpg | 2008 Butterfly Hoodie by Damien Hirst for Adrian Nyman 01.jpg | CC0 | Staff photographer, Rhode Island School of Design Museum of Art | [link](https://commons.wikimedia.org/wiki/File:2008_Butterfly_Hoodie_by_Damien_Hirst_for_Adrian_Nyman_01.jpg) |
| win-patterned-sweater.jpg | "WIN" patterned sweater.JPG | Public domain | (uncredited on file page) | [link](https://commons.wikimedia.org/wiki/File:%22WIN%22_patterned_sweater.JPG) |
| dickies-carpenter-jeans.jpg | Brown Dickies Carpenter Jeans New.jpg | CC BY-SA 4.0 | Clothingphotoguy | [link](https://commons.wikimedia.org/wiki/File:Brown_Dickies_Carpenter_Jeans_New.jpg) |
| levis-501xx-jeans-front.jpg | 501xx-front.jpg | CC BY-SA 4.0 | Tokunori | [link](https://commons.wikimedia.org/wiki/File:501xx-front.jpg) |
| plaid-shorts.jpg | Brown, Orange, Plaid (3167711031).jpg | CC BY-SA 2.0 | Marcus Quigmire from Florida, USA | [link](https://commons.wikimedia.org/wiki/File:Brown,_Orange,_Plaid_(3167711031).jpg) |
| blue-tailored-jacket.jpg | Blue tailored jacket.jpg | CC BY-SA 4.0 | サフィル | [link](https://commons.wikimedia.org/wiki/File:Blue_tailored_jacket.jpg) |
| blue-denim-jacket.jpg | Blauw denim jasje, objectnr 68398.JPG | CC BY-SA 3.0 | Philo Wagner (?) | [link](https://commons.wikimedia.org/wiki/File:Blauw_denim_jasje,_objectnr_68398.JPG) |
| bomber-jacket.jpg | Bomber jacket.jpg | Public domain | (uncredited on file page) | [link](https://commons.wikimedia.org/wiki/File:Bomber_jacket.jpg) |
| ankara-print-dress.jpg | A BEAUTIFUL Ankara dress.jpg | CC BY-SA 4.0 | ItunuIjila | [link](https://commons.wikimedia.org/wiki/File:A_BEAUTIFUL_Ankara_dress.jpg) |

## Still missing (blocked by Wikimedia rate limiting, not yet retried)

These categories have no golden entry yet — footwear, most accessories, activewear, and
underwear/sleepwear are underrepresented as a result:

- Sneakers, boots, sandals (footwear)
- Baseball cap, scarf, belt, backpack (accessories)
- Tracksuit top/bottoms (activewear)
- Bathrobe (underwear-sleepwear)

Candidate URLs + license metadata for all of these were already found and are safe to re-fetch —
see the "Adding an entry" section in `README.md` if picking this back up, or ask for the download to
be retried once Wikimedia's rate limit has cooled off.
