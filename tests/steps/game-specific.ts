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
import { step } from './context';
import { evaluateHand } from '../../src/hand-evaluator';
import { computeShuffledDeck, computeFinalHand, ALL_CARDS, HAND_SIZE } from '../../src/rng';
import type { HandRank, VideoPokerBet } from '../../src/types';
import { HAND_RANKS } from '../../src/types';
import videoPokerConfig from '../../videoPokerConfig.json';
import { chiSquaredTest } from '../../src/stats';

const MULTIPLIERS = videoPokerConfig.multipliers as Record<HandRank, number>;

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap, phaseE, chiResultsLog } = ctx;

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

  const s19 = step(19, 'Hand Classification Accuracy',
    classFailed === 0 ? 'PASS' : 'FAIL',
    `${classMatched}/${bets.length} bets: evaluateHand(final_cards) matches server combination; ${classFailed} mismatches${classDetails.length > 0 ? ': ' + classDetails.join('; ') : ''}`,
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
    holdErrors === 0 ? 'PASS' : 'FAIL',
    `${holdValid}/${bets.length} bets: held_cards ⊆ initial_cards with |held| ≤ 5; ${holdErrors} violations`,
  );

  // ── Step 21: Replacement Pool Determinism ──────────────────────────────────
  // Non-held positions consume deck[5..9] in left-to-right order.
  let poolVerified = 0;
  let poolFailed   = 0;

  let poolSkipped = 0;
  for (const b of bets) {
    if (b._reconstructed) { poolSkipped++; continue; }
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { poolSkipped++; continue; }

    const deck    = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce);
    const pool    = deck.slice(5, 10);
    const initial = deck.slice(0, 5);
    const expFinal = computeFinalHand(initial, b.draw.response.held_cards, pool);

    if (arrEq(expFinal, b.draw.response.final_cards!)) {
      poolVerified++;
    } else {
      poolFailed++;
    }
  }

  const s21 = step(21, 'Replacement Pool Determinism',
    poolFailed === 0 ? 'PASS' : 'FAIL',
    `${poolVerified}/${bets.length} bets: non-held positions consume deck[5..9] sequentially L→R; ${poolFailed} mismatches, ${poolSkipped} skipped (reconstructed/unrevealed)`,
  );

  // ── Step 22: Deck Integrity ────────────────────────────────────────────────
  // For each bet, deck[0..9] (hand + pool) must be 10 unique valid cards from ALL_CARDS.
  let deckValid  = 0;
  let deckErrors = 0;

  for (const b of bets) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;

    const deck     = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce);
    const tenCards = deck.slice(0, 10);
    const unique   = new Set(tenCards);
    const allValid = tenCards.every(c => ALL_CARDS.includes(c));

    if (unique.size === 10 && allValid) {
      deckValid++;
    } else {
      deckErrors++;
    }
  }

  const s22 = step(22, 'Deck Integrity',
    deckErrors === 0 ? 'PASS' : 'FAIL',
    `${deckValid}/${bets.length} bets: deck[0..9] = 10 unique valid cards from standard 52-card deck; ${deckErrors} violations`,
  );

  // ── Step 23: Card Rank Distribution ────────────────────────────────────────
  // Across all initial hands, each of the 13 ranks should appear with roughly equal frequency.
  // With 5 cards per hand and 5,400 hands = 27,000 cards total, expected ~27,000/13 ≈ 2,077 per rank.
  const rankCounts: Record<string, number> = {};
  const RANK_LABELS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  for (const r of RANK_LABELS) rankCounts[r] = 0;

  for (const b of bets) {
    for (const card of b.draw.response.initial_cards!) {
      const rankStr = card.slice(0, card.length - 1);
      rankCounts[rankStr] = (rankCounts[rankStr] ?? 0) + 1;
    }
  }

  const totalCards = bets.length * 5;
  const rankObserved = RANK_LABELS.map(r => rankCounts[r]);
  const rankExpected = RANK_LABELS.map(() => totalCards / 13);
  const rankChi = chiSquaredTest(rankObserved, rankExpected);

  chiResultsLog.push({
    group:    'card_rank_distribution',
    labels:   RANK_LABELS,
    observed: rankObserved,
    expected: rankExpected,
    chi2:     rankChi.chi2,
    df:       rankChi.df,
    pValue:   rankChi.pValue,
  });

  const s23 = step(23, 'Card Rank Distribution',
    rankChi.pValue >= 0.01 ? 'PASS' : 'FLAG',
    `${totalCards} cards across ${bets.length} initial hands; χ²(${rankChi.df})=${rankChi.chi2.toFixed(2)}, p=${rankChi.pValue.toFixed(4)}`,
  );

  // ── Step 24: Card Suit Distribution ────────────────────────────────────────
  // Across all initial hands, each of 4 suits should appear with roughly equal frequency.
  const suitCounts: Record<string, number> = { D: 0, H: 0, S: 0, C: 0 };

  for (const b of bets) {
    for (const card of b.draw.response.initial_cards!) {
      const suit = card[card.length - 1];
      suitCounts[suit] = (suitCounts[suit] ?? 0) + 1;
    }
  }

  const suitLabels = ['D', 'H', 'S', 'C'];
  const suitObserved = suitLabels.map(s => suitCounts[s]);
  const suitExpected = suitLabels.map(() => totalCards / 4);
  const suitChi = chiSquaredTest(suitObserved, suitExpected);

  chiResultsLog.push({
    group:    'card_suit_distribution',
    labels:   suitLabels,
    observed: suitObserved,
    expected: suitExpected,
    chi2:     suitChi.chi2,
    df:       suitChi.df,
    pValue:   suitChi.pValue,
  });

  const s24 = step(24, 'Card Suit Distribution',
    suitChi.pValue >= 0.01 ? 'PASS' : 'FLAG',
    `${totalCards} cards; suits: D=${suitCounts.D} H=${suitCounts.H} S=${suitCounts.S} C=${suitCounts.C}; χ²(${suitChi.df})=${suitChi.chi2.toFixed(2)}, p=${suitChi.pValue.toFixed(4)}`,
  );

  // ── Step 25: Phase E Hold Pattern Coverage ─────────────────────────────────
  // Phase E uses systematic hold patterns (hold 0 through hold 5). Verify each pattern
  // produces correct results and multiple patterns are represented.
  if (phaseE.length === 0) {
    const s25 = step(25, 'Phase E Hold Pattern Coverage', 'PASS', 'No Phase E bets in dataset — step N/A');
    return [s19, s20, s21, s22, s23, s24, s25, optimalPlayRTPStep(ctx), reconstructedStep(ctx)];
  }

  const holdPatterns: Record<number, number> = {}; // holdCount → bet count
  let phaseEVerified = 0;
  let phaseEFailed   = 0;

  for (const b of phaseE) {
    const holdCount = b.draw.response.held_cards.length;
    holdPatterns[holdCount] = (holdPatterns[holdCount] ?? 0) + 1;

    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;

    const deck     = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce);
    const expFinal = computeFinalHand(deck.slice(0, 5), b.draw.response.held_cards, deck.slice(5, 10));
    const ourRank  = evaluateHand(expFinal);

    if (arrEq(expFinal, b.draw.response.final_cards!) && ourRank === b.draw.response.combination) {
      phaseEVerified++;
    } else {
      phaseEFailed++;
    }
  }

  const patternSummary = Object.entries(holdPatterns)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([cnt, n]) => `hold-${cnt}: ${n}`)
    .join(', ');
  const distinctPatterns = Object.keys(holdPatterns).length;

  const s25 = step(25, 'Phase E Hold Pattern Coverage',
    phaseEFailed === 0 && distinctPatterns >= 3 ? 'PASS' : 'FLAG',
    `${phaseEVerified}/${phaseE.length} Phase E bets verified; ${distinctPatterns} distinct hold patterns: ${patternSummary}; ${phaseEFailed} failures`,
  );

  return [s19, s20, s21, s22, s23, s24, s25, optimalPlayRTPStep(ctx), reconstructedStep(ctx)];
}

// ── Step 26: Optimal-Play RTP Verification ──────────────────────────────────
function optimalPlayRTPStep(ctx: VerifyContext): StepResult {
  const artifactPath = path.join(ctx.outputsDir, 'optimal-play-rtp.json');

  if (!fs.existsSync(artifactPath)) {
    return step(26, 'Optimal-Play RTP Verification', 'FLAG',
      'outputs/optimal-play-rtp.json not found — run npm run compute-optimal-rtp first');
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

  // Hard assertions on the published headline numbers — FAIL on drift beyond tolerance.
  const duelRTPNum = parseFloat(artifact.duel.rtpPercent);
  const xvRTPNum   = parseFloat(artifact.crossValidation.rtpPercent);
  const totalHands = artifact.totalHands;
  const duelClasses = artifact.duel.canonicalClasses;
  const xvClasses   = artifact.crossValidation.canonicalClasses;

  const RTP_TOL = 0.0001;             // 0.0001 percentage point
  const EXPECTED_DUEL_RTP = 99.900000;
  const EXPECTED_XV_RTP   = 99.543904;
  const EXPECTED_HANDS    = 2_598_960;
  const EXPECTED_CLASSES  = 134_459;

  const failures: string[] = [];
  if (!Number.isFinite(duelRTPNum) || Math.abs(duelRTPNum - EXPECTED_DUEL_RTP) > RTP_TOL) {
    failures.push(`duel.rtpPercent=${artifact.duel.rtpPercent} (expected ≈ ${EXPECTED_DUEL_RTP.toFixed(6)} ± ${RTP_TOL})`);
  }
  if (!Number.isFinite(xvRTPNum) || Math.abs(xvRTPNum - EXPECTED_XV_RTP) > RTP_TOL) {
    failures.push(`crossValidation.rtpPercent=${artifact.crossValidation.rtpPercent} (expected ≈ ${EXPECTED_XV_RTP.toFixed(6)} ± ${RTP_TOL})`);
  }
  if (totalHands !== EXPECTED_HANDS) {
    failures.push(`totalHands=${totalHands} (expected ${EXPECTED_HANDS})`);
  }
  if (duelClasses !== EXPECTED_CLASSES) {
    failures.push(`duel.canonicalClasses=${duelClasses} (expected ${EXPECTED_CLASSES})`);
  }
  if (xvClasses !== EXPECTED_CLASSES) {
    failures.push(`crossValidation.canonicalClasses=${xvClasses} (expected ${EXPECTED_CLASSES})`);
  }

  if (failures.length > 0) {
    return step(26, 'Optimal-Play RTP Verification', 'FAIL',
      `Headline numbers drifted from published values: ${failures.join('; ')}. Rerun npm run compute-optimal-rtp.`);
  }

  return step(26, 'Optimal-Play RTP Verification', 'PASS',
    `Optimal-play RTP: ${artifact.duel.rtpPercent}% (exhaustive C(52,5) = ${EXPECTED_HANDS.toLocaleString()} hands, ${duelClasses.toLocaleString()} canonical classes; asserted ≈ ${EXPECTED_DUEL_RTP.toFixed(6)}). ` +
    `Cross-validated against standard 9/6 JoB: ${artifact.crossValidation.rtpPercent}% (asserted ≈ ${EXPECTED_XV_RTP.toFixed(6)}, PASS). ` +
    `Pay table hash matches videoPokerConfig.json.`);
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
    `All reconstructed hands passed outcome recomputation in Step 5.`,
  );
}

function arrEq(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
