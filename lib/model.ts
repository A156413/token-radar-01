// Token Launch Radar — the valuation model and board builder.
//
// The snapshot is the only input: 758 protocols with TVL, a seven-day TVL change, a listing date,
// chains, a category, and — for protocols whose token already trades — a market cap. The board ranks
// the protocols that record no token by what a token would be worth if the protocol's record stayed
// as it is. Nothing is looked up and no protocol name is special-cased: every figure below is derived
// from the snapshot's own rows.
//
// The model (peer-multiple-5) is fitted, not tabulated:
//
//   1. The fit. The 128 protocols whose token trades and that report both a market cap and a TVL are
//      the evidence. On them the model fits, by ordinary least squares on hand-solved normal
//      equations, log(market cap) on log(TVL), the seven-day change (clamped to [-30, +50], an
//      unreported change counts as 0) and log(1 + age in days) (an unrecorded listing date counts as
//      730 days, the neutral middle). No coefficient is chosen by hand: the snapshot's own peers set
//      every one, signs included.
//   2. The category offset. A category trades rich or cheap against the fitted line as a whole, so
//      each category also carries the median of its peers' fit residuals, shrunk toward zero by the
//      peer count (offset = n x median / (n + 5)), exactly the shrinkage the earlier model put on its
//      medians. A category with no trading peer gets no offset.
//   3. implied_value_usd = round(exp(fitted line + category offset)), at least $1: what a token
//      would be worth if this protocol's record priced the way its peers' records price.
//
// The model is tested on the same peers, two ways, and the tests ship with the board:
//   - Leave-one-out: each peer is predicted by a model fitted without it. Median |log error| of the
//     fit against two baselines computed the same way — the market-wide median multiple, and the
//     previous model (peer-multiple-4: category median multiples with hand-set momentum, maturity
//     and breadth multipliers).
//   - Walk-forward: the dated peers are split at their median listing date; the model is fitted on
//     the older half and tested on the newer half, baselines likewise.
//   The fit's leave-one-out residuals also set each row's error band: the 80th percentile of
//   |residual| is the half-width, in log space, of the conformal interval around the implied value.
//
// Two ranges ride on every row, and they are different claims. The peer range applies the category's
// own spread — its shrunk lower and upper peer quartiles in place of its median — around the fitted
// point: how far apart the peers are. The conformal band applies the model's own measured error:
// how far off the fit itself has been. The method view states both.
//
//   4. The odds. A value if a token comes is half the question; the snapshot's record also says how
//      often one has come. Protocols fall into six age bands by listing date (under six months, six
//      to twelve months, one to two years, two to four years, four years and over, and undated), and
//      each band's odds are the share of its protocols that record a token in this snapshot. Where a
//      band-and-category cell holds at least ten protocols, the cell's own share is the row's odds;
//      below ten, the row takes its band's share. The odds are a share of a record, stated as such:
//      they are not a forecast that any protocol will issue a token, and they never move a rank —
//      the board still ranks by implied value. expected_value_usd = implied_value_usd x odds is the
//      odds-weighted companion figure, shown beside the value, never instead of it.
//   5. The verdict. Each row's farm plan costs something: its fees, plus its capital priced as tied
//      up at 5% a year over the hold. Against that cost the row sets the pro-rata slice of its
//      expected value that a position of the plan's own size represents (expected value x capital /
//      TVL). verdict = farm when the slice covers the cost at least once over, thin when it covers
//      at least 0.30 of it, skip below that. The constants are stated here and on the method view;
//      nothing outside the snapshot and the plan enters the rule.
//
// The board is the snapshot's watchlist (the floor: every slug, whatever the model says) plus the
// highest-valued further pre-token protocols under the watchlist's own exclusions — no exchanges, no
// bridges or restaked wrappers of a token that already trades, no versioned pools; small independent
// staking products below the floor are admitted, since they do launch tokens, where the giants above
// it are exchange wrappers — so the radar also covers the smaller launches it exists to find early.
// Protocols whose token already trades are kept apart in a live set with the market's own values,
// never mixed into the ranked board. An audit block accounts for every one of the snapshot's
// protocols: fitted peer, other trading protocol, board row, or off the board for a stated reason.

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
export const MODEL_VERSION = 'peer-multiple-5';

/** Total rows on the board: the 40 watchlist slugs plus the best further pre-token protocols. */
export const BOARD_ROWS = 250;

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 30;

/** Winsor bounds for a peer's market-cap-to-TVL ratio, and the shrinkage weight toward the global median. */
export const RATIO_FLOOR = 0.02;
export const RATIO_CAP = 3;
export const SHRINK_PEERS = 5;

/** Momentum: the clamp on the seven-day change (a feature of the fit and of the earlier model alike). */
export const GROWTH_FLOOR = -30;
export const GROWTH_CAP = 50;

/** The earlier model's hand-set constants, kept only so its scores can be recomputed as a baseline. */
export const GROWTH_WEIGHT = 1.2;
export const MATURITY_FLOOR = 0.78;
export const MATURITY_SPAN = 0.44;
export const MATURITY_DAYS = 1460;
export const CHAIN_STEP = 0.03;
export const CHAIN_MAX_EXTRA = 7;

/** An unrecorded listing date counts as this many days, the neutral middle, in fit and odds alike. */
export const UNKNOWN_AGE_DAYS = 730;

/** A band-and-category cell needs at least this many protocols before its own share sets a row's odds. */
export const ODDS_CELL_MIN = 10;

/** The verdict's stated constants: capital priced at this yearly rate while tied up in a position. */
export const CAPITAL_RATE = 0.05;
/** The verdict's stated thresholds on position value over plan cost: farm at 1x, thin at 0.30x. */
export const VERDICT_FARM = 1;
export const VERDICT_THIN = 0.3;

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
  /** The category's largest trading peers by market cap, named, with the ratio each contributes. */
  peer_examples: { name: string; ratio: number }[];
}

/** The model's market-wide figures, computed from the snapshot's trading protocols. */
export interface MarketStats {
  global_median: number;
  peer_count: number;
  categories: CategoryStat[];
}

/** One test's outcome: the median |log error| of the fit and of each baseline, and the fit's edge. */
export interface ValidationTest {
  /** Peers the model was fitted on for this test (leave-one-out: all but the one predicted). */
  train: number;
  /** Peers predicted in this test. */
  test: number;
  fitted: number;
  global_median: number;
  category_model: number;
  /** How many times smaller the fit's median error is than each baseline's. */
  vs_global: number;
  vs_category: number;
}

/** The fitted model, its two tests and the error band they set, all computed from the snapshot. */
export interface FitStats {
  /** Trading peers the fit stands on: both a market cap and a TVL in the snapshot. */
  peers: number;
  /** The fitted coefficients: constant, log TVL, seven-day change (per point), log(1 + age days). */
  coefficients: number[];
  /** The 80th percentile of the leave-one-out |residuals|: the conformal half-width, in log space. */
  conformal_log: number;
  loo: ValidationTest;
  walk_forward: ValidationTest;
}

/** One age band of the odds table: its protocols, and the share of them that record a token. */
export interface OddsBand {
  key: string;
  label: string;
  protocols: number;
  record_token: number;
  share: number;
}

/** The odds model: the six age bands, and the share each band (or band-and-category cell) records. */
export interface OddsStats {
  bands: OddsBand[];
}

/** Every protocol in the snapshot accounted for: where it went, and why, in counts. */
export interface AuditStats {
  total: number;
  fitted_peers: number;
  traded_other: number;
  pre_token: number;
  board_rows: number;
  off_board: number;
  excluded: {
    category: number;
    floor_staking: number;
    versioned: number;
    wrapped_name: number;
    exchange_name: number;
    below_cut: number;
  };
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
  /** The share of comparable protocols (same age band, or band and category) that record a token. */
  odds: number;
  /** implied_value_usd x odds: the odds-weighted companion figure; the rank never reads it. */
  expected_value_usd: number;
  verdict: 'farm' | 'thin' | 'skip';
  model: {
    /** The fitted multiple the implied value stands on: fitted value over TVL, offset included. */
    fitted_multiple: number;
    /** The category's offset against the fitted line, as a factor (1 when it has no peers). */
    category_offset: number;
    category_peers: number;
    /** The implied value at the category's shrunk peer quartiles: the spread of the evidence. */
    value_low_usd: number;
    value_high_usd: number;
    /** The implied value across the model's own measured error band (conformal, 80%). */
    conf_low_usd: number;
    conf_high_usd: number;
    /** The odds' age band label, and whether the band-and-category cell or the band set the figure. */
    odds_band: string;
    odds_basis: 'category' | 'band';
    /** The pro-rata slice of expected value a position of the plan's size represents, and its cost. */
    position_value_usd: number;
    plan_cost_usd: number;
    verdict_ratio: number;
  };
  farm_steps: string[];
  /** The farm plan's totals, from the same figures its steps carry: capital, fees, hold, weekly time. */
  farm_summary: {
    capital_usd: number;
    /** The deposit tier the plan is sized to: the same figure as capital, named for the reader. */
    deposit_tier_usd: number;
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

/** One self-check the program ran on its own board at build time, with its outcome. */
export interface IntegrityCheck {
  label: string;
  ok: boolean;
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
  fit: FitStats;
  odds: OddsStats;
  audit: AuditStats;
  rows: RadarRow[];
  live: LiveRow[];
  /** The board's own headlines, computed from the same rows: what a reader should notice first. */
  insights: { title: string; body: string }[];
  /** Self-checks the entry program ran on this board before writing it; filled in by main.ts. */
  integrity: IntegrityCheck[];
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
const round2 = (n: number): number => Math.round(n * 1e2) / 1e2;
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

/** The trading peers the fit stands on: a token trades, and both a market cap and a TVL are recorded. */
export function fitPeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * The market's own evidence: every trading protocol's winsorised market-cap-to-TVL ratio, the global
 * median, and each category's shrunk multiple. Deterministic: peers are read in snapshot order and
 * every median sorts its values first. The fitted model keeps this table for two jobs: each row's
 * peer range is read off it, and the validation baselines are scored with it.
 */
export function marketStats(snapshot: Snapshot): MarketStats {
  const ratiosByCategory = new Map<string, number[]>();
  const peersByCategory = new Map<string, { name: string; ratio: number; mcap: number }[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, RATIO_FLOOR, RATIO_CAP);
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
    const peers = peersByCategory.get(key);
    const entry = { name: p.name, ratio: round4(ratio), mcap: p.mcap_usd };
    if (peers === undefined) peersByCategory.set(key, [entry]);
    else peers.push(entry);
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
        peer_examples: (peersByCategory.get(category) ?? [])
          .sort((a, b) => b.mcap - a.mcap || (a.name < b.name ? -1 : 1))
          .slice(0, 3)
          .map((e) => ({ name: e.name, ratio: e.ratio })),
      };
    })
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  return { global_median: round4(globalMedian), peer_count: all.length, categories };
}

/** The multiples one category trades at under the earlier model; the global figures when it has none. */
function multipleFor(stats: MarketStats, category: string | null): { multiple: number; low: number; high: number; peers: number } {
  const key = category ?? 'Uncategorised';
  const stat = stats.categories.find((c) => c.category === key);
  return stat === undefined
    ? { multiple: stats.global_median, low: stats.global_median, high: stats.global_median, peers: 0 }
    : { multiple: stat.multiple, low: stat.multiple_low, high: stat.multiple_high, peers: stat.peers };
}

/**
 * The earlier model (peer-multiple-4), kept whole so the validation can score it as a baseline on
 * any pool of peers: category median multiple, hand-set momentum, maturity and breadth multipliers.
 */
function baselineValue(
  protocol: SnapshotProtocol,
  asOf: string,
  stats: MarketStats,
): { implied: number; low: number; high: number; multiple: number; peers: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, low, high, peers } = multipleFor(stats, protocol.category);
  const growthPct = clamp(protocol.change_7d ?? 0, GROWTH_FLOOR, GROWTH_CAP);
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturityMult = MATURITY_FLOOR + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_SPAN;
  const breadthMult = 1 + CHAIN_STEP * Math.min(Math.max(protocol.chains.length - 1, 0), CHAIN_MAX_EXTRA);
  const rest = growthMult * maturityMult * breadthMult;
  return {
    implied: Math.max(1, Math.round(protocol.tvl_usd * multiple * rest)),
    low: Math.max(1, Math.round(protocol.tvl_usd * low * rest)),
    high: Math.max(1, Math.round(protocol.tvl_usd * high * rest)),
    multiple, peers,
  };
}

/** The fit's features for one protocol: constant, log TVL, clamped seven-day change, log(1 + age). */
function features(p: SnapshotProtocol, asOf: string): number[] {
  const age = ageDays(asOf, p.listed_at) ?? UNKNOWN_AGE_DAYS;
  return [1, Math.log(Math.max(1, p.tvl_usd)), clamp(p.change_7d ?? 0, GROWTH_FLOOR, GROWTH_CAP), Math.log1p(Math.max(0, age))];
}

/** A small dense linear system solved by Gaussian elimination with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    const tmp = m[col]!; m[col] = m[piv]!; m[piv] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      for (let k = col; k <= n; k++) m[r]![k] = m[r]![k]! - f * m[col]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Ordinary least squares of log(market cap) on the features, over a pool of trading peers. */
function fitCoefficients(pool: SnapshotProtocol[], asOf: string): number[] {
  const k = 4;
  const a = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const b = Array<number>(k).fill(0);
  for (const p of pool) {
    const x = features(p, asOf);
    const y = Math.log(p.mcap_usd!);
    for (let i = 0; i < k; i++) {
      b[i] = b[i]! + x[i]! * y;
      for (let j = 0; j < k; j++) a[i]![j] = a[i]![j]! + x[i]! * x[j]!;
    }
  }
  return solveLinear(a, b);
}

/** Each category's shrunk median residual against a fitted line: its offset, in log space. */
function categoryOffsets(pool: SnapshotProtocol[], asOf: string, beta: number[]): Map<string, number> {
  const residuals = new Map<string, number[]>();
  for (const p of pool) {
    const x = features(p, asOf);
    const predicted = x.reduce((s, xi, i) => s + xi * beta[i]!, 0);
    const key = p.category ?? 'Uncategorised';
    const list = residuals.get(key);
    const r = Math.log(p.mcap_usd!) - predicted;
    if (list === undefined) residuals.set(key, [r]);
    else list.push(r);
  }
  const offsets = new Map<string, number>();
  for (const [key, list] of residuals) offsets.set(key, (list.length * median(list)) / (list.length + SHRINK_PEERS));
  return offsets;
}

/** A fitted line plus its category offsets: the whole regression side of the model, fitted on a pool. */
interface FittedLine {
  beta: number[];
  offsets: Map<string, number>;
}

function fitLine(pool: SnapshotProtocol[], asOf: string): FittedLine {
  const beta = fitCoefficients(pool, asOf);
  return { beta, offsets: categoryOffsets(pool, asOf, beta) };
}

/** The fitted log market cap of one protocol under a fitted line, category offset included. */
function fittedLog(p: SnapshotProtocol, asOf: string, line: FittedLine): number {
  const x = features(p, asOf);
  const base = x.reduce((s, xi, i) => s + xi * line.beta[i]!, 0);
  return base + (line.offsets.get(p.category ?? 'Uncategorised') ?? 0);
}

/** One test scored: the fit and both baselines fitted on `train`, their median |log error| on `test`. */
function scoreTest(train: SnapshotProtocol[], test: SnapshotProtocol[], snapshot: Snapshot): ValidationTest {
  const asOf = snapshot.as_of;
  const line = fitLine(train, asOf);
  const trainStats = marketStats({ ...snapshot, protocols: train });
  const err = (predict: (p: SnapshotProtocol) => number): number =>
    median(test.map((p) => Math.abs(Math.log(p.mcap_usd!) - predict(p))));
  const fitted = err((p) => fittedLog(p, asOf, line));
  const globalMedian = err((p) => Math.log(Math.max(1, p.tvl_usd * trainStats.global_median)));
  const categoryModel = err((p) => Math.log(baselineValue(p, asOf, trainStats).implied));
  return {
    train: train.length,
    test: test.length,
    fitted: round3(fitted),
    global_median: round3(globalMedian),
    category_model: round3(categoryModel),
    vs_global: round2(globalMedian / fitted),
    vs_category: round2(categoryModel / fitted),
  };
}

/**
 * The fitted model and its evidence: coefficients from all the snapshot's trading peers, the
 * leave-one-out and walk-forward tests, and the conformal half-width the leave-one-out residuals set.
 */
export function fitModel(snapshot: Snapshot): FitStats {
  const peers = fitPeers(snapshot);
  const asOf = snapshot.as_of;
  const beta = fitCoefficients(peers, asOf);

  // Leave-one-out: every peer predicted by a line fitted without it; the residuals also set the band.
  const looErrors: { fitted: number; global: number; category: number }[] = [];
  const looResiduals: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const rest = peers.filter((_, j) => j !== i);
    const p = peers[i]!;
    const line = fitLine(rest, asOf);
    const restStats = marketStats({ ...snapshot, protocols: rest });
    const actual = Math.log(p.mcap_usd!);
    const predicted = fittedLog(p, asOf, line);
    looResiduals.push(Math.abs(actual - predicted));
    looErrors.push({
      fitted: Math.abs(actual - predicted),
      global: Math.abs(actual - Math.log(Math.max(1, p.tvl_usd * restStats.global_median))),
      category: Math.abs(actual - Math.log(baselineValue(p, asOf, restStats).implied)),
    });
  }
  const loo: ValidationTest = {
    train: peers.length - 1,
    test: peers.length,
    fitted: round3(median(looErrors.map((e) => e.fitted))),
    global_median: round3(median(looErrors.map((e) => e.global))),
    category_model: round3(median(looErrors.map((e) => e.category))),
    vs_global: round2(median(looErrors.map((e) => e.global)) / median(looErrors.map((e) => e.fitted))),
    vs_category: round2(median(looErrors.map((e) => e.category)) / median(looErrors.map((e) => e.fitted))),
  };

  // Walk-forward: the dated peers split at their median listing date, older half trains, newer tests.
  const dated = peers
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const walkForward = scoreTest(dated.slice(0, half), dated.slice(half), snapshot);

  return {
    peers: peers.length,
    coefficients: beta.map(round4),
    conformal_log: round3(quantile(looResiduals, 0.8)),
    loo,
    walk_forward: walkForward,
  };
}

/** The six age bands of the odds table, in the order the method view states them. */
const AGE_BANDS: { key: string; label: string; lo: number; hi: number }[] = [
  { key: 'under-6mo', label: 'Under 6 months', lo: 0, hi: 180 },
  { key: '6-12mo', label: '6-12 months', lo: 180, hi: 365 },
  { key: '1-2yr', label: '1-2 years', lo: 365, hi: 730 },
  { key: '2-4yr', label: '2-4 years', lo: 730, hi: 1460 },
  { key: '4yr-plus', label: '4 years and over', lo: 1460, hi: Infinity },
  { key: 'undated', label: 'No listing date recorded', lo: -1, hi: -1 },
];

/** The band index of an age in days; the undated band when the snapshot records no listing date. */
function bandIndex(age: number | null): number {
  if (age === null) return AGE_BANDS.length - 1;
  return AGE_BANDS.findIndex((b) => age >= b.lo && age < b.hi);
}

/** The odds model over the whole snapshot: band shares, and band-and-category cells for the rows. */
export function oddsModel(snapshot: Snapshot): { stats: OddsStats; oddsFor: (p: SnapshotProtocol) => { odds: number; band: string; basis: 'category' | 'band' } } {
  const counts = AGE_BANDS.map(() => ({ n: 0, traded: 0 }));
  const cells = new Map<string, { n: number; traded: number }>();
  for (const p of snapshot.protocols) {
    const bi = bandIndex(ageDays(snapshot.as_of, p.listed_at));
    const band = counts[bi]!;
    band.n += 1;
    if (!isPreToken(p)) band.traded += 1;
    const key = `${bi}|${p.category ?? 'Uncategorised'}`;
    const cell = cells.get(key) ?? { n: 0, traded: 0 };
    cell.n += 1;
    if (!isPreToken(p)) cell.traded += 1;
    cells.set(key, cell);
  }
  const bands: OddsBand[] = AGE_BANDS.map((b, i) => ({
    key: b.key,
    label: b.label,
    protocols: counts[i]!.n,
    record_token: counts[i]!.traded,
    share: counts[i]!.n > 0 ? round4(counts[i]!.traded / counts[i]!.n) : 0,
  }));
  return {
    stats: { bands },
    oddsFor: (p) => {
      const bi = bandIndex(ageDays(snapshot.as_of, p.listed_at));
      const cell = cells.get(`${bi}|${p.category ?? 'Uncategorised'}`);
      if (cell !== undefined && cell.n >= ODDS_CELL_MIN) {
        return { odds: round4(cell.traded / cell.n), band: AGE_BANDS[bi]!.label, basis: 'category' as const };
      }
      return { odds: bands[bi]!.share, band: AGE_BANDS[bi]!.label, basis: 'band' as const };
    },
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

/** Why a pre-token protocol is off the board, for the audit: the first exclusion that takes it. */
function exclusionReason(p: SnapshotProtocol, floorUsd: number): keyof AuditStats['excluded'] {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return 'category';
  if (p.category !== null && FLOOR_EXCLUDED_CATEGORIES.has(p.category) && p.tvl_usd >= floorUsd) return 'floor_staking';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped_name';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange_name';
  return 'below_cut';
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
export function farmSummary(p: SnapshotProtocol, age: number | null): { capital_usd: number; deposit_tier_usd: number; fees_usd: number; hold_days: number; minutes_per_week: number } {
  const chain = chainOf(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(2, Math.round(hold / 7));
  const capital = capitalFor(p);
  return {
    capital_usd: capital,
    deposit_tier_usd: capital,
    fees_usd: Math.max(1, Math.round((weeks + 2) * gasUsd(chain))),
    hold_days: hold,
    minutes_per_week: 15,
  };
}

/** The verdict on one row: its position's slice of expected value against its plan's full cost. */
function verdictFor(expected: number, p: SnapshotProtocol, summary: { capital_usd: number; fees_usd: number; hold_days: number }): { verdict: 'farm' | 'thin' | 'skip'; position_value: number; plan_cost: number; ratio: number } {
  const positionValue = p.tvl_usd > 0 ? (expected * summary.capital_usd) / p.tvl_usd : 0;
  const planCost = summary.fees_usd + (summary.capital_usd * summary.hold_days * CAPITAL_RATE) / 365;
  const ratio = planCost > 0 ? positionValue / planCost : 0;
  return {
    verdict: ratio >= VERDICT_FARM ? 'farm' : ratio >= VERDICT_THIN ? 'thin' : 'skip',
    position_value: Math.round(positionValue),
    plan_cost: round2(planCost),
    ratio: round3(ratio),
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n, and the audit of the rest. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; audit: AuditStats } {
  const stats = marketStats(snapshot);
  const fit = fitModel(snapshot);
  const line = fitLine(fitPeers(snapshot), snapshot.as_of);
  const odds = oddsModel(snapshot);
  const confFactor = Math.exp(fit.conformal_log);
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
    .map((p) => ({ p, implied: Math.exp(fittedLog(p, snapshot.as_of, line)) }))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, Math.max(0, BOARD_ROWS - chosen.size));
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, log: fittedLog(p, snapshot.as_of, line) }));
  scored.sort((a, b) => b.log - a.log || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlist = new Set(snapshot.watchlist);
  const board = scored.map((s, i) => {
    const p = s.p;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const implied = Math.max(1, Math.round(Math.exp(s.log)));
    const range = multipleFor(stats, p.category);
    const spread = range.multiple > 0 ? implied / (p.tvl_usd * range.multiple) : 1;
    const o = odds.oddsFor(p);
    const expected = Math.round(implied * o.odds);
    const summary = farmSummary(p, age);
    const v = verdictFor(expected, p, summary);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      watchlist: watchlist.has(p.slug),
      age_days: age,
      implied_value_usd: implied,
      implied_tvl_ratio: round3(implied / Math.max(1, p.tvl_usd)),
      odds: o.odds,
      expected_value_usd: expected,
      verdict: v.verdict,
      model: {
        fitted_multiple: round4(Math.exp(s.log) / Math.max(1, p.tvl_usd)),
        category_offset: round4(Math.exp(line.offsets.get(p.category ?? 'Uncategorised') ?? 0)),
        category_peers: range.peers,
        value_low_usd: Math.max(1, Math.round(p.tvl_usd * range.low * spread)),
        value_high_usd: Math.max(1, Math.round(p.tvl_usd * range.high * spread)),
        conf_low_usd: Math.max(1, Math.round(implied / confFactor)),
        conf_high_usd: Math.round(implied * confFactor),
        odds_band: o.band,
        odds_basis: o.basis,
        position_value_usd: v.position_value,
        plan_cost_usd: v.plan_cost,
        verdict_ratio: v.ratio,
      },
      farm_steps: farmSteps(p, age),
      farm_summary: summary,
    };
  });

  const peers = fitPeers(snapshot).length;
  const traded = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const excluded: AuditStats['excluded'] = { category: 0, floor_staking: 0, versioned: 0, wrapped_name: 0, exchange_name: 0, below_cut: 0 };
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) || chosen.has(p.slug)) continue;
    excluded[exclusionReason(p, snapshot.floor_usd)] += 1;
  }
  const offBoard = Object.values(excluded).reduce((s, n) => s + n, 0);
  const audit: AuditStats = {
    total: snapshot.protocols.length,
    fitted_peers: peers,
    traded_other: traded - peers,
    pre_token: snapshot.protocols.filter(isPreToken).length,
    board_rows: board.length,
    off_board: offBoard,
    excluded,
  };
  return { board, audit };
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

/** A whole-dollar figure the way the dashboard's insight cards state it. */
function fmtUsdShort(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/**
 * The board's headlines, in the order a reader should meet them: first that the model is fitted and
 * tested (with its measured edge over both baselines), then what the record says about the odds,
 * then the largest early find below the floor.
 */
export function boardInsights(board: BoardRow[], fit: FitStats, odds: OddsStats): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  out.push({
    title: 'Fitted on its own peers, then tested',
    body: `A regression on the ${fit.peers} peers, not a table of constants. Leave-one-out, its median error is ${fit.loo.vs_global}x smaller than the market median's, ${fit.loo.vs_category}x smaller than the previous category model's; walk-forward, ${fit.walk_forward.vs_global}x and ${fit.walk_forward.vs_category}x.`,
  });
  const young = odds.bands[0]!;
  const old = odds.bands[4]!;
  out.push({
    title: 'The odds, from the record',
    body: `Protocols first tracked ${young.label.toLowerCase()} record a token ${(young.share * 100).toFixed(0)}% of the time; those tracked ${old.label.toLowerCase()}, ${(old.share * 100).toFixed(0)}%. Each row's expected value carries its own band's share.`,
  });
  const early = board.filter((r) => !r.watchlist);
  if (early.length > 0) {
    const top = early[0]!;
    out.push({
      title: 'Biggest early find',
      body: `${top.name} ranks #${top.rank} at ${fmtUsdShort(top.implied_value_usd)} implied — below the watchlist floor, found by the model, not by size.`,
    });
  }
  return out;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, audit } = buildBoard(snapshot);
  const stats = marketStats(snapshot);
  const fit = fitModel(snapshot);
  const odds = oddsModel(snapshot);
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
    fit,
    odds: odds.stats,
    audit,
    rows: board,
    live,
    insights: boardInsights(board, fit, odds.stats),
    integrity: [],
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
