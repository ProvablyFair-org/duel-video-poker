/**
 * Steps 19–27: Video Poker Game-Specific Verification
 *
 * 19: Hand Classification Accuracy
 * 20: Hold Validity
 * 21: Replacement Pool Determinism
 * 22: Deck Integrity
 * 23: Card Rank Distribution
 * 24: Card Suit Distribution
 * 25: Phase E Hold Pattern Coverage
 * 26: Optimal-Play RTP Verification (artifact check)
 * 27: Reconstructed Hands Disclosure
 */

import * as fs   from 'fs';
import * as path from 'path';
import type { StepResult, VerifyContext } from './context';
import { step, finalHandOrNull } from './context';
import { evaluateHand } from '../../src/hand-evaluator';
import { computeShuffledDeck, ALL_CARDS, HAND_SIZE, DECK_SIZE, maxFairFor } from '../../src/rng';
import type { RejectionCensus } from '../../src/rng';
import type { HandRank, VideoPokerBet } from '../../src/types';
import { HAND_RANKS } from '../../src/types';
import videoPokerConfig from '../../videoPokerConfig.json';
import { chiSquaredTest } from '../../src/stats';
import {
  EXPECTED_BETS, EXPECTED_PHASE_BETS, EXPECTED_PHASE_E_HOLD_PATTERNS, holdPatternKey,
  PUBLISHED_OPTIMAL_RTP_PCT, PUBLISHED_REFERENCE_96_RTP_PCT, RTP_ANCHOR_TOL_PP, C52_5, CANONICAL_CLASSES,
} from '../../src/loader';

const MULTIPLIERS = videoPokerConfig.multipliers as Record<HandRank, number>;

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap, phaseE } = ctx;

  // ── Step 19: Hand Classification Accuracy ─────────────────────────────────
  // Our independent evaluateHand(final_cards) must match the server's combination.
  let classMatched = 0;
  let classFailed  = 0;
  const classDetails: string[] = [];

  for (const b of bets) {
    const ourRank   = evaluateHand(b.draw.response.final_cards!);
    const serverRank = b.draw.response.combination;
    if (ourRank === serverRank) {
      classMatched++;
    } else {
      classFailed++;
      if (classDetails.length < 5) {
        classDetails.push(`hand_id=${b.draw.response.hand_id}: ours=${ourRank}, server=${serverRank}, cards=${b.draw.response.final_cards!.join(',')}`);
      }
    }
  }

  // Bound to the audited population (2026-09-26): an emptied or truncated corpus used to PASS with
  // "0 mismatches"; now the count classified must equal EXPECTED_BETS.
  const s19 = step(19, 'Hand Classification Accuracy',
    classFailed === 0 && classMatched === EXPECTED_BETS ? 'PASS' : 'FAIL',
    `${classMatched}/${bets.length} bets: evaluateHand(final_cards) matches server combination; ${classFailed} mismatches${classDetails.length > 0 ? ': ' + classDetails.join('; ') : ''}`
      + (classMatched + classFailed !== EXPECTED_BETS ? `; POPULATION MISMATCH: classified ${classMatched + classFailed} != ${EXPECTED_BETS}` : ''),
  );

  // ── Step 20: Hold Validity ─────────────────────────────────────────────────
  // Every held_card must be present in initial_cards.
  let holdValid  = 0;
  let holdErrors = 0;

  for (const b of bets) {
    const initial = new Set(b.draw.response.initial_cards!);
    const allHeld = b.draw.response.held_cards.every(c => initial.has(c));
    if (allHeld && b.draw.response.held_cards.length <= HAND_SIZE) {
      holdValid++;
    } else {
      holdErrors++;
    }
  }

  const s20 = step(20, 'Hold Validity',
    holdErrors === 0 && holdValid === EXPECTED_BETS ? 'PASS' : 'FAIL',
    `${holdValid}/${bets.length} bets: held_cards ⊆ initial_cards with |held| ≤ 5; ${holdErrors} violations`
      + (holdValid + holdErrors !== EXPECTED_BETS ? `; POPULATION MISMATCH: checked ${holdValid + holdErrors} != ${EXPECTED_BETS}` : ''),
  );

  // ── Step 21: Replacement Pool Determinism ──────────────────────────────────
  // Non-held positions consume deck[5..9] in left-to-right order.
  let poolVerified = 0;
  let poolFailed   = 0;

  // A bet skipped for want of a revealed seed is a bet this step did not decide. It used to be
  // counted and passed over — the step PASSed on "0 mismatches" whatever the skip count, so a
  // dataset in which no seed was revealed scored a clean pass having recomputed nothing. The
  // recomputed count is now bound to the population: every non-reconstructed bet must be
  // recomputed, and an unrevealed seed is a FAIL.
  let poolReconstructed = 0, poolUnrevealed = 0;
  for (const b of bets) {
    if (b._reconstructed) { poolReconstructed++; continue; }
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { poolUnrevealed++; continue; }

    const deck    = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce);
    const pool    = deck.slice(5, 10);
    const initial = deck.slice(0, 5);
    const expFinal = finalHandOrNull(initial, b.draw.response.held_cards, pool);

    if (arrEq(expFinal, b.draw.response.final_cards!)) {
      poolVerified++;
    } else {
      poolFailed++;
    }
  }

  const s21Issues = populationIssues(bets.length, poolVerified + poolFailed, poolReconstructed, poolUnrevealed);
  const s21 = step(21, 'Replacement Pool Determinism',
    poolFailed === 0 && s21Issues.length === 0 ? 'PASS' : 'FAIL',
    poolFailed > 0
      ? `${poolFailed} of ${poolVerified + poolFailed} recomputed bets: final_cards differ from deck[5..9] consumed L→R into the non-held positions`
      : s21Issues.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s21Issues.join('; ')}`
        : `${poolVerified}/${EXPECTED_BETS} bets recomputed: non-held positions consume deck[5..9] sequentially L→R; `
          + `0 mismatches, 0 unrevealed, 0 reconstructed.`,
    { bets: bets.length, expectedBets: EXPECTED_BETS, recomputed: poolVerified + poolFailed, verified: poolVerified,
      mismatches: poolFailed, reconstructed: poolReconstructed, unrevealed: poolUnrevealed },
  );

  // ── Step 22: Deck Integrity ────────────────────────────────────────────────
  // For each bet, deck[0..9] (hand + pool) must be 10 unique valid cards from ALL_CARDS.
  // Same defect as step 21: an unrevealed seed was `continue`d past uncounted, so the step
  // PASSed with deckValid anywhere from 0 to bets.length. Now counted and bound.
  // DRAW-BIAS BOUND (profile VP-08, added 2026-09-26). Computed from the shuffle's own ceiling
  // (src/rng.ts maxFairFor, docs/ALGORITHM.md §2 Step 2): for every range 2 … 52 the accepted domain [0, maxFair) must be a whole
  // number of ranges, which makes each swap index exactly uniform — bias 0, below the 2^-32 ceiling.
  // The rejection census over the capture (chunks read vs swaps made) is counted on the same pass.
  const biasIssues: string[] = [];
  let worstRejectP = 0, worstRange = 0;
  for (let range = 2; range <= DECK_SIZE; range++) {
    const mf = maxFairFor(range);
    if (mf % range !== 0) biasIssues.push(`range ${range}: maxFair ${mf} is not a multiple of ${range}`);
    const p = (2 ** 32 - mf) / 2 ** 32;
    if (p > worstRejectP) { worstRejectP = p; worstRange = range; }
  }
  const census: RejectionCensus = { chunksRead: 0, swaps: 0 };

  let deckValid  = 0;
  let deckErrors = 0;
  let deckUnrevealed = 0;

  for (const b of bets) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { deckUnrevealed++; continue; }

    const deck     = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce, census);
    const tenCards = deck.slice(0, 10);
    const unique   = new Set(tenCards);
    const allValid = tenCards.every(c => ALL_CARDS.includes(c));

    if (unique.size === 10 && allValid) {
      deckValid++;
    } else {
      deckErrors++;
    }
  }

  const s22Issues = populationIssues(bets.length, deckValid + deckErrors, 0, deckUnrevealed);
  const expectedSwaps = (deckValid + deckErrors) * (DECK_SIZE - 1);
  if (census.swaps !== expectedSwaps) biasIssues.push(`census counted ${census.swaps} swaps != ${expectedSwaps} (${DECK_SIZE - 1} per deck)`);
  const rejected = census.chunksRead - census.swaps;
  const s22 = step(22, 'Deck Integrity',
    deckErrors === 0 && s22Issues.length === 0 && biasIssues.length === 0 ? 'PASS' : 'FAIL',
    deckErrors > 0
      ? `${deckErrors} of ${deckValid + deckErrors} recomputed decks: deck[0..9] is not 10 unique valid cards`
      : s22Issues.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s22Issues.join('; ')}`
      : biasIssues.length > 0
        ? `DRAW BIAS: ${biasIssues.join('; ')}`
        : `${deckValid}/${EXPECTED_BETS} bets recomputed: deck[0..9] = 10 unique valid cards from the standard `
          + `52-card deck; 0 violations, 0 unrevealed. Draw-bias bound: for every range 2…${DECK_SIZE} the rejection `
          + `ceiling maxFair = floor(2^32 / range) × range (docs/ALGORITHM.md §2 Step 2) is a whole number of ranges, so every swap index is `
          + `exactly uniform (bias 0 ≤ 2^-32); worst per-chunk rejection probability ${worstRejectP.toExponential(3)} (range `
          + `${worstRange}). Rejection census over the capture: ${census.swaps} swaps, ${census.chunksRead} chunks read, `
          + `${rejected} rejected.`,
    { bets: bets.length, expectedBets: EXPECTED_BETS, recomputed: deckValid + deckErrors, valid: deckValid,
      violations: deckErrors, unrevealed: deckUnrevealed, biasBoundExact: biasIssues.length === 0,
      worstRejectProbability: worstRejectP, worstRange, censusSwaps: census.swaps, censusChunksRead: census.chunksRead,
      censusRejected: rejected },
  );

  // ── Step 23: Card Rank Distribution ────────────────────────────────────────
  // Across all initial hands, each of the 13 ranks should appear with roughly equal frequency.
  // With 5 cards per hand and 5,400 hands = 27,000 cards total, expected ~27,000/13 ≈ 2,077 per rank.
  const rankCounts: Record<string, number> = {};
  const RANK_LABELS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  for (const r of RANK_LABELS) rankCounts[r] = 0;

  // A card whose rank is not one of the 13 used to be counted under its own key and then
  // silently left out of the chi-squared, which reads only RANK_LABELS. It is now an error.
  let rankUnparsed = 0, cardsSeen = 0;
  for (const b of bets) {
    for (const card of b.draw.response.initial_cards ?? []) {
      cardsSeen++;
      const rankStr = card.slice(0, card.length - 1);
      if (!(rankStr in rankCounts)) { rankUnparsed++; continue; }
      rankCounts[rankStr]++;
    }
  }

  const totalCards = bets.length * 5;
  const rankObserved = RANK_LABELS.map(r => rankCounts[r]);
  const rankExpected = RANK_LABELS.map(() => totalCards / 13);
  const rankChi = chiSquaredTest(rankObserved, rankExpected);

  // The chi-squared table is an artifact of record (outputs/chi-squared-results.json). Without
  // this entry the file shipped with `groups: []` — a named artifact that recorded nothing.
  ctx.chiResultsLog.push({
    group:    'card_rank_distribution',
    labels:   RANK_LABELS,
    observed: rankObserved,
    expected: rankExpected,
    chi2:     rankChi.chi2,
    df:       rankChi.df,
    pValue:   rankChi.pValue,
  });

  // The text states the BOUND (α); the measured chi-squared statistic and p-value go in
  // `data`, where the reproduction gate compares them under tolerance rather than demanding
  // that a float's decimal rendering be identical on every machine that re-runs this suite.
  // VP-22 is INFORMATIONAL (profile policy, Mike 2026-09-29: the live-sample fit is informational
  // everywhere). A rank distribution rejected at α=0.01 is reported as INFO — never a FLAG or a FAIL,
  // never counted, verdict unchanged (it was a FAIL from 2026-09 until this ruling). A card the test
  // could not place, or a card count that is not 5 × the pinned population, is not a fit statistic
  // and still FAILs.
  const s23Issues: string[] = [];
  if (bets.length !== EXPECTED_BETS) s23Issues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (cardsSeen !== EXPECTED_BETS * 5) s23Issues.push(`${cardsSeen} initial cards != ${EXPECTED_BETS * 5}`);
  if (rankUnparsed > 0) s23Issues.push(`${rankUnparsed} card(s) with a rank outside the 13`);
  const s23Ok = rankChi.pValue >= 0.01 && s23Issues.length === 0;
  const s23 = step(23, 'Card Rank Distribution',
    s23Issues.length > 0 ? 'FAIL' : s23Ok ? 'PASS' : 'INFO',
    s23Issues.length > 0
      ? `POPULATION MISMATCH: ${s23Issues.join('; ')}`
      : s23Ok
        ? `${totalCards} cards across ${bets.length} initial hands; the rank distribution is consistent `
          + `with uniform over 13 ranks at α=0.01 (χ² on ${rankChi.df} degrees of freedom)`
        : `${totalCards} cards: rank distribution REJECTS uniform over 13 ranks at α=0.01 — `
          + `χ²=${rankChi.chi2} on ${rankChi.df} df, p=${rankChi.pValue} (INFO, informational — reported, not counted, verdict unchanged)`,
    { totalCards, hands: bets.length, chiSquared: rankChi.chi2, df: rankChi.df,
      pValue: rankChi.pValue, alpha: 0.01, rankCounts, unparsed: rankUnparsed },
  );

  // ── Step 24: Card Suit Distribution ────────────────────────────────────────
  // Across all initial hands, each of 4 suits should appear with roughly equal frequency.
  const suitCounts: Record<string, number> = { D: 0, H: 0, S: 0, C: 0 };

  let suitUnparsed = 0, suitCardsSeen = 0;
  for (const b of bets) {
    for (const card of b.draw.response.initial_cards ?? []) {
      suitCardsSeen++;
      const suit = card[card.length - 1];
      if (!(suit in suitCounts)) { suitUnparsed++; continue; }
      suitCounts[suit]++;
    }
  }

  const suitLabels = ['D', 'H', 'S', 'C'];
  const suitObserved = suitLabels.map(s => suitCounts[s]);
  const suitExpected = suitLabels.map(() => totalCards / 4);
  const suitChi = chiSquaredTest(suitObserved, suitExpected);

  ctx.chiResultsLog.push({
    group:    'card_suit_distribution',
    labels:   suitLabels,
    observed: suitObserved,
    expected: suitExpected,
    chi2:     suitChi.chi2,
    df:       suitChi.df,
    pValue:   suitChi.pValue,
  });

  // As step 23: rejection at α=0.01 is INFO (informational, VP-22); an unplaceable card or a short
  // count FAILs.
  const s24Issues: string[] = [];
  if (bets.length !== EXPECTED_BETS) s24Issues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (suitCardsSeen !== EXPECTED_BETS * 5) s24Issues.push(`${suitCardsSeen} initial cards != ${EXPECTED_BETS * 5}`);
  if (suitUnparsed > 0) s24Issues.push(`${suitUnparsed} card(s) with a suit outside D/H/S/C`);
  const s24Ok = suitChi.pValue >= 0.01 && s24Issues.length === 0;
  const s24 = step(24, 'Card Suit Distribution',
    s24Issues.length > 0 ? 'FAIL' : s24Ok ? 'PASS' : 'INFO',
    s24Issues.length > 0
      ? `POPULATION MISMATCH: ${s24Issues.join('; ')}`
      : `${totalCards} cards; suits: D=${suitCounts.D} H=${suitCounts.H} S=${suitCounts.S} C=${suitCounts.C}; `
        + (s24Ok
          ? `the suit distribution is consistent with uniform over 4 suits at α=0.01 (χ² on ${suitChi.df} degrees of freedom)`
          : `the suit distribution REJECTS uniform over 4 suits at α=0.01 — χ²=${suitChi.chi2} on ${suitChi.df} df, p=${suitChi.pValue} (INFO, informational — reported, not counted, verdict unchanged)`),
    { totalCards, chiSquared: suitChi.chi2, df: suitChi.df, pValue: suitChi.pValue,
      alpha: 0.01, suitCounts, unparsed: suitUnparsed },
  );

  // ── Step 25: Phase E Hold Pattern Coverage ─────────────────────────────────
  // Phase E uses the capture plan's systematic hold patterns (capture/capture.reference.js holdSystematic:
  // 8 patterns x 100 bets, keyed by the positions held). Every Phase E bet must recompute to its
  // captured final hand and combination, and the pattern histogram must be the plan's.
  //
  // Three defects in the old form: an empty Phase E returned PASS "step N/A"; a bet with an
  // unrevealed seed was `continue`d past uncounted, so 0 recomputed PASSed; and the pass bar was
  // "at least 3 distinct hold COUNTS", which any subset keeping three of them satisfied (the
  // capture has 4 distinct counts over 8 positional patterns). All three now FAIL.
  const holdPatterns: Record<string, number> = {};
  let phaseEVerified = 0;
  let phaseEFailed   = 0;
  let phaseEUnrevealed = 0;

  for (const b of phaseE) {
    const key = holdPatternKey(b);
    holdPatterns[key] = (holdPatterns[key] ?? 0) + 1;

    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { phaseEUnrevealed++; continue; }

    const deck     = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce);
    const expFinal = finalHandOrNull(deck.slice(0, 5), b.draw.response.held_cards, deck.slice(5, 10));
    const ourRank  = expFinal ? evaluateHand(expFinal) : null;

    if (arrEq(expFinal, b.draw.response.final_cards!) && ourRank === b.draw.response.combination) {
      phaseEVerified++;
    } else {
      phaseEFailed++;
    }
  }

  const patternSummary = Object.entries(holdPatterns)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `hold ${k}: ${n}`)
    .join(', ');
  const expectedPhaseE = EXPECTED_PHASE_BETS.E;
  const s25Issues: string[] = [];
  if (phaseE.length !== expectedPhaseE) s25Issues.push(`Phase E bets ${phaseE.length} != ${expectedPhaseE}`);
  if (phaseEUnrevealed > 0) s25Issues.push(`${phaseEUnrevealed} Phase E bet(s) not recomputable — epoch seed unrevealed`);
  if (phaseEVerified + phaseEFailed !== expectedPhaseE) s25Issues.push(`recomputed ${phaseEVerified + phaseEFailed} != ${expectedPhaseE}`);
  for (const [k, n] of Object.entries(EXPECTED_PHASE_E_HOLD_PATTERNS)) {
    const got = holdPatterns[k] ?? 0;
    if (got !== n) s25Issues.push(`hold pattern ${k}: ${got} bets != ${n}`);
  }
  for (const k of Object.keys(holdPatterns)) {
    if (!(k in EXPECTED_PHASE_E_HOLD_PATTERNS)) s25Issues.push(`unplanned hold pattern ${k} (x${holdPatterns[k]})`);
  }
  const plannedPatterns = Object.keys(EXPECTED_PHASE_E_HOLD_PATTERNS).length;

  const s25 = step(25, 'Phase E Hold Pattern Coverage',
    phaseEFailed === 0 && s25Issues.length === 0 ? 'PASS' : 'FAIL',
    phaseEFailed > 0
      ? `${phaseEFailed} of ${phaseEVerified + phaseEFailed} Phase E bets do not recompute to their captured final hand and combination`
      : s25Issues.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s25Issues.slice(0, 5).join('; ')}`
        : `${phaseEVerified}/${expectedPhaseE} Phase E bets recomputed to their captured final hand and combination, `
          + `across all ${plannedPatterns} planned hold patterns (positions held): ${patternSummary}. 0 failures, 0 unrevealed.`,
    { phaseEBets: phaseE.length, expectedPhaseE, recomputed: phaseEVerified + phaseEFailed, verified: phaseEVerified,
      failures: phaseEFailed, unrevealed: phaseEUnrevealed, holdPatterns, plannedPatterns },
  );

  return [s19, s20, s21, s22, s23, s24, s25, optimalPlayRTPStep(ctx), reconstructedStep(ctx)];
}

// ── Step 26: Optimal-Play RTP Verification ──────────────────────────────────
function optimalPlayRTPStep(ctx: VerifyContext): StepResult {
  const artifactPath = path.join(ctx.outputsDir, 'optimal-play-rtp.json');

  // A missing artifact used to be a FLAG here while step 28 FAILed the same absence. The
  // headline RTP is scored against this file, so without it this step decided nothing: FAIL.
  if (!fs.existsSync(artifactPath)) {
    return step(26, 'Optimal-Play RTP Verification', 'FAIL',
      'outputs/optimal-play-rtp.json ABSENT — the optimal-play RTP this step verifies has no artifact to be read from');
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));

  // Check cross-validation passed
  if (!artifact.crossValidation?.pass) {
    return step(26, 'Optimal-Play RTP Verification', 'FAIL',
      `Cross-validation FAILED: standard 9/6 JoB RTP = ${artifact.crossValidation?.rtpPercent}% (target: 99.5439%)`);
  }

  // Check pay table hash matches current config
  const configPath = path.join(__dirname, '../../videoPokerConfig.json');
  const configHash = require('crypto').createHash('sha256')
    .update(require('fs').readFileSync(configPath))
    .digest('hex');

  if (artifact.duel?.payTableHash !== configHash) {
    return step(26, 'Optimal-Play RTP Verification', 'FAIL',
      `Pay table hash mismatch — artifact was computed against a different config. Rerun npm run compute-optimal-rtp`);
  }

  const duelRTP = artifact.duel.rtpPercent;
  const xvRTP = artifact.crossValidation.rtpPercent;
  const classes = artifact.duel.canonicalClasses;

  // EXTERNAL ANCHOR. `crossValidation.pass` and the pay-table hash are both read from the
  // artifact under check, so a rewritten artifact that says "pass" about itself would pass.
  // The headline figures are asserted here against constants the artifact does not control:
  // the published optimal-play RTP, the Wizard of Odds 9/6 Jacks or Better reference, the
  // C(52,5) hand count and the canonical class count of the enumeration. Drift beyond tolerance
  // is a HARD FAIL, not a flag — these numbers are published.
  // C3 (FIXPASS2, 14 Oct 2026): the Duel optimal-play figure is held to the published 99.900000 on
  // the PLAYER side only (an artifact that claims more than was published fails here). Below it is an
  // RTP miss, and an RTP miss is the RTP-CLAIM rule's: the RTP table is built from duel.rtp and held to
  // the claim on this step, so a lower figure ends RTP FIGURE OVERSTATED, exit 5 — this anchor used to
  // fail it first (exit 1). The pre-rendered rtpPercent must also be duel.rtp itself, to 6 dp.
  const duelRTPNum = parseFloat(duelRTP);
  const xvRTPNum   = parseFloat(xvRTP);
  const RTP_TOL           = RTP_ANCHOR_TOL_PP;
  const EXPECTED_DUEL_RTP = PUBLISHED_OPTIMAL_RTP_PCT;
  const EXPECTED_XV_RTP   = PUBLISHED_REFERENCE_96_RTP_PCT;
  const EXPECTED_HANDS    = C52_5;
  const EXPECTED_CLASSES  = CANONICAL_CLASSES;

  const anchorFailures: string[] = [];
  if (!Number.isFinite(duelRTPNum) || duelRTPNum - EXPECTED_DUEL_RTP > RTP_TOL) {
    anchorFailures.push(`duel.rtpPercent=${duelRTP} (above the published ${EXPECTED_DUEL_RTP.toFixed(6)} + ${RTP_TOL})`);
  }
  if (typeof artifact.duel.rtp !== 'number' || (artifact.duel.rtp * 100).toFixed(6) !== duelRTP) {
    anchorFailures.push(`duel.rtpPercent=${duelRTP} is not duel.rtp=${artifact.duel.rtp} to 6 dp`);
  }
  if (!Number.isFinite(xvRTPNum) || Math.abs(xvRTPNum - EXPECTED_XV_RTP) > RTP_TOL) {
    anchorFailures.push(`crossValidation.rtpPercent=${xvRTP} (expected ${EXPECTED_XV_RTP.toFixed(6)} ± ${RTP_TOL})`);
  }
  if (artifact.totalHands !== EXPECTED_HANDS) {
    anchorFailures.push(`totalHands=${artifact.totalHands} (expected ${EXPECTED_HANDS})`);
  }
  if (classes !== EXPECTED_CLASSES) {
    anchorFailures.push(`duel.canonicalClasses=${classes} (expected ${EXPECTED_CLASSES})`);
  }
  if (artifact.crossValidation.canonicalClasses !== EXPECTED_CLASSES) {
    anchorFailures.push(`crossValidation.canonicalClasses=${artifact.crossValidation.canonicalClasses} (expected ${EXPECTED_CLASSES})`);
  }
  if (anchorFailures.length > 0) {
    return step(26, 'Optimal-Play RTP Verification', 'FAIL',
      `Headline figures drifted from the published values: ${anchorFailures.join('; ')}. Rerun npm run compute-optimal-rtp.`);
  }

  // `rtpPercent` is a pre-rendered STRING inside the pinned artifact, so embedding it here
  // would put a measured float into a string leaf a second time. The numbers go in `data`,
  // where the reproduction gate can compare them under tolerance; the text states the claim
  // and the cross-validation target, both constants.
  return step(26, 'Optimal-Play RTP Verification', 'PASS',
    `Optimal-play RTP computed by exhaustive enumeration of all C(52,5) = 2,598,960 deals `
    + `(${classes.toLocaleString()} canonical classes), cross-validated by recomputing the standard `
    + `9/6 Jacks or Better pay table and matching its published 99.5439% to within `
    + `${artifact.crossValidation.tolerance} (the tolerance recorded in the artifact). Headline `
    + `figures asserted against the published constants: 99.543904% 9/6 reference (± 0.0001 pp), `
    + `2,598,960 hands, 134,459 canonical classes; the 99.900000% optimal-play figure not exceeded (+ 0.0001 pp) `
    + `and equal to duel.rtp to 6 dp. Below it would be an RTP miss: duel.rtp is the RTP table's row, held `
    + `to the claim by RTP-CLAIM on this step.`,
    {
      duelOptimalRTP: Number(duelRTP),
      crossValidationRTP: Number(xvRTP),
      crossValidationTarget: artifact.crossValidation.target,
      crossValidationTolerance: artifact.crossValidation.tolerance,
      totalHands: artifact.totalHands,
      canonicalClasses: classes,
      payTableHash: artifact.duel.payTableHash,
    });
}

// ── Step 27: Reconstructed Hands Disclosure ──────────────────────────────────
function reconstructedStep(ctx: VerifyContext): StepResult {
  const { bets } = ctx;

  const reconstructed = bets.filter(b => b._reconstructed);
  if (reconstructed.length === 0) {
    return step(27, 'Reconstructed Hands Disclosure', 'PASS',
      'No reconstructed hands in dataset',
    );
  }

  const details = reconstructed.map(b => {
    const idx = bets.indexOf(b);
    return `index=${idx}, phase=${b.phase}, nonce=${b.seed.nonce}, combination=${b.draw.response.combination}`;
  }).join('; ');

  // Reconstructed hands are disclosed but not a failure — they were gap-filled
  // during capture and must be flagged for transparency.
  return step(27, 'Reconstructed Hands Disclosure', 'FLAG',
    `${reconstructed.length} reconstructed (gap-filled) hands: ${details}. ` +
    `These hands had incomplete capture data and were reconstructed from API transaction records. ` +
    `They are never scored as recomputed: Step 5 counts any reconstructed hand as a population FAIL.`,
  );
}

/**
 * Population bind for a per-bet recomputation step: every bet must be either recomputed or a
 * disclosed reconstruction, none may be skipped for an unrevealed seed, and the total must be the
 * pinned population. "0 mismatches" over a recomputed count of 0 is not a result.
 */
function populationIssues(bets: number, recomputed: number, reconstructed: number, unrevealed: number): string[] {
  const issues: string[] = [];
  if (bets !== EXPECTED_BETS) issues.push(`bets ${bets} != ${EXPECTED_BETS}`);
  if (unrevealed > 0) issues.push(`${unrevealed} bet(s) not recomputable — their epoch seed was never revealed`);
  if (recomputed + reconstructed !== EXPECTED_BETS) {
    issues.push(`recomputed ${recomputed} + reconstructed ${reconstructed} != ${EXPECTED_BETS}`);
  }
  return issues;
}

function arrEq(a: readonly string[] | null, b: readonly string[]): boolean {
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
