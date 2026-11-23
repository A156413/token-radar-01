// Token Launch Radar — the valuation model and board builder.
//
// The snapshot is the only input: 758 protocols with TVL, a seven-day TVL change, a listing date,
// chains, a category, and — for protocols whose token already trades — a market cap. The board ranks
// the protocols that record no token by what a token would be worth if the protocol's record stayed
// as it is. Nothing is looked up and no protocol name is special-cased: every figure below is derived
// from the snapshot's own rows, in four steps.
//
//   1. Peer multiple. Protocols whose token trades reveal what the market pays per dollar of TVL:
//      ratio = mcap_usd / tvl_usd, winsorised to [0.02, 3] so one broken print cannot steer a
//      category. Each category's multiple is the median of its own peers' ratios, shrunk toward the
//      market-wide median by the peer count (multiple = (n x median + 5 x global) / (n + 5)), so a
//      category with two peers borrows strength from the market and one with forty stands alone.
//      A category with no trading peer uses the market-wide median.
//   2. Momentum. growth = clamp(change_7d, -30, +50) per cent (unreported counts as 0);
//      growth_multiplier = 1 + growth / 100 x 1.2, so a protocol shrinking 30% in a week is marked
//      to 0.64 of its peer value and one growing 50% to 1.60.
//   3. Track record. A protocol that has held TVL for years with no token is a different claim from
//      one listed last month: maturity_multiplier = 0.78 + 0.44 x min(age_days, 1460) / 1460, from
//      0.78 for a brand-new listing to 1.22 at four years. An unrecorded listing date counts as
//      730 days, the neutral middle (multiplier 1.00).
//   4. Breadth. Each chain past the first is distribution a token launch can reach:
//      breadth_multiplier = 1 + 0.03 x min(chains - 1, 7), up to 1.21.
//
//   implied_value_usd = round(tvl_usd x category_multiple x growth x maturity x breadth), at least $1.
//
//   5. The range. A point value hides how far apart the peers are, so each row also carries the
//      value at its category's shrunk peer quartiles (the 25th and 75th percentile ratios, shrunk
//      toward the market-wide quartiles exactly as the median is shrunk): value_low_usd and
//      value_high_usd. A category whose peers agree has a narrow range; one whose peers scatter
//      shows it, and the reader can see which rows rest on solid evidence and which on a guess.
//
// The board is the snapshot's watchlist (the floor: every slug, whatever the model says) plus the
// highest-valued further pre-token protocols under the watchlist's own exclusions — no exchanges, no
// bridges or restaked wrappers of a token that already trades, no versioned pools; small independent
// staking products below the floor are admitted, since they do launch tokens, where the giants above
// it are exchange wrappers — so the radar also covers the smaller launches it exists to find early.
// Protocols whose token already trades are kept apart in a live set with the market's own values,
// never mixed into the ranked board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label, stated in the dashboard so a reader can cite the model that ranked a row. */
export const MODEL_VERSION = 'peer-multiple-3';

/** Total rows on the board: the 40 watchlist slugs plus the best further pre-token protocols. */
export const BOARD_ROWS = 250;

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 30;

/** Winsor bounds for a peer's market-cap-to-TVL ratio, and the shrinkage weight toward the global median. */
export const RATIO_FLOOR = 0.02;
export const RATIO_CAP = 3;
export const SHRINK_PEERS = 5;

/** Momentum: the clamp on the seven-day change, and how much of it the multiple carries. */
export const GROWTH_FLOOR = -30;
export const GROWTH_CAP = 50;
export const GROWTH_WEIGHT = 1.2;

/** Track record: the maturity multiplier's floor, its span, and the age it tops out at. */
export const MATURITY_FLOOR = 0.78;
export const MATURITY_SPAN = 0.44;
export const MATURITY_DAYS = 1460;
export const UNKNOWN_AGE_DAYS = 730;

/** Breadth: the premium per extra chain, and how many extra chains count. */
export const CHAIN_STEP = 0.03;
export const CHAIN_MAX_EXTRA = 7;

/** One category's peer evidence: how many trading peers, their median ratio, the multiple in use. */
export interface CategoryStat {
  category: string;
  peers: number;
  median_ratio: number;
  multiple: number;
  /** The peer ratios' quartiles, shrunk the same way as the median: the spread of the evidence. */
  q1_ratio: number;
  q3_ratio: number;
  multiple_low: number;
  multiple_high: number;
}

/** The model's market-wide figures, computed from the snapshot's trading protocols. */
export interface MarketStats {
  global_median: number;
  peer_count: number;
  categories: CategoryStat[];
}

/** One row of board.json: the ranked board's row, with the model's own arithmetic kept beside it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  implied_tvl_ratio: number;
  model: {
    category_multiple: number;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
    /** The implied value at the category's shrunk peer quartiles: the range the evidence supports. */
    value_low_usd: number;
    value_high_usd: number;
  };
  farm_steps: string[];
  /** The farm plan's totals, from the same figures its steps carry: capital, fees, hold, weekly time. */
  farm_summary: {
    capital_usd: number;
    fees_usd: number;
    hold_days: number;
    minutes_per_week: number;
  };
}

/** The dashboard's view of one board row: the row itself, farm plan included, so page and board agree. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol: it already trades, so the dashboard shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
  symbol: string | null;
}

/** Everything the dashboard needs: the board, the live set, the peer evidence and the model text. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  protocol_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  pre_token_size: number;
  market: MarketStats;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A quantile of a non-empty list, by linear interpolation on the sorted values (the type-7 rule). */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base]! : sorted[base]! + rest * (next - sorted[base]!);
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The market's own evidence: every trading protocol's winsorised market-cap-to-TVL ratio, the global
 * median, and each category's shrunk multiple. Deterministic: peers are read in snapshot order and
 * every median sorts its values first.
 */
export function marketStats(snapshot: Snapshot): MarketStats {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, RATIO_FLOOR, RATIO_CAP);
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.25;
  const globalQ1 = all.length > 0 ? quantile(all, 0.25) : globalMedian;
  const globalQ3 = all.length > 0 ? quantile(all, 0.75) : globalMedian;
  const shrink = (n: number, value: number, global: number): number =>
    (n * value + SHRINK_PEERS * global) / (n + SHRINK_PEERS);
  const categories: CategoryStat[] = [...ratiosByCategory.entries()]
    .map(([category, ratios]) => {
      const med = median(ratios);
      return {
        category,
        peers: ratios.length,
        median_ratio: round4(med),
        multiple: round4(shrink(ratios.length, med, globalMedian)),
        q1_ratio: round4(quantile(ratios, 0.25)),
        q3_ratio: round4(quantile(ratios, 0.75)),
        multiple_low: round4(shrink(ratios.length, quantile(ratios, 0.25), globalQ1)),
        multiple_high: round4(shrink(ratios.length, quantile(ratios, 0.75), globalQ3)),
      };
    })
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  return { global_median: round4(globalMedian), peer_count: all.length, categories };
}

/** The multiples one category trades at under the model; the global figures when it has no peers. */
function multipleFor(stats: MarketStats, category: string | null): { multiple: number; low: number; high: number; peers: number } {
  const key = category ?? 'Uncategorised';
  const stat = stats.categories.find((c) => c.category === key);
  return stat === undefined
    ? { multiple: stats.global_median, low: stats.global_median, high: stats.global_median, peers: 0 }
    : { multiple: stat.multiple, low: stat.multiple_low, high: stat.multiple_high, peers: stat.peers };
}

/** The four factors and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  stats: MarketStats,
): { implied: number; low: number; high: number; multiple: number; peers: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, low, high, peers } = multipleFor(stats, protocol.category);
  const growthPct = clamp(protocol.change_7d ?? 0, GROWTH_FLOOR, GROWTH_CAP);
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturityMult = MATURITY_FLOOR + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_SPAN;
  const breadthMult = 1 + CHAIN_STEP * Math.min(Math.max(protocol.chains.length - 1, 0), CHAIN_MAX_EXTRA);
  const rest = growthMult * maturityMult * breadthMult;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * rest));
  return {
    implied,
    low: Math.max(1, Math.round(protocol.tvl_usd * low * rest)),
    high: Math.max(1, Math.round(protocol.tvl_usd * high * rest)),
    multiple, peers, growthPct, growthMult, maturityMult, breadthMult, age,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Names that begin with an exchange's name are that exchange's own product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories kept off the board at every size: bridges and restaked wrappers of tokens that already trade, and exchanges. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Restaked BTC', 'CEX']);
/**
 * Staking categories the watchlist's rule excludes at its floor: above the floor their pre-token
 * members are exchange wrappers, but below it they are small independent staking products, the kind
 * that do launch tokens, so the early board admits them there.
 */
const FLOOR_EXCLUDED_CATEGORIES = new Set(['Liquid Staking', 'Liquid Restaking']);

/**
 * Whether a pre-token protocol may be ranked: the watchlist's exclusions applied by size, so the
 * early board holds launches, not wrappers of tokens that already trade.
 */
export function isRankable(p: SnapshotProtocol, floorUsd: number): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (p.category !== null && FLOOR_EXCLUDED_CATEGORIES.has(p.category) && p.tvl_usd >= floorUsd) return false;
  return !VERSIONED.test(p.name) && !WRAPPED_WORD.test(p.name) && !EXCHANGE_PREFIX.test(p.name);
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const stats = marketStats(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is ranked, whatever its figures.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: the best of the remaining rankable pre-token protocols, by implied value.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p, snapshot.floor_usd))
    .map((p) => ({ p, implied: impliedValue(p, snapshot.as_of, stats).implied }))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, Math.max(0, BOARD_ROWS - chosen.size));
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, stats) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlist = new Set(snapshot.watchlist);
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    implied_tvl_ratio: round3(s.v.implied / Math.max(1, s.p.tvl_usd)),
    model: {
      category_multiple: s.v.multiple,
      category_peers: s.v.peers,
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
      value_low_usd: s.v.low,
      value_high_usd: s.v.high,
    },
    farm_steps: farmSteps(s.p, s.v.age),
    farm_summary: farmSummary(s.p, s.v.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in the plain terms a farmer budgets with. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $8 in ETH gas on mainnet';
  if (c === 'bitcoin') return 'about $3 in BTC network fees';
  if (c === 'solana') return 'under $0.10 in SOL fees';
  if (c === 'tron') return 'about $1 in TRX fees';
  if (c === 'algorand') return 'under $0.10 in ALGO fees';
  return 'about $0.50 in gas on a low-fee chain';
}

/** One transaction's cost in whole dollars on a chain, for the weekly-cost arithmetic. */
function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8;
  if (c === 'bitcoin') return 3;
  if (c === 'solana' || c === 'algorand') return 0.1;
  if (c === 'tron') return 1;
  return 0.5;
}

/** How much capital one farm position needs, scaled to the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 500;
  if (p.tvl_usd >= 500_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 35;
  return 30;
}

/** The category's core position: the one action that makes a wallet a real user of the protocol. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('curator'))
    return `Deposit $${capital} of USDC into one of ${n}'s curated vaults on ${chain}; pick the vault with the longest track record, not the highest advertised yield`;
  if (c.includes('lend') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow about 30% against it and re-supply the borrow so both sides of the market see the wallet`;
  if (c.includes('cdp') || c.includes('stable'))
    return `Deposit $${capital} of collateral into ${n} on ${chain} and mint about 40% of its value in the protocol's stablecoin, keeping the health factor above 2`;
  if (c.includes('dex') || c.includes('liquidity'))
    return `Add $${capital} of liquidity to ${n}'s deepest USDC pair on ${chain} and make two small swaps through the same pool so the wallet both provides and trades`;
  if (c.includes('derivative') || c.includes('perpetual'))
    return `Deposit $${capital} of USDC margin on ${n} and open one small hedged position (long spot, short perp of the same size) so the account trades without directional risk`;
  if (c.includes('basis'))
    return `Deposit $${capital} of USDC into ${n}'s basis vault on ${chain}; the vault runs the hedge, and the deposit itself is the qualifying position`;
  if (c.includes('rwa'))
    return `Complete ${n}'s onboarding on ${chain} and mint $${capital} of its tokenised asset; where KYC is required, finish it once, it is part of the position`;
  if (c.includes('restak') || c.includes('staking'))
    return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the receipt token in the same wallet for the whole hold`;
  if (c.includes('yield'))
    return `Deposit $${capital} of USDC into ${n}'s main vault on ${chain} and leave auto-compounding on so the share balance grows on its own`;
  if (c.includes('bridge') || c.includes('cross chain'))
    return `Bridge $${capital} of USDC to ${chain} through ${n}, then bridge a smaller amount back a week later so both directions are on record`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${n} and take one position in its most liquid market, then let it settle rather than closing early`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy to expiry`;
  if (c.includes('payment'))
    return `Route $${capital} of real payments or transfers through ${n} on ${chain} over the hold, in at least four separate transactions`;
  if (c.includes('chain'))
    return `Bridge $${capital} of USDC to ${chain} and use two of its native apps through ${n}'s ecosystem, keeping a small gas balance on the chain`;
  if (c.includes('launchpad'))
    return `Register the wallet on ${n} and take part in one sale or staking round with $${capital}, keeping the allocation in the wallet`;
  if (c.includes('privacy'))
    return `Move $${capital} through ${n}'s shielded pool on ${chain} in two deposits a week apart, and keep the notes until the hold ends`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its main app and keep the position open for the whole hold`;
}

/** The weekly qualifying action for the category, small enough to repeat for the whole hold. */
function weeklyFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('collateral')) return `adjust the ${n} position once: repay a slice of the borrow and draw it again`;
  if (c.includes('dex') || c.includes('liquidity')) return `make one small swap through ${n}'s pool and rebalance the liquidity if it drifts out of range`;
  if (c.includes('derivative') || c.includes('perpetual')) return `roll the ${n} hedge once: close and reopen the perp leg at the same size`;
  if (c.includes('bridge') || c.includes('cross chain')) return `bridge about $25 back or forth through ${n} so the route stays active`;
  if (c.includes('rwa')) return `check the ${n} position and mint or redeem a small $25 slice so the account stays active`;
  return `make one small deposit, claim or vote inside ${n} on ${chain} so the week counts as active`;
}

/**
 * A protocol's farm plan: six steps, each an action with its cost and its time, built from the
 * protocol's own record — its category's action, its first chain's fees, capital scaled to its TVL,
 * a hold scaled to its age, and a momentum note from its seven-day change. No hand-written names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const weeks = Math.max(2, Math.round(hold / 7));
  const change = p.change_7d;
  const momentum =
    change === null
      ? `${p.name} reports no seven-day change, so size the position at the standard tier and let the hold do the work.`
      : change >= 3
        ? `${p.name}'s TVL grew ${change.toFixed(1)}% this week: momentum is on your side, but enter in two halves a week apart rather than chasing it.`
        : change <= -10
          ? `${p.name}'s TVL fell ${Math.abs(change).toFixed(1)}% this week: halve the first deposit and add the rest only if TVL stabilises for two weeks.`
          : `${p.name}'s TVL moved ${change >= 0 ? '+' : ''}${change.toFixed(1)}% this week: no strong signal either way, so the standard position applies.`;
  const steps = [
    `Set up a fresh wallet for ${p.name} on ${chain}, fund it with the position capital plus gas money, and store the seed phrase offline. Cost: ${gas} for the first funding transaction. Time: 10 minutes, once.`,
    `${actionFor(p, capital, chain)}. Cost: $${capital} of capital plus ${gas}. Time: about 20 minutes to set up.`,
    `Once a week, ${weeklyFor(p, chain)}. Cost: ${gas} a week, about $${Math.max(1, Math.round(weeks * gasUsd(chain)))} in fees over the whole hold. Time: 10 minutes a week for ${weeks} weeks.`,
    `Hold the position for at least ${hold} days so it appears in repeated snapshots and is not a one-day visit. ${momentum} Cost: the $${capital} stays in the position; withdraw early only if the protocol is exploited or delisted. Time: ${hold} days.`,
    `Every week, open ${p.name}'s own points, rewards or governance page from its official app and record your balance and rank in a farm log; claim only through links the app itself publishes, and never pay a fee to claim. Cost: nothing to check. Time: 5 minutes a week.`,
    `When a token launches or the hold ends, claim through the official announcement only, then decide with the log in front of you: sell half at listing to recover the $${capital} stake and let the rest ride, or withdraw in full. Cost: ${gas} to claim and exit. Time: 30 minutes, once.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/**
 * A farm plan's totals, from the same helpers its steps are built with: the capital tier for the
 * protocol's TVL, one funding transaction, one weekly action per week of the hold, one exit
 * transaction, and the weekly minutes the steps themselves state (10 to act, 5 to check the log).
 */
export function farmSummary(p: SnapshotProtocol, age: number | null): { capital_usd: number; fees_usd: number; hold_days: number; minutes_per_week: number } {
  const chain = chainOf(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(2, Math.round(hold / 7));
  return {
    capital_usd: capitalFor(p),
    fees_usd: Math.max(1, Math.round((weeks + 2) * gasUsd(chain))),
    hold_days: hold,
    minutes_per_week: 15,
  };
}

/** The live-token protocols, by market cap, for the dashboard's Live view: the market's own values. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round3(p.mcap_usd / p.tvl_usd) : null,
      symbol: p.symbol,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const stats = marketStats(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    protocol_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    pre_token_size: snapshot.protocols.filter(isPreToken).length,
    market: stats,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: size, coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const valid = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (!valid.has(r.slug)) return `${r.slug} is not a protocol in the snapshot`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} trimmed characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outranks rank ${i} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
