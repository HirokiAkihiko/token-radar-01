// Token Launch Radar — valuation model, version radar-2.
//
// Idea in one paragraph: a pre-token protocol has no price, but the same
// snapshot contains 100+ protocols that already trade. Those traded peers
// reveal what the market actually pays per dollar of TVL in each category
// (their median market-cap / TVL ratio). A pre-token protocol is therefore
// valued at the multiple its own category's traded peers command, applied
// to its own TVL, then adjusted for three things the snapshot also records:
// short-term momentum (7-day TVL change), operating maturity (days since
// DefiLlama first tracked it), and distribution breadth (how many chains
// it already runs on). Small peer samples are shrunk toward the market-wide
// median so a category with two noisy peers cannot dominate the board.
// Every number comes from the snapshot itself; no name is special-cased.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  multiple_floor: number;
  multiple_cap: number;
  shrinkage_peers: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_base: number;
  maturity_span: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_doubling: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: 0.03,
  multiple_cap: 1.0,
  shrinkage_peers: 8,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_base: 0.65,
  maturity_span: 0.5,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_doubling: 0.04,
  breadth_cap: 1.16,
};

export const MODEL_VERSION = 'radar-2';
export const EARLY_ROWS = 180;
export const LIVE_ROWS = 24;

export interface CategoryMultiple {
  category: string;
  peers: number;
  raw_median: number;
  multiple: number;
}

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
  age_days: number | null;
  implied_value_usd: number;
  confidence: number;
  confidence_tier: string;
  model: {
    base_multiple: number;
    category_multiple: number;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  confidence: number;
  confidence_tier: string;
  category_multiple: number;
  category_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  overall_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  categories: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clampMultiple(v: number, model: ModelConstants): number {
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, v));
}

/** Category multiples learned from the traded peers inside this snapshot. */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { overall: number; byCategory: Map<string, CategoryMultiple> } {
  const ratios: number[] = [];
  const grouped = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    ratios.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const bucket = grouped.get(key);
    if (bucket) bucket.push(ratio); else grouped.set(key, [ratio]);
  }
  const overall = ratios.length > 0 ? clampMultiple(median(ratios), model) : model.multiple_floor;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, values] of grouped) {
    // Winsorise the raw median first: one thin, extreme peer (a curator or
    // chain token trading at several times its TVL) must not set the price
    // of a whole category.
    const raw = Math.min(1.5, Math.max(0.02, median(values)));
    // Shrinkage: a category earns its own multiple only as its peer count grows.
    const weight = values.length / (values.length + model.shrinkage_peers);
    const blended = raw * weight + overall * (1 - weight);
    byCategory.set(category, { category, peers: values.length, raw_median: round4(raw), multiple: round4(clampMultiple(blended, model)) });
  }
  return { overall: round4(overall), byCategory };
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED_NAME.test(p.name);
}

export interface ScoredParts {
  implied: number;
  multiple: number;
  peers: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
  confidence: number;
  tier: string;
}

export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  multiples: { overall: number; byCategory: Map<string, CategoryMultiple> },
  model: ModelConstants = MODEL,
): ScoredParts {
  const cat = multiples.byCategory.get(p.category ?? 'Uncategorised');
  const multiple = cat ? cat.multiple : multiples.overall;
  const peers = cat ? cat.peers : 0;
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const age = ageDays(asOf, p.listed_at);
  const effectiveAge = age ?? model.unknown_age_days;
  const chainCount = Math.max(1, p.chains.length);
  // Round every factor to 4 decimals BEFORE multiplying: the dashboard
  // stores only the rounded factors, and it must recompute the exact
  // board value from them, dollar for dollar.
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const maturityMult = round4(model.maturity_base + (Math.min(Math.max(effectiveAge, 0), model.maturity_days) / model.maturity_days) * model.maturity_span);
  const breadthMult = round4(Math.min(model.breadth_cap, 1 + model.breadth_per_doubling * Math.log2(chainCount)));
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * breadthMult));

  // Confidence: evidence quality, not a second valuation. Peer depth, known
  // age, and absolute size each contribute; tiers keep the board honest.
  let confidence = 20;
  confidence += Math.min(30, peers * 4);
  confidence += age === null ? 4 : Math.min(20, Math.floor(age / 90) * 3);
  confidence += p.tvl_usd >= 1_000_000_000 ? 20 : p.tvl_usd >= 100_000_000 ? 14 : p.tvl_usd >= 50_000_000 ? 9 : 5;
  confidence += Math.min(10, chainCount * 2);
  confidence = Math.min(98, confidence);
  const tier = confidence >= 70 ? 'High' : confidence >= 50 ? 'Medium' : 'Early';
  return { implied, multiple, peers, growthPct, growthMult, maturityMult, breadthMult, age, confidence, tier };
}

function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalTier(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral to ${n} on ${chain}, then borrow a small amount against it and repay once so both sides of the market record your wallet.`;
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual')) return `Trade and provide $${capital} of liquidity in ${n}'s main market on ${chain}, spreading activity across several days instead of one burst.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC through ${n} to ${chain} and complete one real transaction with the bridged funds on the far side.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the underlying asset through ${n} on ${chain} and keep the staking receipt token in the same wallet.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into one curated ${n} vault on ${chain} and keep the vault shares untouched during the hold window.`;
  if (c.includes('rwa')) return `Complete onboarding for ${n} on ${chain} if it is open to your region, then mint or buy $${capital} of its yield asset and hold it.`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset issued through ${n} on ${chain} and use it in one payment or pool.`;
  if (c.includes('insurance')) return `Buy $${capital} of genuine cover from ${n} on ${chain} for an asset you actually hold and keep the policy to expiry.`;
  if (c.includes('payment')) return `Route one real payment of about $${capital} through ${n} on ${chain} instead of a round-trip transfer to yourself.`;
  if (c.includes('yield') || c.includes('basis')) return `Deposit $${capital} into ${n}'s main strategy on ${chain} and let one full yield cycle settle before touching it.`;
  if (c.includes('chain')) return `Deploy or use one application on the ${n} network, bridge $${capital} in, and transact on several separate days.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its official app and keep the resulting position open.`;
}

function categoryRisk(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Watch the health factor weekly: a collateral price drop can liquidate the position long before any token exists, so keep a buffer above the minimum.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('basis')) return `Check impermanent loss and strategy drift weekly: yield shown on the deposit page is not a promise, and a falling pool can cost more than any airdrop returns.`;
  if (c.includes('bridge')) return `Treat every bridge hop as the riskiest step: verify the contract address from the protocol's own documentation and never bridge more than the plan states.`;
  if (c.includes('staking') || c.includes('restak')) return `Note the unbonding period before staking: restaked and staked positions can be locked or slashed, so size the position as money you cannot move quickly.`;
  if (c.includes('rwa')) return `Read the redemption terms before minting: real-world-asset tokens can have lockups, allowlists and slow exits that outlast the farming window.`;
  return `Re-check the position weekly for contract upgrades, paused markets or changed terms, and be ready to exit if the protocol's own channels announce a change.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = firstChain(p);
  const capital = capitalTier(p);
  const hold = holdWindow(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps = [
    `Start with a dedicated farming wallet funded only with the planned $${capital} plus gas, and store its seed phrase offline, never in a screenshot or chat. Cost: under $3 to set up. Time: 5 minutes.`,
    coreAction(p, capital, chain) + ` Cost: $${capital} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    `Repeat one qualifying action every week (a deposit, repay, swap, stake top-up or vote, whichever ${p.name} counts) so the wallet shows a pattern, not a single visit. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days across several weekly snapshots, because one-day deposits are the easiest pattern for a distribution to filter out. Cost: the $${capital} stays committed. Time: ${hold} days.`,
    categoryRisk(p) + ` Cost: 5 minutes a week. Time: ongoing during the hold.`,
    `Look for a points, quests or rewards page only through ${p.name}'s official site and documentation; claim pages linked from comments or direct messages are the standard phishing route. Cost: nothing to check, never pay a claim fee. Time: 10 minutes.`,
    `Log the wallet address, every date, amount and transaction hash in a farm journal, and set a calendar reminder to review or unwind the position after ${hold} days. Cost: nothing. Time: 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, multiples, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map(({ p, s }, i) => ({
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
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    confidence: s.confidence,
    confidence_tier: s.tier,
    model: {
      base_multiple: s.multiple,
      category_multiple: s.multiple,
      category_peers: s.peers,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age),
  }));
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    confidence: row.confidence,
    confidence_tier: row.confidence_tier,
    category_multiple: row.model.category_multiple,
    category_peers: row.model.category_peers,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = categoryMultiples(snapshot, model);
  const categories = [...multiples.byCategory.values()]
    .filter((c) => c.peers >= 2)
    .sort((a, b) => b.multiple - a.multiple);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    overall_multiple: multiples.overall,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    live_size: liveRows(snapshot).length,
    categories,
    rows: board.map(radarRow),
    live: liveRows(snapshot),
  };
  return { board, radar };
}

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
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks slug, name or TVL`);
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

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `board has ${board.length} rows, under the 100-row minimum`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank sequence broken at ${i + 1}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} chars`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
