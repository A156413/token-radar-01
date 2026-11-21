# Token Launch Radar

A make.fun **token-radar-01** entry: a ranked board of the protocols that record no token yet,
valued by what a token would be worth if each protocol's record stayed as it is, each with a
concrete farm plan — plus a dashboard a reader can actually use.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+, standard library only, no install, no network. The program reads the sealed snapshot,
writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/` into the output, and writes
`dossier.json` last with the vendored library (`vendor/makefun-board.ts`). It is deterministic:
the same snapshot in, the same bytes out.

## The model (`lib/model.ts`, version `peer-multiple-2`)

Nothing is looked up and no name is special-cased. Four factors, all from the snapshot:

1. **Category multiple** — protocols whose token already trades reveal what the market pays per
   dollar of TVL (`mcap_usd / tvl_usd`, winsorised to [0.02, 3]). Each category's multiple is the
   median of its peers' ratios, shrunk toward the market-wide median by peer count:
   `(n × median + 5 × global) / (n + 5)`. On this snapshot: 128 peers, global median ≈ 0.21×.
2. **Momentum** — the 7-day TVL change, clamped to [−30%, +50%], carried at 1.2 weight
   (0.64× … 1.60×).
3. **Track record** — years run with no token: 0.78× for a new listing rising to 1.22× at four
   years; an unrecorded listing date counts as the neutral 730 days (1.00×).
4. **Breadth** — +3% per extra chain, up to seven (1.21×).

`implied_value_usd = TVL × multiple × momentum × track record × breadth`.

The board holds **214 rows**: all 40 watchlist slugs (the floor), plus the 174 highest-valued
further pre-token protocols under the watchlist's own exclusions — no exchanges, no bridges or
restaked wrappers of tokens that already trade, no versioned pools; small independent staking
products below the floor are admitted because they do launch tokens. The 30 largest live-token
protocols are shown separately at the market's own values, never ranked.

Farm plans are generated per protocol from its own record: the category's core action, capital
scaled to its TVL ($50–$500), fees from its first chain, a weekly qualifying action, a hold scaled
to its age (30–60 days), and a momentum note from its 7-day change.

## The dashboard (`dashboard/`)

A hand-built dark console (no framework, no network): a sortable, filterable board (search,
category, chain, size, watchlist-only), a per-protocol detail drawer showing the model's full
arithmetic and the farm plan, an "Already trading" view, and a "How the ranking works" view that
states the model and prints the peer-evidence table behind every category multiple. It renders
from `data.js`, which `main.ts` writes from the same board as `board.json`, so page and board
always agree. Deep links: `#detail=<slug>`, `#cat=<category>`, `#chain=<chain>`, `#q=<text>`,
`#wl=1`, `#tab=live|method`.

## Screenshots

`screenshots/` holds the board, a protocol detail view and a filtered view, rendered from the
real dashboard and its real data at 1440×950.

## Layout

- `main.ts` — the entry program
- `lib/model.ts` — snapshot parsing, the valuation model, farm plans, board validation
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — the three judged views
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored unmodified
- `LICENSE` — MIT
