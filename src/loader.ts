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
// The capture plan, stated as CODE so a shrunken dataset cannot pass by agreeing with
// itself. Deleting rounds and doctoring the header to match leaves a file that is
// internally consistent and re-pins cleanly — and re-pinning is exactly what a forger
// does, so EXPECTED_HASH cannot see it. The counts have to be asserted from somewhere
// the dataset does not control, and a step that finds them wrong must HARD FAIL.
export const EXPECTED_BETS  = 5400;
export const EXPECTED_SEEDS = 115;
export const EXPECTED_PHASE_BETS: Readonly<Record<string, number>> =
  Object.freeze({ A: 3000, B: 1000, C: 100, D: 500, E: 800 });
