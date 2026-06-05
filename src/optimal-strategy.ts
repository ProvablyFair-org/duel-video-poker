import { ALL_CARDS, HAND_SIZE } from './rng';
import { evaluateHand } from './hand-evaluator';
import type { HandRank } from './types';

/**
 * Optimal-strategy engine for Jacks or Better.
 *
 * Given:
 *   - initial 5-card hand
 *   - pay table (multiplier per HandRank)
 *
 * Computes: the hold subset (one of 2^5 = 32 possible patterns) that maximizes
 * the expected multiplier returned to the player.
 *
 * Method (direct enumeration — no heuristic tables):
 *   for each of 32 hold patterns:
 *     kept = the held cards
 *     drawCount = 5 - kept.length
 *     enumerate every C(47, drawCount) combination of replacement cards from
 *       the 47-card remaining deck (52 total − 5 dealt)
 *     for each replacement combination:
 *       build full hand, evaluate, accumulate weighted multiplier
 *   return the hold pattern with the highest expected multiplier
 *
 * Enumeration sizes per hold pattern (perfect tractability):
 *   hold 0: C(47,5) = 1,533,939 combinations
 *   hold 1: C(47,4) =   178,365
 *   hold 2: C(47,3) =    16,215
 *   hold 3: C(47,2) =     1,081
 *   hold 4: C(47,1) =        47
 *   hold 5: 1
 *
 * Total evaluations to pick one hand's strategy: ~1.73M × 32 patterns / 6 sizes
 * — but we only enumerate one pattern's replacements at a time, and across all
 * 32 patterns for ONE dealt hand the total is: 32 ≤ patterns; 1 pattern’s cost
 * = enumeration of its drawCount. Sum across 32 patterns is at most
 * 1,533,939 (pattern={hold 0}, 1 time) + 5 × 178,365 (hold 1 across 5 patterns)
 * + 10 × 16,215 + 10 × 1,081 + 5 × 47 + 1 ≈ 2.6M evaluations per hand.
 *
 * This is the cost per HAND in the anti-circularity step. Simulation calls this
 * per round, so simulate.ts uses this module at scale: ~2.6M evals × 10M rounds
 * is impractical — strategy for simulation uses a per-hand cached decision
 * (since the same 5-card deal always has the same optimal hold).
 */

export type HoldPattern = boolean[]; // length 5, true = keep card at that position

export interface StrategyDecision {
  heldCards:          string[];   // subset of initialCards, preserving position order
  holdPattern:        HoldPattern;
  expectedMultiplier: number;     // EV under optimal play, in multiplier units
}

/**
 * Enumerate all 32 hold patterns, pick the one with the highest expected multiplier.
 * `multipliers` must have an entry for every HandRank (including `none: 0`).
 */
export function bestHold(
  initialCards: readonly string[],
  multipliers:  Readonly<Record<HandRank, number>>,
): StrategyDecision {
  if (initialCards.length !== HAND_SIZE) {
    throw new Error(`initialCards must have ${HAND_SIZE} entries`);
  }

  // Build the 47-card remaining deck once per call.
  const dealtSet: Set<string> = new Set(initialCards);
  const remaining: string[] = [];
  for (const c of ALL_CARDS) if (!dealtSet.has(c)) remaining.push(c);
  if (remaining.length !== 47) throw new Error('remaining deck size must be 47');

  let bestEV: number = -Infinity;
  let bestPattern: HoldPattern = [false, false, false, false, false];

  for (let mask = 0; mask < 32; mask++) {
    const pattern: HoldPattern = [
      (mask & 1)  !== 0,
      (mask & 2)  !== 0,
      (mask & 4)  !== 0,
      (mask & 8)  !== 0,
      (mask & 16) !== 0,
    ];
    const ev = expectedMultiplier(initialCards, pattern, remaining, multipliers);
    if (ev > bestEV) {
      bestEV = ev;
      bestPattern = pattern;
    }
  }

  const heldCards: string[] = [];
  for (let i = 0; i < HAND_SIZE; i++) {
    if (bestPattern[i]) heldCards.push(initialCards[i]);
  }

  return { heldCards, holdPattern: bestPattern, expectedMultiplier: bestEV };
}

/**
 * Expected multiplier for one hold pattern against the given initial hand and
 * remaining 47-card deck. Enumerates all C(47, drawCount) replacement draws
 * and averages the resulting hand rank multipliers.
 */
export function expectedMultiplier(
  initialCards: readonly string[],
  holdPattern:  readonly boolean[],
  remaining:    readonly string[],
  multipliers:  Readonly<Record<HandRank, number>>,
): number {
  // Positions to replace (indices into initialCards where holdPattern === false)
  const replacePositions: number[] = [];
  for (let i = 0; i < HAND_SIZE; i++) {
    if (!holdPattern[i]) replacePositions.push(i);
  }
  const drawCount = replacePositions.length;

  // If drawCount === 0, the final hand IS the initial hand — single outcome.
  if (drawCount === 0) {
    return multipliers[evaluateHand(initialCards)];
  }

  let totalMult = 0;
  let combos    = 0;

  const hand: string[] = [...initialCards];

  // Enumerate C(47, drawCount) combinations by index. For each, write the drawn
  // cards into replacePositions (in index order), evaluate the 5-card hand, and
  // accumulate the resulting multiplier.
  const idx = new Array<number>(drawCount).fill(0);
  for (let d = 0; d < drawCount; d++) idx[d] = d;

  while (true) {
    for (let d = 0; d < drawCount; d++) {
      hand[replacePositions[d]] = remaining[idx[d]];
    }
    totalMult += multipliers[evaluateHand(hand)];
    combos++;

    // Advance the combination index (standard lexicographic combinations).
    let k = drawCount - 1;
    while (k >= 0 && idx[k] === remaining.length - drawCount + k) k--;
    if (k < 0) break;
    idx[k]++;
    for (let j = k + 1; j < drawCount; j++) idx[j] = idx[j - 1] + 1;
  }

  // Restore the initial hand (not strictly required since we reassign above, but safe).
  for (const p of replacePositions) hand[p] = initialCards[p];

  return totalMult / combos;
}

/**
 * Convenience: return just the held-cards list for a dealt hand — this is what
 * the capture script would send as `held_cards` in the draw request if playing
 * optimally.
 */
export function optimalHold(
  initialCards: readonly string[],
  multipliers:  Readonly<Record<HandRank, number>>,
): string[] {
  return bestHold(initialCards, multipliers).heldCards;
}
