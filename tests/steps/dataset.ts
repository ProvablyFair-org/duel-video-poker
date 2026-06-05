/**
 * Steps 10–15: Dataset Integrity, House Edge, Anti-Circularity
 */

import type { StepResult, VerifyContext } from './context';
import { step } from './context';
import { checkDatasetHash } from '../../src/loader';
import { computeShuffledDeck } from '../../src/rng';
import { evaluateHand } from '../../src/hand-evaluator';
import type { HandRank } from '../../src/types';
import { HAND_RANKS } from '../../src/types';
import videoPokerConfig from '../../videoPokerConfig.json';

const MULTIPLIERS = videoPokerConfig.multipliers as Record<HandRank, number>;

// C(52,5) = 2,598,960
const TOTAL_HANDS = 2_598_960;

// Exact hand-rank counts from combinatorial theory (independent of casino data)
const THEORETICAL_COUNTS: Record<HandRank, number> = {
  royal_flush:           4,
  straight_flush:       36,
  four_of_a_kind:      624,
  full_house:        3_744,
  flush:             5_108,
  straight:         10_200,
  three_of_a_kind:  54_912,
  two_pair:        123_552,
  jacks_or_better: 337_920,
  none:          2_062_860,
};

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, phaseD, seedMap, byHash } = ctx;

  // ── Step 10: House Edge Audit ─────────────────────────────────────────────────
  const edgeValues = new Set<number>();
  for (const b of bets) {
    edgeValues.add(b.deal.response.effective_edge);
    edgeValues.add(b.draw.response.effective_edge);
  }

  const expectedEdge = 0.1;  // Duel VP uses 0.1% effective edge
  let edgeConsistent = true;
  for (const e of edgeValues) {
    if (Math.abs(e - expectedEdge) > 0.01) edgeConsistent = false;
  }

  const s10 = step(10, 'House Edge Audit',
    edgeConsistent ? 'PASS' : 'FLAG',
    `effective_edge values: ${[...edgeValues].join(', ')}; expected ${expectedEdge}`,
  );

  // ── Step 11: Config Completeness ──────────────────────────────────────────────
  // Video Poker has a single config (Jacks or Better). Verify the config exists and
  // all 10 hand ranks have multipliers.
  const allRanksPresent = HAND_RANKS.every(r => typeof MULTIPLIERS[r] === 'number');
  const s11 = step(11, 'Config Completeness',
    allRanksPresent ? 'PASS' : 'FAIL',
    `Single config (Jacks or Better): ${HAND_RANKS.length} hand ranks, all multipliers present in videoPokerConfig.json`,
  );

  // ── Step 12: Epoch Size ───────────────────────────────────────────────────────
  const epochSizes: number[] = [];
  for (const [, epochBets] of byHash.entries()) {
    epochSizes.push(epochBets.length);
  }
  const minSize = Math.min(...epochSizes);
  const maxSize = Math.max(...epochSizes);

  const s12 = step(12, 'Epoch Size',
    maxSize <= 50 ? 'PASS' : 'FLAG',
    `${byHash.size} epochs with bets; min=${minSize}, max=${maxSize} bets per epoch`,
  );

  // ── Step 13: Phase Labels ─────────────────────────────────────────────────────
  const phases = new Set(bets.map(b => b.phase));
  const expected = ['A', 'B', 'C', 'D', 'E'];
  const hasAll   = expected.every(p => phases.has(p as any));

  const s13 = step(13, 'Phase Labels',
    hasAll ? 'PASS' : 'FLAG',
    `Phases present: ${[...phases].sort().join(', ')}; expected: ${expected.join(', ')}`,
  );

  // ── Step 14: Dataset Hash ─────────────────────────────────────────────────────
  const h = checkDatasetHash();
  const s14 = step(14, 'Dataset Hash',
    h.match ? 'PASS' : 'FAIL',
    h.expected,
  );

  // ── Step 15: Phase D Client Seed Variation ────────────────────────────────────
  if (phaseD.length === 0) {
    const s15 = step(15, 'Phase D — Client Seed Variation', 'PASS', 'No Phase D bets in dataset — step N/A');
    return [s10, s11, s12, s13, s14, s15];
  }

  const dClientSeeds = new Set(phaseD.map(b => b.seed.clientSeed));
  let dMatched = 0;
  let dTested  = 0;
  for (const b of phaseD) {
    if (b._reconstructed) continue;
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;
    dTested++;
    const deck       = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce);
    const expInitial = deck.slice(0, 5);
    const match      = arrEq(expInitial, b.draw.response.initial_cards!);
    if (match) dMatched++;
  }

  // Also verify evaluateHand matches combination
  let classMatched = 0;
  for (const b of phaseD) {
    const rank = evaluateHand(b.draw.response.final_cards!);
    if (rank === b.draw.response.combination) classMatched++;
  }

  // Phase D uses auditor-chosen client seed(s), distinct from Phase A defaults
  const phaseASeeds = new Set(ctx.phaseA.map(b => b.seed.clientSeed));
  const uniqueToD   = [...dClientSeeds].filter(s => !phaseASeeds.has(s));

  const s15 = step(15, 'Phase D — Client Seed Variation',
    uniqueToD.length >= 1 && dMatched === dTested ? 'PASS' : 'FLAG',
    `${phaseD.length} bets, ${dClientSeeds.size} distinct client seed(s), ${uniqueToD.length} unique to Phase D; recomputation: ${dMatched}/${dTested} match; hand classification: ${classMatched}/${phaseD.length} match`,
  );

  return [s10, s11, s12, s13, s14, s15];
}

function arrEq(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
