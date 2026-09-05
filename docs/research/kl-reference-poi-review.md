# Reference-corridor POI research review

> Source of truth for `scripts/seed_kl_reference.ts`'s `REFERENCE_POIS` array. Every row must trace
> back to an entry here before it is added to the script. Read this alongside
> `Implementation_Plan.md` Task 1.1, which requires "40-50 hand-verified `poi_catalog` rows" for the
> KLCC / Bukit Bintang / Old Town-Melaka corridor.

## Status: 24 of the target 40-50 (a fourth entry -- The Daily Fix -- added 2026-09-05 to reduce the
Melaka demo trip's chance of landing only on Nancy's Kitchen's honestly-unknown halal status)

This batch prioritizes **verifiable accuracy over hitting the target count**. Each row below is
backed by a cited source checked on 2026-09-05. Expanding past 22 means repeating this same
per-venue research and review process — it does not mean relaxing the sourcing bar to hit a number
faster. Do not bulk-generate additional rows from general knowledge or plausible-sounding defaults.

**Region discipline:** the Implementation Plan names an exact triplet — KLCC, Bukit Bintang,
Old Town/Melaka. The second research pass initially turned up several well-documented KL
Chinatown venues (Petaling Street, Central Market/Pasar Seni, Sri Mahamariamman Temple) and a
Jalan Tanglin restaurant (Restoran Rebung) — all discarded from this seed despite being
individually well-sourced, because none of them sits in any of the three named regions. Being
well-documented is necessary but not sufficient; region fit is checked first.

## Methodology

- **Coordinates**: official venue sites, Wikipedia infobox coordinates, or the venue's own address
  cross-referenced with a mapping source. Never estimated by "this is roughly near X."
- **`halal_status`**: only set to `verified` when an official JAKIM Halal Malaysia Directory
  listing, the venue's own posted certificate, or a JAKIM social/press statement confirms it.
  `claimed` is reserved for a venue's own signage/marketing claim with no independent
  confirmation found. Anything else — including a plausible inference from cuisine type, a lack of
  visible warnings, or a secondary blog's unsupported claim — is `unknown`, per instruction:
  never infer safety from cuisine type, reviews, or absence of warnings.
- **`allergen_data_unknown`**: `true` unless a specific allergen disclosure was found for that
  venue. No row in this batch has verified allergen data — none claimed otherwise.
- **`dress_code`**: `modest` only where either an explicit source describes an enforced dress
  code, or the venue is a functioning place of worship matching the Implementation Plan's own
  named example ("modest attire for mosques and temples") — noted per-row where that's the basis
  rather than a venue-specific policy citation.
- Rows that are a street/mixed commercial strip (Jalan Alor, Jonker Street) rather than a single
  operator get `halal_status: unknown` — a street contains both halal and non-halal stalls, and
  labeling the whole street would misrepresent individual vendors.

## KLCC region

### Petronas Twin Towers
- Coordinates: 3.1578, 101.7117 (3°09'28"N 101°42'42"E)
- Height: 451.9 m; landmark_class: `prominent_structure`
- Not a food POI: halal_status `unknown` (not applicable), allergen_data_unknown `true`
- Source: [Petronas Towers — Wikipedia](https://en.wikipedia.org/wiki/Petronas_Towers), [official site](https://www.petronastwintowers.com.my/)

### KLCC Park
- Coordinates: 3.155647, 101.714997 (3°09'20"N 101°42'54"E)
- Outdoor public park, free, no landmark_class (not a structure)
- Source: [KLCC Park — Wikipedia](https://en.wikipedia.org/wiki/KLCC_Park)

### Aquaria KLCC
- Coordinates: 3.1533927, 101.713078 (3°09'12"N 101°42'47"E)
- Indoor aquarium attraction, Concourse Level, KL Convention Centre
- Source: [Aquaria KLCC — Wikipedia](https://en.wikipedia.org/wiki/Aquaria_KLCC), [official site](https://aquariaklcc.com/)

### Suria KLCC
- Address: Kuala Lumpur City Centre, 50088 KL (mall; precise standalone coordinates not
  separately published from the KLCC complex — used the KLCC Park coordinate as the shared
  complex location since Suria KLCC sits at the tower base within the same site)
- Source: [Suria KLCC — Wikipedia](https://en.wikipedia.org/wiki/Suria_KLCC)

### Avenue K
- Address: 156 Jalan Ampang, 50450 Kuala Lumpur (directly opposite the Petronas Twin Towers,
  linked to KLCC LRT station)
- Coordinates: 3.15955, 101.71344
- Source: [Avenue K official site](https://www.avenuek.com.my/getting-here/)

### Troika Sky Dining
- Address: Level 23A Tower B, The Troika, 19 Persiaran KLCC, 50450 Kuala Lumpur
- Coordinates: 3.15466, 101.71797 (3°09'17"N 101°43'05"E)
- halal_status: **`unknown`** — secondary sources describe staff "accommodating halal requests"
  and hosting occasional halal-themed dining events, which is not the same as JAKIM certification
  or the venue's own certified-halal declaration. Recorded as unknown rather than claimed, since
  even `claimed` implies the venue itself asserts halal status, which was not found.
- Source: [Troika Sky Dining official site](https://troikaskydining.com/), general review aggregation cross-checked

## Bukit Bintang region

### KL Tower (Menara Kuala Lumpur)
- Address: No. 2 Jalan Punchak, Off Jalan P. Ramlee, 50250 Kuala Lumpur
- Height: 421 m (antenna); landmark_class: `prominent_structure`
- Coordinates from the official ticketing/address source cross-referenced with Wikipedia's
  infobox: 3.1528, 101.7038
- Source: [KL Tower — Wikipedia](https://en.wikipedia.org/wiki/Kuala_Lumpur_Tower), [official site](https://kltower.com.my/)

### Pavilion Kuala Lumpur
- Address: 168 Jalan Bukit Bintang, 55100 Kuala Lumpur
- Coordinates: 3.149215, 101.713529 (3°08'57"N 101°42'49"E)
- Source: [Pavilion Kuala Lumpur — Wikipedia](https://en.wikipedia.org/wiki/Pavilion_Kuala_Lumpur)

### Jalan Alor (food street)
- Coordinates: 3.145872, 101.708909
- Mixed street-food strip, ~200 stalls/restaurants; halal_status `unknown` deliberately —
  contains both halal and non-halal operators, no single certification applies to the street
- Source: [Jalan Alor guide — Wonderful Malaysia](https://www.wonderfulmalaysia.com/food/jalan-alor-food-street.htm)

### OldTown White Coffee (Pavilion KL outlet)
- Address: Lot 1.30.00, Level 1, Pavilion Kuala Lumpur Shopping Mall, Jalan Bukit Bintang, 55100 KL
- Coordinates: same complex as Pavilion KL (3.149215, 101.713529) — no separate in-mall unit
  coordinate is published; using the mall's coordinate is the best available precision
- halal_status: `verified` — JAKIM Halal Malaysia Directory (SPHM), confirmed via JAKIM's own
  Halal Hub Facebook statement addressing a viral rumor, and independent press coverage
- Source: [JAKIM Halal Hub statement](https://www.facebook.com/HabHalalJakim/photos/a.744506395708636/1775823102576955/?type=3), [The Star, 2013](https://www.thestar.com.my/lifestyle/food/news/2013/07/11/cafe-chain-earns-halal-status-it-also-introduces-new-set-menu-called-mydulang), [outlet address](https://oldtown-white-coffee-pavilion-kl-kuala-lumpur-122498.baydimalaysia.com/)

### Fahrenheit 88
- Address: 179 Jalan Bukit Bintang, Kuala Lumpur (also listed as Jalan Gading)
- Coordinates: 3.1475, 101.7125 (3°08'51"N 101°42'45"E)
- Source: [Fahrenheit 88 — Wikipedia](https://en.wikipedia.org/wiki/Fahrenheit_88)

## Old Town / Melaka region

### A Famosa
- Coordinates: 2.1916167, 102.2503056 (2°11'29.82"N 102°15'1.10"E)
- UNESCO World Heritage core-zone fort ruin (2008 inscription); landmark_class:
  `architectural_typology`
- Source: [A Famosa — Wikipedia](https://en.wikipedia.org/wiki/A_Famosa)

### Christ Church Melaka
- Location: Jalan Gereja, Melaka (Dutch Square)
- dress_code: `none` — no enforced dress-code source found for this specific church; not
  assumed despite it being a place of worship, since the Implementation Plan's example names
  mosques and temples specifically and I found no citation of an enforced policy here
- Source: [Christ Church Melaka — Evendo](https://evendo.com/locations/malaysia/malacca/attraction/christ-church-melaka)

### Stadthuys
- Coordinates: 2.194059, 102.249154 (2°11'39"N 102°14'57"E), per Wikipedia infobox
- landmark_class: `architectural_typology`; oldest Dutch building in the East (1641-1660)
- Source: [Stadthuys — Wikipedia](https://en.wikipedia.org/wiki/Stadthuys)

### Cheng Hoon Teng Temple
- Address: 25 Jalan Tokong, Kampung Dua, 75200 Melaka
- Coordinates: 2.197472, 102.246861 (2°11'50.9"N 102°14'48.7"E)
- Oldest continuously operating Chinese temple in Malaysia (founded 1645)
- dress_code: `modest` — applied per the Implementation Plan's own named category ("modest
  attire for mosques and temples"); this is a functioning temple, not a per-venue policy citation
- Source: [Cheng Hoon Teng Temple — Wikipedia](https://en.wikipedia.org/wiki/Cheng_Hoon_Teng_Temple)

### Jonker Street (Jalan Hang Jebat)
- Coordinates: 2.195033, 102.248248
- Melaka's Chinatown heritage spine within the UNESCO core zone; mixed shops/eateries, so
  halal_status `unknown` deliberately (same reasoning as Jalan Alor)
- Source: [Jonker Street guide — The Smart Local](https://thesmartlocal.my/jonker-street-melaka/), general heritage-status coverage cross-checked against UNESCO core-zone descriptions

### Menara Taming Sari (Taming Sari Tower)
- Address: G-15, 1-15, 2-15, 3-15, Jalan PM2, Plaza Mahkota, 75000 Melaka
- Coordinates: 2.190833, 102.247111 (2°11'27.0"N 102°14'49.6"E)
- Revolving gyro tower observation deck; landmark_class: `prominent_structure` (though height not
  independently found — left `heightM: null` rather than estimating)
- Source: [Taming Sari Tower — Wikipedia](https://en.wikipedia.org/wiki/Taming_Sari_Tower), [official site](https://www.menaratamingsari.com/)

### St Paul's Church (ruins)
- Address: Saint Paul's Hill, Jalan Kota, Melaka
- Coordinates: 2.192616, 102.249585
- Roofless 1521 church ruin atop St Paul's Hill; landmark_class: `architectural_typology`; free,
  open 24 hours
- Source: [St Paul's Church — Travelfish](https://www.travelfish.org/sight_profile/malaysia/peninsular_malaysia/melaka/melaka/1549)

### Kampung Kling Mosque
- Address: Jalan Tukang Emas ("Harmony Street"), Melaka
- Coordinates: 2.19667, 102.24750 (2°11'48"N 102°14'51"E)
- Founded 1748, one of the oldest mosques on the Malay Peninsula, UNESCO core zone
- dress_code: `modest` — a functioning mosque, matching the Implementation Plan's own named
  category directly (this is the clearest-cut case of the three dress_code judgment calls in this
  batch, since "mosque" is explicitly named, not inferred)
- Source: [Kampung Kling Mosque — Wikipedia](https://en.wikipedia.org/wiki/Kampung_Kling_Mosque)

### Baba & Nyonya Heritage Museum
- Address: 48-50 Jalan Tun Tan Cheng Lock, Melaka
- Coordinates: 2.19528, 102.24667 (2°11'43"N 102°14'48"E)
- Peranakan heritage house-museum, established 1986; landmark_class: `architectural_typology`
- Source: [official site](https://www.babanyonyamuseum.com/), [Wikipedia](https://en.wikipedia.org/wiki/Baba_Nyonya_Heritage_Museum)

### Melaka Sultanate Palace Museum (Istana Kesultanan Melaka)
- Address: Kompleks Warisan Melaka, Jalan Kota, 75000 Melaka (foot of St Paul's Hill)
- Coordinates: 2.1929, 102.2504 (2°11'34"N 102°15'01"E)
- Reconstruction of the Malacca Sultanate-era palace, opened 1986; landmark_class:
  `architectural_typology`
- Source: [Melaka Sultanate Palace Museum — Wikipedia](https://en.wikipedia.org/wiki/Malacca_Sultanate_Palace_Museum)

### Nancy's Kitchen (Peranakan restaurant)
- Located mid-way along Jonker Street, Melaka (exact street-level coordinates not independently
  published beyond "Jonker Street, Melaka" — used the Jonker Street coordinate above as the best
  available precision for this entry)
- halal_status: **`unknown`**, not `no` — multiple travel-blog/aggregator sources describe it as
  a traditional pork-serving Peranakan restaurant and one aggregator (airial.travel) labels it
  "Non Halal," but none of this traces to an official halal-authority statement or the venue's
  own declaration. Per instruction not to infer status from cuisine type or secondary claims,
  this is recorded as unknown rather than confidently `no`, despite the circumstantial evidence
  pointing that way.
- Source: [Nancy's Kitchen review — The Ranting Panda](https://therantingpanda.com/2019/05/25/food-review-nancys-kitchen-restaurant-in-melaka-malaysia-one-of-the-most-popular-peranakan-restaurant-in-the-city/), [aggregator claim](https://www.airial.travel/restaurants/malaysia/melaka/nancys-kitchen-lMNO4jM3)

### Seri Nyonya Restaurant (Hotel Equatorial Melaka)
- Address: Level 3, Hotel Equatorial Melaka, Jalan Bandar Hilir, 75000 Melaka
- Coordinates: no independently published building-level coordinate found; approximated to the
  Stadthuys/Dutch Square cluster coordinate (2.194059, 102.249154) since multiple sources place
  the hotel within the same Bandar Hilir heritage block (~500m from A Famosa, a 6-minute walk from
  St Paul's Hill) -- same approximation approach used for Christ Church Melaka above
- halal_status: **`claimed`, not `verified`** — described as "Halal certified and pork-free" and
  "the only halal-certified Nyonya restaurant in Melaka" across multiple independent food-blog
  sources (Rebecca Saw, elanakhong.com, Burpple, holidify), consistent enough to be more than a
  single unsupported claim, but none of these is JAKIM's own directory or an official statement
  the way the OldTown White Coffee entry above has. Per this batch's own bar (`verified` requires
  an official JAKIM/venue-certificate source), this stays at `claimed` until one is found.
- Source: [Rebecca Saw — "Halal Nyonya food in Melaka"](https://rebeccasaw.com/halal-nyonya-food-in-melaka-seri-nyonya-hotel-equatorial-melaka/), [elanakhong.com](http://www.elanakhong.com/2016/05/authentic-nyonya-cuisines-seri-nyonya.html), [Burpple](https://www.burpple.com/seri-nyonya-restaurant-equatorial-hotel)
- **Unconfirmed lead, not used to upgrade this entry**: a 2018 Malay Mail report on Melaka Islamic
  Religious Department (JAIM) data states Equatorial Hotel was among the 34 hotel kitchens in
  Melaka with recognised halal certification, and a MyHalalXplorer post separately lists Hotel
  Equatorial Melaka under JAKIM-certified hotel restaurants. Both could arguably justify
  `verified`, but I could not directly fetch and quote either primary page (both returned HTTP 403
  / stripped content) -- only a search tool's own paraphrase of it, which is not a citable primary
  source under this batch's bar. Left at `claimed`; revisit if either page becomes fetchable, or an
  independent quote of the JAIM list is found.

### The Daily Fix (café)
- Address: 55, Jalan Hang Jebat (Jonker Street), 75200 Melaka -- inside the Next KK
  batik/souvenir shop
- Coordinates: 2.196307, 102.246768, per Wanderlog's place listing for this address
- Popular café (Tripadvisor: #7 of 732 Melaka restaurants at time of writing), known for pandan
  and gula melaka pancakes
- halal_status: **`claimed`, not `verified`** — independently described as a "halal-certified
  café" by multiple unofficial travel sources (SGMYTRIPS, Klook, Holidify, Rucksackinn,
  Tours-Malaysia) with no contradicting claim found, but none of these is JAKIM's own directory or
  an official statement. Recorded at the same bar as Seri Nyonya above, not upgraded to `verified`.
- Source: [SGMYTRIPS — "Top 12 Halal Food Stops in Melaka"](https://sgmytrips.com/halal-food-in-melaka/), [Klook — "10 Best Halal Restaurants In Melaka"](https://www.klook.com/en-MY/blog/halal-restaurants-melaka/), [Holidify — "Halal Food in Melaka"](https://www.holidify.com/pages/halal-food-in-melaka-4972.html)

### Discarded halal claims (Jonker Street area)
Two further Jonker Street venues were researched and explicitly **not** added despite initially
looking like good candidates, per this batch's own "never infer from cuisine type or an
unsupported secondary claim" rule:
- **Jonker 88**: widely called "Muslim-friendly"/"no pork" by casual travel blogs, but
  [Halalketak](https://halalketak.com/brands/jonker-88/) — a Malaysian halal-verification
  publisher that specifically checked JAKIM's e-Halal portal — found **no active or expired
  halal certificate** for this premise. This is direct evidence against the popular claim, not
  merely an absence of evidence; excluded entirely rather than added as `unknown`.
- **Cottage Spices Nyonya Restaurant**: sources directly contradict each other -- one describes
  it as merely "Muslim-friendly (no pork/alcohol, not officially certified)" while another claims
  "halal-certified ingredients." Contradictory unofficial claims do not clear the `claimed` bar
  (which requires corroboration, not dispute); excluded rather than guessed.

## Next steps to reach 40-50

Continue in the same per-venue pattern, staying strictly within KLCC / Bukit Bintang /
Old Town-Melaka: more Jalan Alor/Jonker Street single-operator stalls with their own halal
signage, more verified-halal chain outlets with a specific corridor branch address, and the
Melaka River Cruise (its jetty's address is known — Jalan Graha Maju Aras 9 / alternately
Jalan Tun Sri Lanang — but no source gave precise coordinates for either candidate jetty; add it
once a precise coordinate is found rather than guessing one). Research each with the same
sourcing bar, add an entry here, then add the corresponding row to
`scripts/seed_kl_reference.ts`.

Do not widen the region set to include well-documented but out-of-corridor KL areas (Chinatown/
Petaling Street, Lake Gardens/Jalan Tanglin, etc.) without first getting sign-off to add a fourth
region — see "Region discipline" above for what was already excluded this pass.
