import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { VideoPokerDataset, VideoPokerBet, SeedEntry } from './types';

const DATASET_PATH = path.join(__dirname, '../data/video-poker-dataset-5400bets.json');

/**
 * Expected SHA-256 of the dataset file. Pinned after capture completion.
 */
const EXPECTED_HASH = '363fd4d4c072a1180ca2e7ab61d0c8dcc6f3300f315449af0d7101dd45dd0654';

export function getDatasetPath(): string { return DATASET_PATH; }

export function loadDataset(): VideoPokerDataset {
  const raw = fs.readFileSync(DATASET_PATH, 'utf-8');
  return JSON.parse(raw) as VideoPokerDataset;
}

export function loadDatasetBuffer(): Buffer {
  return fs.readFileSync(DATASET_PATH);
}

export function checkDatasetHash(): { expected: string; actual: string; match: boolean } {
  const raw    = fs.readFileSync(DATASET_PATH);
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  return {
    expected: EXPECTED_HASH,
    actual,
    match: actual === EXPECTED_HASH,
  };
}

/**
 * Build O(1) map: serverSeedHashed → serverSeed (plaintext).
 *
 * seeds[N].seed.serverSeed is the PREVIOUS epoch's revealed seed (null for the
 * first entry). The plaintext for seeds[N].serverSeedHashed is in
 * seeds[N+1].seed.serverSeed. We verify the hash matches before adding.
 */
export function buildSeedMap(seeds: SeedEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < seeds.length - 1; i++) {
    const next = seeds[i + 1];
    if (next.seed.serverSeed) {
      const h = crypto.createHash('sha256')
        .update(Buffer.from(next.seed.serverSeed, 'hex'))
        .digest('hex');
      if (h === seeds[i].seed.serverSeedHashed) {
        m.set(seeds[i].seed.serverSeedHashed, next.seed.serverSeed);
      }
    }
  }
  return m;
}

/** Group bets by serverSeedHashed (epoch). */
export function groupByHash(bets: VideoPokerBet[]): Map<string, VideoPokerBet[]> {
  const m = new Map<string, VideoPokerBet[]>();
  for (const b of bets) {
    const hash = b.seed.serverSeedHashed;
    const arr  = m.get(hash) ?? [];
    arr.push(b);
    m.set(hash, arr);
  }
  return m;
}

/**
 * Group bets by the CAPTURE TIMELINE, not by their own hash.
 *
 * A bet belongs to the last rotation record whose `at` precedes it. This source never reads the
 * bet's serverSeedHashed, so a check that the bets of window i all carry record i's committed
 * hash is falsifiable — unlike grouping BY serverSeedHashed and then asserting one hash per
 * group, which is true of any input whatsoever. Same construction as Duel mines.
 */
export interface EpochGroup {
  /** Index into `seeds[]`. */
  index: number;
  record: SeedEntry;
  bets: VideoPokerBet[];
}

export function groupByEpochWindow(
  bets: VideoPokerBet[],
  seeds: SeedEntry[],
): { epochs: EpochGroup[]; orphans: VideoPokerBet[] } {
  const epochs: EpochGroup[] = seeds.map((record, index) => ({ index, record, bets: [] }));
  const orphans: VideoPokerBet[] = [];
  for (const b of bets) {
    // ISO-8601 UTC timestamps compare correctly as strings; a linear scan keeps it obvious.
    let idx = -1;
    for (let j = 0; j < seeds.length; j++) {
      if (seeds[j].at <= b.at) idx = j; else break;
    }
    if (idx < 0) { orphans.push(b); continue; }
    epochs[idx].bets.push(b);
  }
  return { epochs, orphans };
}

/** Group bets by phase (A/B/C/D/E). */
export function groupByPhase(bets: VideoPokerBet[]): Record<string, VideoPokerBet[]> {
  const out: Record<string, VideoPokerBet[]> = { A: [], B: [], C: [], D: [], E: [] };
  for (const b of bets) {
    (out[b.phase] ?? (out[b.phase] = [])).push(b);
  }
  return out;
}

/** The number of cards the player discarded (0–5). */
export function discardCount(bet: VideoPokerBet): number {
  return 5 - bet.draw.response.held_cards.length;
}

// ── POPULATION OF RECORD ─────────────────────────────────────────────────────────
// The capture plan, stated as CODE, beside the dataset pin above.
//
// A dataset that agrees with its own header proves nothing: delete rounds, shrink the header
// to match, and the file is internally consistent and re-pins cleanly — and re-pinning is
// exactly what a forger does, so EXPECTED_HASH cannot see it either. The counts have to be
// asserted from somewhere the dataset does not control, and a step that finds them wrong must
// FAIL rather than report.
//
// The dataset's meta carries its own `phaseBetCounts`. Reconciling that header AGAINST these
// constants is a good check and step 13 does it. Reading it AS the population is the defect.
export const EXPECTED_BETS   = 5400;
export const EXPECTED_SEEDS  = 115;
export const EXPECTED_EPOCHS = 110;

export const EXPECTED_PHASE_BETS: Readonly<Record<string, number>> =
  Object.freeze({ A: 3000, B: 1000, C: 100, D: 500, E: 800 });
export const EXPECTED_PHASE_SEEDS: Readonly<Record<string, number>> =
  Object.freeze({ A: 62, B: 21, C: 3, D: 12, E: 17 });

// Epoch sizes are NOT uniform here, so a single constant would be the wrong shape and
// `min === max` would be false on the honest capture. The exact multiset is pinned instead:
// 106 full epochs of 50, two of 49, and two holding a single bet. Any uniform shrink, any
// deleted epoch and any deleted bet changes this histogram.
export const EXPECTED_EPOCH_SIZES: Readonly<Record<string, number>> =
  Object.freeze({ 1: 2, 49: 2, 50: 106 });
/** The capture's rotation schedule (capture/capture.reference.js BETS_PER_EPOCH = 50: it rotated once a
 *  seed's nonce reached 50), not Duel's; Duel reveals a seed only when the player rotates. No epoch may exceed it. */
export const EPOCH_SIZE_CAP = 50;

// Every epoch carrying bets has its plaintext revealed by the following rotation, so 100% of
// captured bets are recomputable. Binding the commitment and determinism steps to this is what
// stops "0 mismatches" passing on an empty or truncated seed list.
export const EXPECTED_REVEALED_EPOCHS = 110;

// seeds[0] carries no plaintext: the rotation that would reveal it happened before capture
// began. It is the ONLY unrevealed entry, and that is a property of the capture plan.
export const EXPECTED_UNREVEALED_SEEDS = 1;

// One per phase change: the next phase's opening rotation (seeds 62, 83, 86, 98) reveals the
// previous phase's last bet-bearing seed rather than the preceding entry's, because the preceding
// entry is an end-of-phase rotation with no bets whose own seed is never revealed in the
// capture (seeds 61, 82, 85, 97; 114 ends the capture). A property of the capture, not a free
// skip. The shipped capture script does not contain that end-of-phase rotation (MANIFEST.md,
// Seed entries).
export const EXPECTED_PHASE_BOUNDARY_SKIPS = 4;

// Forward commitment links: seeds[i].nextServerSeedHash === seeds[i+1].serverSeedHashed.
export const EXPECTED_CHAIN_LINKS = EXPECTED_SEEDS - 1;

// Nonce gaps left by the capture: two epochs of 49 bets, each missing one nonce inside 0..49
// (the capture retried a request and the platform had already consumed the nonce). A property
// of the capture plan, disclosed as a capture-origin FLAG by step 4 — and a different number of
// gaps means a different dataset, which FAILs.
export const EXPECTED_CAPTURE_RETRY_GAPS = 2;

// Every captured bet carries effective_edge on both its deal and its draw response, and the
// published figure is 0.1 (per cent) on every one of them. Compared exactly — it is the tier-0
// value, constant across this capture because every captured bet was priced at tier 0, not a
// measurement.
export const EXPECTED_EFFECTIVE_EDGE = 0.1;

// Phase E's hold patterns, from the capture plan (capture/capture.reference.js holdSystematic): eight
// patterns x 100 bets, keyed by the POSITIONS held in the initial hand — none, each single
// position 0..4, positions 0+2, and all five. Pinned whole, because the old "at least 3 distinct
// hold counts" passed on any subset of this capture that kept three of them.
export const EXPECTED_PHASE_E_HOLD_PATTERNS: Readonly<Record<string, number>> =
  Object.freeze({ 'none': 100, '0': 100, '1': 100, '2': 100, '3': 100, '4': 100, '0+2': 100, '0+1+2+3+4': 100 });

/** Positions (0..4) of the initial hand that a bet held, as a canonical key: "none", "0+2", ... */
export function holdPatternKey(bet: VideoPokerBet): string {
  const initial = bet.draw.response.initial_cards ?? [];
  const pos = bet.draw.response.held_cards.map(c => initial.indexOf(c)).sort((a, b) => a - b);
  return pos.length === 0 ? 'none' : pos.join('+');
}

// Bets sampled for the client-seed influence probe. A full 52-card permutation has 52!
// arrangements, so two distinct client seeds colliding is not a scenario that arises: every
// sampled bet must change, with no percentage threshold.
export const CLIENT_SEED_SAMPLE = 500;

// ── PAYTABLE CONFIG PIN (added 2026-09-26, profile VP-26) ─────────────────────────────────
// videoPokerConfig.json is read by the derivation (Steps 8, 11, 16) and was pinned only
// indirectly: its hash is recorded inside outputs/optimal-play-rtp.json and compared by Step 26.
// It is now pinned here beside the dataset, checked by the pre-flight (abort before any step)
// and re-asserted by Step 14. The value is the MANIFEST.md figure, re-measured 2026-09-26.
const CONFIG_PATH = path.join(__dirname, '../videoPokerConfig.json');
export const EXPECTED_CONFIG_HASH = '9daedc8fc7a53e328d50b5e8019c177b32d5bf7992494a7da18136f524a70542';

export function checkConfigHash(): { expected: string; actual: string; match: boolean } {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(CONFIG_PATH)).digest('hex');
  return { expected: EXPECTED_CONFIG_HASH, actual, match: actual === EXPECTED_CONFIG_HASH };
}

// Paytable order, best hand first (profile VP-14): the multipliers must be non-increasing along it.
export const PAYTABLE_ORDER: readonly string[] = Object.freeze([
  'royal_flush', 'straight_flush', 'four_of_a_kind', 'full_house', 'flush',
  'straight', 'three_of_a_kind', 'two_pair', 'jacks_or_better', 'none',
]);

// ── PUBLISHED HEADLINE ANCHORS (moved out of Step 26 on 2026-09-26, conformance C-03) ────────────
// Step 26 asserts the pinned optimal-play artifact against these published figures. They were typed
// inside the step; a figure the step is scored against belongs beside the other constants of record.
export const PUBLISHED_OPTIMAL_RTP_PCT = 99.900000;   // headline optimal-play RTP, per cent
export const PUBLISHED_REFERENCE_96_RTP_PCT = 99.543904; // standard 9/6 Jacks or Better, per cent
export const RTP_ANCHOR_TOL_PP = 0.0001;               // percentage points
export const C52_5 = 2_598_960;
export const CANONICAL_CLASSES = 134_459;

// Live-sample informational items (tests/steps/statistical.ts, not scored): the serial-independence
// items are printed only when Phase B has at least this many bets. A floor, so it lives here (C-03).
export const LIVE_SERIAL_MIN_SAMPLE = 50;

// Simulation re-derivation (tests/steps/simulation.ts, added 2026-09-26): the design constants the
// shipped rows must reconcile to — src/simulate.ts PASS1_STREAMS × PASS1_ROUNDS_EACH and
// PASS2_NONCES_PER_SEED, and the early window = one epoch of nonces 0..EPOCH_SIZE_CAP-1.
export const SIM_PASS1_STREAMS = 10;
export const SIM_PASS1_ROUNDS_PER_STREAM = 1_000_000;
export const SIM_PASS2_NONCES_PER_SEED = 100_000;
export const SIM_ALPHA = 0.01;
export const SIM_PASS2_SEED_FLAG_ALPHA = 0.05;

// Pass 1 dealt-card census and serial census (profile VP-20, added 2026-09-26): src/simulate.ts counts
// every card at deck positions 0..SIM_CARD_CENSUS_POSITIONS-1 (5 dealt + 5 replacement) and ships the
// 10 × 10 rank-transition counts of the concatenated sequence. The card test is a family of one
// chi-squared per position at family level SIM_ALPHA (Bonferroni); the serial rule is the simulator's
// own: |lag-1 z| < SIM_SERIAL_Z_BOUND and runs p ≥ SIM_ALPHA.
export const SIM_CARD_CENSUS_POSITIONS = 10;
export const SIM_SERIAL_Z_BOUND = 3;
// Pass 2 window census (profile VP-21, added 2026-09-26): nonces 0..SIM_PASS2_NONCES_PER_SEED-1 form
// SIM_PASS2_NONCES_PER_SEED / EPOCH_SIZE_CAP disjoint windows; window 0 is the captured epoch. The
// pre-registered rule: cherry-pick indicated when the rank-sum Z of window 0 among its seed's windows is
// below SIM_PASS2_Z_CRIT (one-sided α 0.001), the rule Duel limbo Step 19 uses.
export const SIM_PASS2_Z_CRIT = -3.0902323061678132;
