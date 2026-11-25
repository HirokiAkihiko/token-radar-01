# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/HirokiAkihiko/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/HirokiAkihiko/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for the make.fun bounty `token-radar-01`
("Build the best token launch radar"). It reads the sealed DefiLlama
snapshot, ranks pre-token protocols by the launch value the model below
implies for them, and renders a static, offline dashboard a farmer can
actually use: the ranked board, a detail view per protocol with its full
valuation breakdown and farm plan, filters (search, category, chain,
confidence), a live-token peer view, and the methodology with the exact
multiples the model learned.

## Run it

Node 22, standard library only, nothing to install:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

In the grader's container the snapshot is at `/input/snapshot.json` and
the output goes to `/output`. The program writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` (built with
`buildDossier` from `vendor/makefun-board.ts`, included byte for byte as
the bounty requires).

## The model (radar-2): peer multiples, not a flat guess

The starter-style approach — one flat multiple of TVL for everything —
ignores the best evidence inside the snapshot itself: the protocols that
already trade. This model learns from them.

1. **Category multiple.** For every category, take the traded protocols
   in the snapshot and compute the median of `mcap_usd / tvl_usd`. That
   median is what the market demonstrably pays per dollar of TVL in that
   category (in this snapshot: Dexs ≈ 0.34x raw, Lending ≈ 0.13x,
   RWA ≈ 0.27x, market-wide ≈ 0.21x). Categories with few peers are
   shrunk toward the market-wide median with weight
   `peers / (peers + 8)` (a single traded peer moves the multiple only
   slightly), the raw median is winsorised to [0.02, 1.50] first so one
   extreme peer cannot price a whole category, and every multiple is
   capped to [0.03, 1.00]
   so one outlier category cannot dominate the board.
2. **Momentum.** `1 + clamp(change_7d, -50, 100)/100 × 0.6` — a protocol
   gaining TVL is worth more than the same TVL shrinking, but one hot
   week never more than ±60%.
3. **Maturity.** `0.65 + min(age_days, 1095)/1095 × 0.5` — a protocol
   that has run for years with no token is a more credible launch
   candidate than a two-week-old one. Unknown listing age counts as
   365 days.
4. **Breadth.** `1 + 0.04 × log2(chains)`, capped at 1.16 — distribution
   across chains is worth a small premium, never a decisive one.

`implied = TVL × category multiple × momentum × maturity × breadth`,
rounded to whole dollars. Every row also carries a **confidence** score
(0–100: peer depth, known age, absolute TVL, chain breadth) with a
High / Medium / Early tier, kept separate from value so thin-evidence
finds are labelled, not hidden. A category priced by fewer than three
traded peers is capped at 64 (Medium at best) however large the protocol
is — one peer's price is a hint, not evidence.

The board covers **all 40 watchlist protocols** (the floor: TVL ≥ $50M,
records no token, not a wrapped/staked/bridged product of a traded
protocol) plus **180 early finds** below the floor chosen by TVL from
rankable pre-token protocols — 220 rows in total for this snapshot.
Protocols that already trade are never ranked; the dashboard shows the
top 24 of them separately as the peer evidence.

Worked example (this snapshot): Steakhouse Financial (Risk Curators,
TVL $2.75B) is valued with its category's shrunk peer multiple and a
near-maximum maturity adjustment; a young, fast-growing Dex below the
floor can outrank a larger but shrinking curator because momentum and
the Dex category multiple both work in its favour. The detail view of
every row shows its own four factors, and the dashboard recomputes each
row in the page and checks it against `board.json`.

## Farm plans

Every board row carries a 7-step farm plan derived from that protocol's
own record — category decides the core action (supply/borrow for
lending, liquidity for Dexs, staking receipts for staking, vault shares
for curators/allocators, onboarding + mint for RWA, and so on), TVL
decides the capital tier ($50–$250), age decides the hold window
(30–60 days). Each plan includes the category's specific risk step
(liquidation buffer, impermanent loss, bridge verification, unbonding,
redemption lockups), the anti-phishing claim rule (only through the
protocol's official channels, never pay a claim fee), and a farm
journal step. The detail view adds a short "after a launch" note.

## Honesty notes

- The snapshot says a protocol *records* no token; it is not proof it
  has none. The dashboard uses that wording throughout.
- Implied value is this entry's model claim about what a launch could
  be worth if the protocol's record stayed as it is. It does not
  predict whether or when a token launches.
- All figures come from the sealed snapshot; the dashboard makes no
  network requests and works fully offline.

## Layout

- `main.ts` — entry point (Node 22): snapshot → board + dashboard data
  + copies + dossier.
- `lib/model.ts` — the valuation model, board builder, farm plans,
  snapshot parser and board self-check.
- `vendor/makefun-board.ts` — make.fun's dossier library, verbatim.
- `dashboard/` — static page (`index.html`, `app.css`, `app.js`).
- `screenshots/` — board, one protocol detail, one filtered view.
