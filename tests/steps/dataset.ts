/**
 * Steps 10–15: Dataset Integrity, House Edge, Anti-Circularity
 */

import type { StepResult, VerifyContext } from './context';
import { step } from './context';
import {
  checkDatasetHash, checkConfigHash, PAYTABLE_ORDER,
  EXPECTED_BETS, EXPECTED_SEEDS, EXPECTED_EPOCHS, EXPECTED_EPOCH_SIZES, EPOCH_SIZE_CAP,
  EXPECTED_PHASE_BETS, EXPECTED_PHASE_SEEDS, EXPECTED_EFFECTIVE_EDGE,
} from '../../src/loader';
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
  // effective_edge is the tier-0 edge Duel reports per bet, on every deal and draw response. The old
  // form could only FLAG, and tolerated |edge − 0.1| ≤ 0.01 — a 10% relative band on a figure
  // that is published to one decimal and compared nothing else. Now every one of the 2 × bets
  // values must equal EXPECTED_EFFECTIVE_EDGE exactly, a missing or non-numeric value is an
  // error, and the count is bound to the population, so a discrepancy FAILs.
  const edgeCounts = new Map<string, number>();
  let edgeChecked = 0, edgeMismatches = 0;
  for (const b of bets) {
    for (const e of [b.deal.response.effective_edge, b.draw.response.effective_edge] as unknown[]) {
      const key = String(e);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      if (typeof e === 'number' && e === EXPECTED_EFFECTIVE_EDGE) edgeChecked++;
      else edgeMismatches++;
    }
  }
  const edgeObserved = Object.fromEntries([...edgeCounts.entries()].sort());
  const s10Issues: string[] = [];
  if (bets.length !== EXPECTED_BETS) s10Issues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (edgeChecked + edgeMismatches !== 2 * bets.length) s10Issues.push(`${edgeChecked + edgeMismatches} edge values != ${2 * bets.length}`);

  const s10 = step(10, 'House Edge Audit',
    edgeMismatches === 0 && s10Issues.length === 0 ? 'PASS' : 'FAIL',
    edgeMismatches > 0
      ? `${edgeMismatches} of ${2 * bets.length} effective_edge values are not ${EXPECTED_EFFECTIVE_EDGE}: observed `
        + Object.entries(edgeObserved).map(([v, n]) => `${v} x${n}`).join(', ')
      : s10Issues.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s10Issues.join('; ')}`
        : `All ${2 * EXPECTED_BETS} effective_edge values (deal and draw response of each of ${EXPECTED_BETS} bets) `
          + `equal ${EXPECTED_EFFECTIVE_EDGE} exactly. This is the tier-0 edge Duel reports per bet; the 99.9000% `
          + `optimal-play RTP comes from the pay table (step 26), not from this field.`,
    { valuesChecked: edgeChecked + edgeMismatches, expectedValues: 2 * EXPECTED_BETS, exactMatches: edgeChecked,
      mismatches: edgeMismatches, expectedEdge: EXPECTED_EFFECTIVE_EDGE, observed: edgeObserved },
  );

  // ── Step 11: Config Completeness & Payout-Cell Coverage ──────────────────────
  // "All ten multipliers are present in the config file" says nothing about whether live play
  // ever exercised them. Video Poker has a single variant, so its payout CELLS are the ten
  // hand ranks — and one of them, royal_flush, is both the largest multiplier in the table and
  // the rarest outcome in the game. The dataset does not contain one. That is not a defect in
  // the capture; it is a limit on what the capture can demonstrate, and the audit has to say so
  // rather than let "config complete" imply otherwise.
  //
  // outputs/payout-coverage.json names every rank live play never produced, with its
  // multiplier and its exact deal-stage probability. The probability is stated at the DEAL
  // stage — the 5-card combinatorics of C(52,5), which is exactly computable and independent of
  // the operator — and is therefore a LOWER bound on how often the rank is reached in play,
  // because a player drawing toward a royal reaches it more often than a straight deal would.
  // The complete pay table is covered analytically by the optimal-play RTP computation.
  const allRanksPresent = HAND_RANKS.every(r => typeof MULTIPLIERS[r] === 'number');
  const missingMultipliers = HAND_RANKS.filter(r => typeof MULTIPLIERS[r] !== 'number');

  const observedRanks: Record<string, number> = {};
  for (const b of bets) {
    const c = b.draw.response.combination as HandRank;
    observedRanks[c] = (observedRanks[c] ?? 0) + 1;
  }

  let dealStageRtpTotal = 0, dealStageRtpUncovered = 0;
  const uncoveredRanks: Array<Record<string, unknown>> = [];
  for (const r of HAND_RANKS) {
    const p    = THEORETICAL_COUNTS[r] / TOTAL_HANDS;
    const mult = MULTIPLIERS[r];
    const rtp  = p * mult;
    dealStageRtpTotal += rtp;
    if ((observedRanks[r] ?? 0) === 0) {
      dealStageRtpUncovered += rtp;
      uncoveredRanks.push({
        rank: r, multiplier: mult,
        dealStageCombinations: THEORETICAL_COUNTS[r],
        dealStageProbability: p,
        dealStageRtpContribution: rtp,
      });
    }
  }
  const uncoveredRtpShare = dealStageRtpTotal > 0 ? dealStageRtpUncovered / dealStageRtpTotal : 0;

  ctx.payoutCoverage = {
    variant: 'Jacks or Better (single config)',
    handRanks: HAND_RANKS.length,
    multipliersPresent: HAND_RANKS.length - missingMultipliers.length,
    betsObserved: bets.length,
    observedRankCounts: observedRanks,
    ranksExercisedByLivePlay: HAND_RANKS.length - uncoveredRanks.length,
    ranksNeverExercised: uncoveredRanks.length,
    uncoveredDealStageRtpShare: uncoveredRtpShare,
    note: 'A payout cell is one of the ten hand ranks in the committed videoPokerConfig.json pay '
      + 'table. `ranksNeverExercised` are the ranks no captured hand ever finished on, so this dataset '
      + 'does not confirm their multipliers against live play. Probabilities and the RTP share are '
      + 'stated at the DEAL stage, from the exact C(52,5) = 2,598,960 combinatorics — independent of '
      + 'the operator config, and a LOWER bound on play frequency, since a player drawing toward a '
      + 'hand reaches it more often than a straight deal does. The full pay table is covered '
      + 'analytically by the optimal-play RTP computation in src/compute-optimal-rtp.ts.',
    uncoveredCells: uncoveredRanks,
  };

  // PAYTABLE SHAPE (profile VP-14, added 2026-09-26): along the rank order best → worst the
  // multipliers must be non-increasing. An inversion is disclosed as a FLAG (the profile's policy),
  // never silently passed. The tier-0 table declares no cap; the full duel.com config as fetched
  // 2026-10-05 in a logged-in session (read-only GET; E20) ends its bet tiers at a max_bet of
  // 6189.485121034804251 (about $6,189.49), where a Royal Flush's profit is $5,000,000.00
  // (MANIFEST.md Bet-size scaling).
  const inversions: string[] = [];
  for (let i = 1; i < PAYTABLE_ORDER.length; i++) {
    const hi = MULTIPLIERS[PAYTABLE_ORDER[i - 1] as HandRank], lo = MULTIPLIERS[PAYTABLE_ORDER[i] as HandRank];
    if (!(hi >= lo)) inversions.push(`${PAYTABLE_ORDER[i - 1]} ${hi} < ${PAYTABLE_ORDER[i]} ${lo}`);
  }
  const shapeText = `paytable non-increasing along ${PAYTABLE_ORDER.join(' > ')} `
    + `(${PAYTABLE_ORDER.map(r => MULTIPLIERS[r as HandRank]).join(' ≥ ')}); the tier-0 table declares no cap; `
    + `the full duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET; E20) ends its `
    + `bet tiers at a max_bet of 6189.485121034804251 (about $6,189.49), where a Royal Flush's profit is `
    + `$5,000,000.00 (MANIFEST.md Bet-size scaling)`;

  const s11 = step(11, 'Config Completeness & Payout-Cell Coverage',
    !allRanksPresent ? 'FAIL' : inversions.length > 0 ? 'FLAG' : 'PASS',
    !allRanksPresent
      ? `${missingMultipliers.length} hand rank(s) have no multiplier in videoPokerConfig.json: ${missingMultipliers.join(', ')}`
      : inversions.length > 0
        ? `PAYTABLE INVERSION (disclosed): ${inversions.join('; ')}`
      : `Single config (Jacks or Better): all ${HAND_RANKS.length} hand ranks carry a multiplier in the `
        + `committed videoPokerConfig.json. Live play finished on ${HAND_RANKS.length - uncoveredRanks.length} `
        + `of them; the ranks it never produced are named in outputs/payout-coverage.json with their `
        + `multipliers and exact deal-stage probabilities; ${shapeText}.`,
    {
      handRanks: HAND_RANKS.length,
      ranksExercisedByLivePlay: HAND_RANKS.length - uncoveredRanks.length,
      ranksNeverExercised: uncoveredRanks.length,
      uncoveredDealStageRtpShare: uncoveredRtpShare,
      observedRankCounts: observedRanks,
    },
  );

  // ── Step 12: Epoch Size ───────────────────────────────────────────────────────
  // `maxSize <= 50` failed only on an OVERSIZED epoch — one holding MORE bets than the
  // capture's 50-bet rotation schedule (BETS_PER_EPOCH), not Duel's. That is the single
  // direction a shrinking attack never goes: every epoch could be cut from 50 bets to 5, or
  // half of them deleted outright, and the condition still held. Nor would the usual `min === max && min > 0` idiom work here, because this capture's
  // epochs are genuinely not uniform.
  //
  // The exact size MULTISET is pinned in src/loader.ts instead — 106 epochs of 50, two of 49,
  // two of 1 — so any deletion of bets or of whole epochs changes the histogram and fails.
  const observedSizes: Record<string, number> = {};
  for (const [, epochBets] of byHash.entries()) {
    const n = String(epochBets.length);
    observedSizes[n] = (observedSizes[n] ?? 0) + 1;
  }
  const epochSizes = [...byHash.values()].map(e => e.length);
  const minSize = Math.min(...epochSizes);
  const maxSize = Math.max(...epochSizes);

  const epochIssues: string[] = [];
  if (byHash.size !== EXPECTED_EPOCHS) epochIssues.push(`${byHash.size} epochs != ${EXPECTED_EPOCHS}`);
  if (maxSize > EPOCH_SIZE_CAP) epochIssues.push(`largest epoch ${maxSize} exceeds the capture's ${EPOCH_SIZE_CAP}-bet rotation schedule`);
  for (const [size, count] of Object.entries(EXPECTED_EPOCH_SIZES)) {
    const got = observedSizes[size] ?? 0;
    if (got !== count) epochIssues.push(`epochs of size ${size}: ${got} != ${count}`);
  }
  for (const size of Object.keys(observedSizes)) {
    if (!(size in EXPECTED_EPOCH_SIZES)) {
      epochIssues.push(`unexpected epoch size ${size} (x${observedSizes[size]})`);
    }
  }
  const plannedBets = Object.entries(EXPECTED_EPOCH_SIZES)
    .reduce((n, [size, count]) => n + Number(size) * count, 0);
  if (plannedBets !== EXPECTED_BETS) {
    epochIssues.push(`capture plan inconsistent: epoch sizes sum to ${plannedBets} != ${EXPECTED_BETS}`);
  }

  const s12 = step(12, 'Epoch Size',
    epochIssues.length === 0 ? 'PASS' : 'FAIL',
    epochIssues.length > 0
      ? `EPOCH POPULATION MISMATCH vs the capture plan in src/loader.ts: ${epochIssues.join('; ')}`
      : `${EXPECTED_EPOCHS} epochs, matching the size histogram pinned in src/loader.ts exactly `
        + `(106 of 50, 2 of 49, 2 of 1), no epoch above the capture's ${EPOCH_SIZE_CAP}-bet rotation schedule, `
        + `reconciling to the declared ${EXPECTED_BETS} bets.`,
    { epochs: byHash.size, expectedEpochs: EXPECTED_EPOCHS, observedSizes, minSize, maxSize, cap: EPOCH_SIZE_CAP },
  );

  // ── Step 13: Population & Phase Labels ────────────────────────────────────────
  // Labels are not a population. Every figure the old step compared was read from inside the
  // file being scored, so a uniform shrink — drop rounds, drop the matching seeds, adjust the
  // header — kept every label valid and passed. The dataset even carries its own
  // `meta.phaseBetCounts`; reconciling that AGAINST the code constants is a check, reading it
  // AS the population would be the defect. Re-pinning the hash after a shrink is what a forger
  // does, so the dataset pin cannot catch it either.
  const phases = new Set(bets.map(b => b.phase));
  const expected = ['A', 'B', 'C', 'D', 'E'];
  const hasAll   = expected.every(p => phases.has(p as any));

  const betPhaseCounts: Record<string, number> = {};
  for (const b of bets) betPhaseCounts[b.phase] = (betPhaseCounts[b.phase] ?? 0) + 1;
  const seedPhaseCounts: Record<string, number> = {};
  for (const s of seeds) seedPhaseCounts[s.phase] = (seedPhaseCounts[s.phase] ?? 0) + 1;

  const popIssues: string[] = [];
  if (bets.length !== EXPECTED_BETS)   popIssues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (seeds.length !== EXPECTED_SEEDS) popIssues.push(`seed records ${seeds.length} != ${EXPECTED_SEEDS}`);
  for (const [p, n] of Object.entries(EXPECTED_PHASE_BETS)) {
    const got = betPhaseCounts[p] ?? 0;
    if (got !== n) popIssues.push(`phase ${p} bets ${got} != ${n}`);
  }
  for (const [p, n] of Object.entries(EXPECTED_PHASE_SEEDS)) {
    const got = seedPhaseCounts[p] ?? 0;
    if (got !== n) popIssues.push(`phase ${p} seeds ${got} != ${n}`);
  }
  for (const p of Object.keys(betPhaseCounts)) {
    if (!(p in EXPECTED_PHASE_BETS)) popIssues.push(`unexpected bet phase '${p}'`);
  }
  // The capture's own header, reconciled against the code constants rather than trusted.
  const headerCounts = ctx.headerPhaseBetCounts;
  if (headerCounts) {
    for (const [p, n] of Object.entries(EXPECTED_PHASE_BETS)) {
      const got = headerCounts[p];
      if (got !== n) popIssues.push(`meta.phaseBetCounts.${p} ${got} != ${n}`);
    }
  }

  const s13 = step(13, 'Population & Phase Labels',
    hasAll && popIssues.length === 0 ? 'PASS' : 'FAIL',
    popIssues.length > 0
      ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${popIssues.join('; ')}`
      : `All ${EXPECTED_BETS} bets and ${EXPECTED_SEEDS} seed records carry valid phase labels, and the `
        + `population matches the capture plan in src/loader.ts — code constants, not the dataset's own `
        + `header. The header's meta.phaseBetCounts is reconciled against those constants and agrees.`,
    { betPhases: betPhaseCounts, seedPhases: seedPhaseCounts, bets: bets.length, seeds: seeds.length },
  );

  // ── Step 14: Dataset Hash ─────────────────────────────────────────────────────
  // Re-asserts the pre-flight so the result carries it, for the dataset AND (added 2026-09-26,
  // profile VP-26) the paytable config the derivation reads. The detail prints the MEASURED hashes;
  // it used to print only the pinned constant, the same text on PASS and FAIL.
  const h = checkDatasetHash();
  const c = checkConfigHash();
  const s14 = step(14, 'Dataset Hash',
    h.match && c.match ? 'PASS' : 'FAIL',
    `dataset sha256 ${h.actual} ${h.match ? '==' : '!='} pin ${h.expected}; videoPokerConfig.json sha256 ${c.actual} `
      + `${c.match ? '==' : '!='} pin ${c.expected}`,
    { datasetMatch: h.match, configMatch: c.match },
  );

  // ── Step 15: Phase D Client Seed Variation ────────────────────────────────────
  // An empty Phase D used to return PASS with the words "step N/A" — a step that examined
  // nothing reporting success, so deleting the Phase D bets made this check disappear without
  // a hard fail. The capture contains Phase D and the count is pinned in src/loader.ts.
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

  const expectedPhaseD = EXPECTED_PHASE_BETS.D;
  const s15Issues: string[] = [];
  if (phaseD.length !== expectedPhaseD) s15Issues.push(`Phase D bets ${phaseD.length} != ${expectedPhaseD}`);
  if (dTested !== expectedPhaseD) s15Issues.push(`recomputed ${dTested} != ${expectedPhaseD} — the rest had no revealed seed or were reconstructions`);
  if (uniqueToD.length < 1) s15Issues.push('no client seed is unique to Phase D — the auditor-chosen seeds are indistinguishable from Phase A defaults');

  const s15 = step(15, 'Phase D — Client Seed Variation',
    dMatched === dTested && classMatched === phaseD.length && s15Issues.length === 0 ? 'PASS' : 'FAIL',
    dMatched !== dTested
      ? `${dTested - dMatched} of ${dTested} Phase D bets did not recompute to their captured deal`
      : classMatched !== phaseD.length
        ? `${phaseD.length - classMatched} of ${phaseD.length} Phase D hands classify differently from the captured combination`
        : s15Issues.length > 0
          ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s15Issues.join('; ')}`
          : `All ${expectedPhaseD} Phase D bets recompute to their captured deal under `
            + (dClientSeeds.size === 1
                ? `one auditor-chosen client seed${uniqueToD.length === 1 ? ', not used in Phase A' : ''}`
                : `${dClientSeeds.size} auditor-chosen client seeds (${uniqueToD.length} not used in Phase A)`)
            + `, and every hand classifies to its captured `
            + `combination — the client seed is a genuine RNG input, not a display field.`,
    { phaseDBets: phaseD.length, expectedPhaseD, distinctClientSeeds: dClientSeeds.size,
      uniqueToPhaseD: uniqueToD.length, recomputed: dMatched, tested: dTested, handClassMatches: classMatched },
  );

  return [s10, s11, s12, s13, s14, s15];
}

function arrEq(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
