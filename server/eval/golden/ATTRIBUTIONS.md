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
| skechers-sneakers.jpg | Skechers Energy 2 - Cruise Control.jpg | CC BY-SA 4.0 | RBCt11 | [link](https://commons.wikimedia.org/wiki/File:Skechers_Energy_2_-_Cruise_Control.jpg) |
| chelsea-boots.jpg | 78 chelsea boots.jpg | CC BY 4.0 | Free open sources aholaS | [link](https://commons.wikimedia.org/wiki/File:78_chelsea_boots.jpg) |
| teva-sandal.jpg | A Teva sandal in the street.jpg | CC BY-SA 4.0 | Peachyeung316 | [link](https://commons.wikimedia.org/wiki/File:A_Teva_sandal_in_the_street.jpg) |
| baseball-cap.jpg | Advanced Computer Techniques baseball cap.jpg | CC BY-SA 4.0 | Jonathan Schilling | [link](https://commons.wikimedia.org/wiki/File:Advanced_Computer_Techniques_baseball_cap.jpg) |
| cashmere-scarf.jpg | 100% Kaschmir Wool Schal Beispiel.jpg | CC BY-SA 4.0 | kaschmirprodukte.de | [link](https://commons.wikimedia.org/wiki/File:100%25_Kaschmir_Wool_Schal_Beispiel.jpg) |
| leather-belt.jpg | Belt individual equipment ALICE.jpg | CC BY 3.0 | Tupek | [link](https://commons.wikimedia.org/wiki/File:Belt_individual_equipment_ALICE.jpg) |
| eastpak-backpack.jpg | Eastpak Sugarbush backpack black.jpg | CC BY-SA 4.0 | Ubcule | [link](https://commons.wikimedia.org/wiki/File:Eastpak_Sugarbush_backpack_black.jpg) |
| tracksuit-bottoms.jpg | Tracksuit bottoms.jpg | CC BY 3.0 | RyanDiller | [link](https://commons.wikimedia.org/wiki/File:Tracksuit_bottoms.jpg) |
| tracksuit-jacket.jpg | Tracksuit jacket.jpg | CC BY 3.0 | RyanDiller | [link](https://commons.wikimedia.org/wiki/File:Tracksuit_jacket.jpg) |
| bathrobe.jpg | BathrobeHungup.jpg | CC BY-SA 3.0 | GlassCobra | [link](https://commons.wikimedia.org/wiki/File:BathrobeHungup.jpg) |

## Notes on this batch

Two originally-selected candidates (`Belt (clothing).jpg` and the original `Bathrobe.jpg`) turned
out, on inspection, to be hand-drawn ink illustrations rather than real photos — wrong fit for a
photo-classification eval set, so they were swapped for `Belt_individual_equipment_ALICE.jpg` (a
real photo of a military web belt) and `BathrobeHungup.jpg` respectively. Always view a candidate
before trusting its filename/title.

All 8 categories (tops, bottoms, outerwear, dresses, footwear, accessories, activewear,
underwear-sleepwear) now have at least one entry — the previous "still missing" gap is closed.
