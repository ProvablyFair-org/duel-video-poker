/**
 * Optimal-Play RTP Engine — Pre-Aggregated Inclusion-Exclusion
 *
 * Wizard of Odds methodology:
 *   1. Score all C(52,5) hands into a lookup table
 *   2. Pre-aggregate multiplier sums for all k-card subsets (k=0..5)
 *      - For a given k-card set S, aggregate = sum of multipliers across all
 *        C(52-k, 5-k) hands that contain S as a subset
 *   3. For each dealt hand, compute each hold pattern's EV via inclusion-exclusion:
 *      - Start with the pre-aggregated sum for the held cards
 *      - Subtract contributions from hands containing any dealt-but-discarded card
 *        (those cards aren't in the draw pool)
 *      - The result equals the sum over only the C(47, 5-k) valid draw combos
 *   4. Pick the hold with max EV → that hand's optimal play
 *
 * This reduces 2.77 trillion table lookups to ~85M additions.
 *
 * Run: npm run compute-optimal-rtp
 * Output: outputs/optimal-play-rtp.json
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

type HandRank =
  | 'royal_flush' | 'straight_flush' | 'four_of_a_kind' | 'full_house'
  | 'flush' | 'straight' | 'three_of_a_kind' | 'two_pair'
  | 'jacks_or_better' | 'none';

const HAND_RANKS: HandRank[] = [
  'royal_flush', 'straight_flush', 'four_of_a_kind', 'full_house',
  'flush', 'straight', 'three_of_a_kind', 'two_pair',
  'jacks_or_better', 'none',
];

// ── Binomial coefficients ────────────────────────────────────────────────────

const BINOM: number[][] = [];
for (let n = 0; n <= 52; n++) {
  BINOM[n] = [];
  for (let k = 0; k <= 5; k++) {
    if (k === 0 || n === k) BINOM[n][k] = 1;
    else if (k > n) BINOM[n][k] = 0;
    else BINOM[n][k] = BINOM[n - 1][k - 1] + BINOM[n - 1][k];
  }
}

const TOTAL_5 = BINOM[52][5]; // 2,598,960

// ── Combinatorial index for k-card combos ────────────────────────────────────
// Maps sorted combo (a < b < c < ...) → unique integer via combinatorial number system

function idx1(a: number): number { return a; }
function idx2(a: number, b: number): number { return BINOM[a][1] + BINOM[b][2]; }
function idx3(a: number, b: number, c: number): number { return BINOM[a][1] + BINOM[b][2] + BINOM[c][3]; }
function idx4(a: number, b: number, c: number, d: number): number { return BINOM[a][1] + BINOM[b][2] + BINOM[c][3] + BINOM[d][4]; }
function idx5(a: number, b: number, c: number, d: number, e: number): number { return BINOM[a][1] + BINOM[b][2] + BINOM[c][3] + BINOM[d][4] + BINOM[e][5]; }

// ── Fast hand evaluator → rank index 0-9 ────────────────────────────────────

function fastEval(c0: number, c1: number, c2: number, c3: number, c4: number): number {
  const r0 = c0 >> 2, r1 = c1 >> 2, r2 = c2 >> 2, r3 = c3 >> 2, r4 = c4 >> 2;
  const counts = [0,0,0,0,0,0,0,0,0,0,0,0,0];
  counts[r0]++; counts[r1]++; counts[r2]++; counts[r3]++; counts[r4]++;

  let max1 = 0, max2 = 0;
  for (let i = 0; i < 13; i++) {
    if (counts[i] > max1) { max2 = max1; max1 = counts[i]; }
    else if (counts[i] > max2) { max2 = counts[i]; }
  }

  const isFlush = (c0 & 3) === (c1 & 3) && (c1 & 3) === (c2 & 3) && (c2 & 3) === (c3 & 3) && (c3 & 3) === (c4 & 3);

  let s0 = r0, s1 = r1, s2 = r2, s3 = r3, s4 = r4;
  if (s0 > s1) { const t = s0; s0 = s1; s1 = t; }
  if (s3 > s4) { const t = s3; s3 = s4; s4 = t; }
  if (s0 > s2) { const t = s0; s0 = s2; s2 = t; }
  if (s1 > s3) { const t = s1; s1 = s3; s3 = t; }
  if (s0 > s1) { const t = s0; s0 = s1; s1 = t; }
  if (s2 > s4) { const t = s2; s2 = s4; s4 = t; }
  if (s1 > s2) { const t = s1; s1 = s2; s2 = t; }
  if (s3 > s4) { const t = s3; s3 = s4; s4 = t; }
  if (s2 > s3) { const t = s2; s2 = s3; s3 = t; }

  const isStraightHigh = max1 === 1 && (s4 - s0 === 4);
  const isWheel = max1 === 1 && s0 === 0 && s1 === 1 && s2 === 2 && s3 === 3 && s4 === 12;
  const isStraight = isStraightHigh || isWheel;

  if (isFlush && isStraightHigh && s0 === 8) return 0;
  if (isFlush && isStraight) return 1;
  if (max1 === 4) return 2;
  if (max1 === 3 && max2 === 2) return 3;
  if (isFlush) return 4;
  if (isStraight) return 5;
  if (max1 === 3) return 6;
  if (max1 === 2 && max2 === 2) return 7;
  if (max1 === 2) { for (let i = 9; i <= 12; i++) if (counts[i] === 2) return 8; }
  return 9;
}

// ── Step 1: Build score table ────────────────────────────────────────────────

function buildScoreTable(): Uint8Array {
  const t0 = Date.now();
  const table = new Uint8Array(TOTAL_5);
  for (let c0 = 0; c0 < 48; c0++)
    for (let c1 = c0+1; c1 < 49; c1++)
      for (let c2 = c1+1; c2 < 50; c2++)
        for (let c3 = c2+1; c3 < 51; c3++)
          for (let c4 = c3+1; c4 < 52; c4++)
            table[idx5(c0,c1,c2,c3,c4)] = fastEval(c0,c1,c2,c3,c4);

  // Sanity check
  const dist = new Array(10).fill(0);
  for (let i = 0; i < TOTAL_5; i++) dist[table[i]]++;
  const expected = [4, 36, 624, 3744, 5108, 10200, 54912, 123552, 337920, 2062860];
  for (let i = 0; i < 10; i++) {
    if (dist[i] !== expected[i]) { console.error(`MISMATCH: ${HAND_RANKS[i]} ${dist[i]} vs ${expected[i]}`); process.exit(1); }
  }
  console.log(`  Score table: ${((Date.now()-t0)/1000).toFixed(1)}s — distribution PASS`);
  return table;
}

// ── Step 2: Build pre-aggregated multiplier sums ─────────────────────────────
//
// For each k-card subset S of the 52-card deck, compute:
//   agg_k[idx_k(S)] = sum of multiplier[score[H]] for all 5-card hands H ⊇ S
//
// agg_0 = sum across ALL C(52,5) hands (a single number)
// agg_1[c] = sum across all C(51,4) hands containing card c
// agg_2[idx2(a,b)] = sum across all C(50,3) hands containing cards a,b
// etc.

function buildAggregates(scoreTable: Uint8Array, mults: number[]): {
  agg0: number;
  agg1: Float64Array;
  agg2: Float64Array;
  agg3: Float64Array;
  agg4: Float64Array;
} {
  const t0 = Date.now();

  const agg0_val = { sum: 0 };
  const agg1 = new Float64Array(52);
  const agg2 = new Float64Array(BINOM[52][2]);
  const agg3 = new Float64Array(BINOM[52][3]);
  const agg4 = new Float64Array(BINOM[52][4]);

  // Single pass over all C(52,5) hands
  for (let c0 = 0; c0 < 48; c0++) {
    for (let c1 = c0+1; c1 < 49; c1++) {
      for (let c2 = c1+1; c2 < 50; c2++) {
        for (let c3 = c2+1; c3 < 51; c3++) {
          for (let c4 = c3+1; c4 < 52; c4++) {
            const m = mults[scoreTable[idx5(c0,c1,c2,c3,c4)]];

            agg0_val.sum += m;

            // 1-card subsets (5 per hand)
            agg1[c0] += m; agg1[c1] += m; agg1[c2] += m; agg1[c3] += m; agg1[c4] += m;

            // 2-card subsets (10 per hand)
            agg2[idx2(c0,c1)] += m; agg2[idx2(c0,c2)] += m; agg2[idx2(c0,c3)] += m; agg2[idx2(c0,c4)] += m;
            agg2[idx2(c1,c2)] += m; agg2[idx2(c1,c3)] += m; agg2[idx2(c1,c4)] += m;
            agg2[idx2(c2,c3)] += m; agg2[idx2(c2,c4)] += m;
            agg2[idx2(c3,c4)] += m;

            // 3-card subsets (10 per hand)
            agg3[idx3(c0,c1,c2)] += m; agg3[idx3(c0,c1,c3)] += m; agg3[idx3(c0,c1,c4)] += m;
            agg3[idx3(c0,c2,c3)] += m; agg3[idx3(c0,c2,c4)] += m; agg3[idx3(c0,c3,c4)] += m;
            agg3[idx3(c1,c2,c3)] += m; agg3[idx3(c1,c2,c4)] += m; agg3[idx3(c1,c3,c4)] += m;
            agg3[idx3(c2,c3,c4)] += m;

            // 4-card subsets (5 per hand)
            agg4[idx4(c0,c1,c2,c3)] += m; agg4[idx4(c0,c1,c2,c4)] += m;
            agg4[idx4(c0,c1,c3,c4)] += m; agg4[idx4(c0,c2,c3,c4)] += m;
            agg4[idx4(c1,c2,c3,c4)] += m;
          }
        }
      }
    }
  }

  console.log(`  Aggregates: ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return { agg0: agg0_val.sum, agg1, agg2, agg3, agg4 };
}

// ── Step 3: Compute optimal EV per dealt hand via inclusion-exclusion ────────
//
// For hold pattern keeping cards K ⊂ {c0..c4} and discarding D = {c0..c4} \ K:
//   EV(K) = (1/C(47, 5-|K|)) × Σ mult[score[H]] for all 5-card H where K ⊂ H and H ∩ D = ∅
//
// By inclusion-exclusion on the discarded cards:
//   Σ_valid = agg_|K|(K) - Σ_i agg_{|K|+1}(K∪{d_i}) + Σ_{i<j} agg_{|K|+2}(K∪{d_i,d_j}) - ...
//
// This replaces C(47,5-|K|) lookups with at most 2^|D| additions.

function countBits(n: number): number { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; }

// ── Canonical hand class ─────────────────────────────────────────────────────
// Two hands are in the same S_4 orbit (suit permutation equivalence).
// Standard count: 134,459 classes for C(52,5).
// Method: try all 24 suit permutations, sort each result, pick lexicographic minimum.

const SUIT_PERMS: number[][] = (() => {
  // All 24 permutations of [0,1,2,3]
  const perms: number[][] = [];
  const vals = [0,1,2,3];
  function gen(arr: number[], start: number) {
    if (start === arr.length) { perms.push([...arr]); return; }
    for (let i = start; i < arr.length; i++) {
      [arr[start], arr[i]] = [arr[i], arr[start]];
      gen(arr, start + 1);
      [arr[start], arr[i]] = [arr[i], arr[start]];
    }
  }
  gen(vals, 0);
  return perms;
})();

function canonicalKey(c0: number, c1: number, c2: number, c3: number, c4: number): string {
  const cards = [c0, c1, c2, c3, c4];
  let bestKey = '';

  for (const perm of SUIT_PERMS) {
    // Apply suit permutation: new_card = rank*4 + perm[old_suit]
    const mapped = cards.map(c => (c >> 2) * 4 + perm[c & 3]);
    mapped.sort((a, b) => a - b);
    const key = mapped.join(',');
    if (bestKey === '' || key < bestKey) bestKey = key;
  }

  return bestKey;
}

interface HandClass {
  key: string;
  example: number[];       // one representative hand [c0..c4]
  count: number;           // how many raw hands map to this class
  optimalEV: number;       // EV under optimal play
  optimalHoldMask: number; // which hold pattern was optimal (bitmask)
  optimalHoldCount: number;// how many cards held
}

function computeOptimalRTP(
  scoreTable: Uint8Array,
  mults: number[],
  agg: { agg0: number; agg1: Float64Array; agg2: Float64Array; agg3: Float64Array; agg4: Float64Array },
  label: string,
): { rtp: number; elapsed: number; breakdown: Record<string, number>; classes: Map<string, HandClass> } {
  const t0 = Date.now();

  // Canonical hand class tracking
  const classes = new Map<string, HandClass>();

  let totalEV = 0;
  let count = 0;

  for (let c0 = 0; c0 < 48; c0++) {
    for (let c1 = c0+1; c1 < 49; c1++) {
      for (let c2 = c1+1; c2 < 50; c2++) {
        for (let c3 = c2+1; c3 < 51; c3++) {
          for (let c4 = c3+1; c4 < 52; c4++) {
            const hand = [c0, c1, c2, c3, c4];
            let bestEV = -Infinity;
            let bestMask = 0;

            // ── Hold 0 (discard all 5): EV = agg0 minus hands containing any dealt card
            {
              // Inclusion-exclusion: subtract 1-subsets, add 2-subsets, subtract 3-subsets, etc.
              let sum = agg.agg0;
              // Subtract singles
              sum -= agg.agg1[c0] + agg.agg1[c1] + agg.agg1[c2] + agg.agg1[c3] + agg.agg1[c4];
              // Add pairs
              sum += agg.agg2[idx2(c0,c1)] + agg.agg2[idx2(c0,c2)] + agg.agg2[idx2(c0,c3)] + agg.agg2[idx2(c0,c4)];
              sum += agg.agg2[idx2(c1,c2)] + agg.agg2[idx2(c1,c3)] + agg.agg2[idx2(c1,c4)];
              sum += agg.agg2[idx2(c2,c3)] + agg.agg2[idx2(c2,c4)];
              sum += agg.agg2[idx2(c3,c4)];
              // Subtract triples
              sum -= agg.agg3[idx3(c0,c1,c2)] + agg.agg3[idx3(c0,c1,c3)] + agg.agg3[idx3(c0,c1,c4)];
              sum -= agg.agg3[idx3(c0,c2,c3)] + agg.agg3[idx3(c0,c2,c4)] + agg.agg3[idx3(c0,c3,c4)];
              sum -= agg.agg3[idx3(c1,c2,c3)] + agg.agg3[idx3(c1,c2,c4)] + agg.agg3[idx3(c1,c3,c4)];
              sum -= agg.agg3[idx3(c2,c3,c4)];
              // Add quads
              sum += agg.agg4[idx4(c0,c1,c2,c3)] + agg.agg4[idx4(c0,c1,c2,c4)];
              sum += agg.agg4[idx4(c0,c1,c3,c4)] + agg.agg4[idx4(c0,c2,c3,c4)];
              sum += agg.agg4[idx4(c1,c2,c3,c4)];
              // Subtract the dealt hand itself (5-subset)
              sum -= mults[scoreTable[idx5(c0,c1,c2,c3,c4)]];

              const ev = sum / BINOM[47][5];
              if (ev > bestEV) { bestEV = ev; bestMask = 0; }
            }

            // ── Hold 5 (pat): single lookup
            {
              const ev = mults[scoreTable[idx5(c0,c1,c2,c3,c4)]];
              if (ev > bestEV) { bestEV = ev; bestMask = 31; }
            }

            // ── Hold 4 (5 patterns): discard 1 card
            for (let drop = 0; drop < 5; drop++) {
              const kept = [];
              const disc = [];
              for (let i = 0; i < 5; i++) { if (i === drop) disc.push(hand[i]); else kept.push(hand[i]); }
              const d = disc[0];

              // agg4(kept) - agg5(kept ∪ d) = agg4(kept) - mult[score[dealt hand]]
              let sum = agg.agg4[idx4(kept[0], kept[1], kept[2], kept[3])];
              sum -= mults[scoreTable[idx5(c0,c1,c2,c3,c4)]]; // the dealt hand contains both kept and d

              const ev = sum / BINOM[47][1]; // 47
              if (ev > bestEV) { bestEV = ev; bestMask = 31 ^ (1 << drop); }
            }

            // ── Hold 3 (10 patterns): discard 2 cards
            for (let d0 = 0; d0 < 4; d0++) {
              for (let d1 = d0+1; d1 < 5; d1++) {
                const kept: number[] = [];
                const disc: number[] = [];
                for (let i = 0; i < 5; i++) { if (i === d0 || i === d1) disc.push(hand[i]); else kept.push(hand[i]); }

                let sum = agg.agg3[idx3(kept[0], kept[1], kept[2])];
                const kd0 = [kept[0], kept[1], kept[2], disc[0]].sort((a,b) => a-b);
                const kd1 = [kept[0], kept[1], kept[2], disc[1]].sort((a,b) => a-b);
                sum -= agg.agg4[idx4(kd0[0], kd0[1], kd0[2], kd0[3])];
                sum -= agg.agg4[idx4(kd1[0], kd1[1], kd1[2], kd1[3])];
                sum += mults[scoreTable[idx5(c0,c1,c2,c3,c4)]];

                const ev = sum / BINOM[47][2];
                const holdMask = 31 ^ ((1 << d0) | (1 << d1));
                if (ev > bestEV) { bestEV = ev; bestMask = holdMask; }
              }
            }

            // ── Hold 2 (10 patterns): discard 3 cards
            for (let k0 = 0; k0 < 4; k0++) {
              for (let k1 = k0+1; k1 < 5; k1++) {
                const kept = [hand[k0], hand[k1]];
                const disc: number[] = [];
                for (let i = 0; i < 5; i++) { if (i !== k0 && i !== k1) disc.push(hand[i]); }

                let sum = agg.agg2[idx2(kept[0], kept[1])];
                for (const d of disc) {
                  const pair = [kept[0], kept[1], d].sort((a,b) => a-b);
                  sum -= agg.agg3[idx3(pair[0], pair[1], pair[2])];
                }
                for (let i = 0; i < 2; i++) {
                  for (let j = i+1; j < 3; j++) {
                    const quad = [kept[0], kept[1], disc[i], disc[j]].sort((a,b) => a-b);
                    sum += agg.agg4[idx4(quad[0], quad[1], quad[2], quad[3])];
                  }
                }
                sum -= mults[scoreTable[idx5(c0,c1,c2,c3,c4)]];

                const ev = sum / BINOM[47][3];
                const holdMask = (1 << k0) | (1 << k1);
                if (ev > bestEV) { bestEV = ev; bestMask = holdMask; }
              }
            }

            // ── Hold 1 (5 patterns): discard 4 cards
            for (let k = 0; k < 5; k++) {
              const kept = hand[k];
              const disc: number[] = [];
              for (let i = 0; i < 5; i++) { if (i !== k) disc.push(hand[i]); }

              let sum = agg.agg1[kept];
              for (const d of disc) {
                const pair = kept < d ? [kept, d] : [d, kept];
                sum -= agg.agg2[idx2(pair[0], pair[1])];
              }
              for (let i = 0; i < 3; i++) {
                for (let j = i+1; j < 4; j++) {
                  const tri = [kept, disc[i], disc[j]].sort((a,b) => a-b);
                  sum += agg.agg3[idx3(tri[0], tri[1], tri[2])];
                }
              }
              for (let i = 0; i < 2; i++) {
                for (let j = i+1; j < 3; j++) {
                  for (let k2 = j+1; k2 < 4; k2++) {
                    const quad = [kept, disc[i], disc[j], disc[k2]].sort((a,b) => a-b);
                    sum -= agg.agg4[idx4(quad[0], quad[1], quad[2], quad[3])];
                  }
                }
              }
              sum += mults[scoreTable[idx5(c0,c1,c2,c3,c4)]];

              const ev = sum / BINOM[47][4];
              if (ev > bestEV) { bestEV = ev; bestMask = 1 << k; }
            }

            // Record canonical class
            const key = canonicalKey(c0, c1, c2, c3, c4);
            const existing = classes.get(key);
            if (existing) {
              existing.count++;
            } else {
              classes.set(key, {
                key,
                example: [c0, c1, c2, c3, c4],
                count: 1,
                optimalEV: bestEV,
                optimalHoldMask: bestMask,
                optimalHoldCount: countBits(bestMask),
              });
            }

            totalEV += bestEV;
            count++;
            if (count % 50000 === 0) {
              const pct = (count/TOTAL_5*100).toFixed(1).padStart(5);
              const el = ((Date.now()-t0)/1000).toFixed(0);
              const eta = ((Date.now()-t0)/count*(TOTAL_5-count)/1000).toFixed(0);
              process.stdout.write(`\r  ${pct}% │ ${count.toLocaleString()}/${TOTAL_5.toLocaleString()} │ ${label} │ ${el}s · ~${eta}s left`);
            }
          }
        }
      }
    }
  }
  process.stdout.write('\r\x1b[K');

  const rtp = totalEV / TOTAL_5;
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`  ${label}: RTP = ${(rtp * 100).toFixed(6)}% (${elapsed.toFixed(1)}s)`);

  // Verify class counts sum to total
  let classSum = 0;
  for (const [, cl] of classes) classSum += cl.count;
  console.log(`  Canonical classes: ${classes.size.toLocaleString()} (hands covered: ${classSum.toLocaleString()})`);

  return { rtp, elapsed, breakdown: {}, classes };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═'.repeat(66));
  console.log('  OPTIMAL-PLAY RTP ENGINE — INCLUSION-EXCLUSION');
  console.log('  C(52,5) = 2,598,960 dealt hands × 32 hold patterns');
  console.log('═'.repeat(66));
  console.log();

  // Step 1: Score table
  console.log('Step 1: Score table');
  const scoreTable = buildScoreTable();

  // Pay tables
  const standard96: Record<HandRank, number> = {
    royal_flush: 800, straight_flush: 50, four_of_a_kind: 25,
    full_house: 9, flush: 6, straight: 4, three_of_a_kind: 3,
    two_pair: 2, jacks_or_better: 1, none: 0,
  };

  const configPath = path.join(__dirname, '../videoPokerConfig.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const duelPayTable: Record<HandRank, number> = config.multipliers;
  const configHash = crypto.createHash('sha256').update(fs.readFileSync(configPath)).digest('hex');

  // ── Pass 1: Standard 9/6 ──────────────────────────────────────────────
  console.log('\nStep 2: Aggregates (Pass 1 — Standard 9/6)');
  const mults96 = HAND_RANKS.map(r => standard96[r]);
  const agg96 = buildAggregates(scoreTable, mults96);

  console.log('\nPass 1 — Standard 9/6 Jacks or Better');
  console.log('  Target: 99.5439% (±0.0001%)\n');
  const pass1 = computeOptimalRTP(scoreTable, mults96, agg96, 'Standard 9/6');

  const target = 0.995439;
  const tolerance = 0.000001;
  const xvPass = Math.abs(pass1.rtp - target) < tolerance;
  console.log(`  CROSS-VALIDATION: ${xvPass ? 'PASS' : 'FAIL'} (${(pass1.rtp*100).toFixed(6)}% vs ${(target*100).toFixed(4)}%)\n`);

  if (!xvPass) {
    console.log(`  Difference: ${((pass1.rtp - target) * 100).toFixed(6)}%`);
  }

  // ── Pass 2: Duel.com ──────────────────────────────────────────────────
  console.log('Step 3: Aggregates (Pass 2 — Duel.com)');
  const multsDuel = HAND_RANKS.map(r => duelPayTable[r]);
  const aggDuel = buildAggregates(scoreTable, multsDuel);

  console.log('\nPass 2 — Duel.com Video Poker');
  console.log(`  Royal: ${duelPayTable.royal_flush}x | SF: ${duelPayTable.straight_flush}x | 4K: ${duelPayTable.four_of_a_kind}x\n`);
  const pass2 = computeOptimalRTP(scoreTable, multsDuel, aggDuel, 'Duel.com');

  // ── Write artifact ────────────────────────────────────────────────────
  const outDir = path.join(__dirname, '../outputs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Summarize canonical classes for the Duel pass
  const classSummary = {
    totalClasses: pass2.classes.size,
    holdDistribution: {} as Record<number, number>, // holdCount → number of classes
  };
  for (const [, cl] of pass2.classes) {
    classSummary.holdDistribution[cl.optimalHoldCount] = (classSummary.holdDistribution[cl.optimalHoldCount] || 0) + cl.count;
  }

  // Top 20 most common classes by count
  const topClasses = [...pass2.classes.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map(cl => ({
      key: cl.key,
      count: cl.count,
      optimalEV: cl.optimalEV,
      optimalHoldCount: cl.optimalHoldCount,
    }));

  const artifact = {
    generatedAt: new Date().toISOString(),
    totalHands: TOTAL_5,
    crossValidation: {
      payTable: standard96,
      rtp: pass1.rtp,
      rtpPercent: (pass1.rtp*100).toFixed(6),
      target, tolerance,
      pass: xvPass,
      elapsed: pass1.elapsed,
      canonicalClasses: pass1.classes.size,
    },
    duel: {
      payTable: duelPayTable,
      payTableHash: configHash,
      rtp: pass2.rtp,
      rtpPercent: (pass2.rtp*100).toFixed(6),
      elapsed: pass2.elapsed,
      canonicalClasses: pass2.classes.size,
      classSummary,
      topClasses,
    },
  };

  fs.writeFileSync(path.join(outDir, 'optimal-play-rtp.json'), JSON.stringify(artifact, null, 2));

  console.log();
  console.log('═'.repeat(66));
  console.log(`  Standard 9/6: ${(pass1.rtp*100).toFixed(6)}% (${xvPass ? 'PASS' : 'FAIL'})`);
  console.log(`  Duel.com:     ${(pass2.rtp*100).toFixed(6)}%`);
  console.log('═'.repeat(66));

  if (!xvPass) { console.error('\n  CROSS-VALIDATION FAILED'); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
