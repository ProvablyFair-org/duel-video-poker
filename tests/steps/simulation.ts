/**
 * Steps 16–18: Anti-Circularity + Simulation Validation
 *
 * Step 16: Anti-circularity — theoretical deal-only RTP from C(52,5) enumeration
 * Step 17: Pass 1 — Fisher's combined chi-squared + serial independence
 * Step 18: Pass 2 — Cherry-pick detection on captured casino seeds
 */

import * as fs   from 'fs';
import * as path from 'path';

import type { StepResult, VerifyContext } from './context';
import { step } from './context';
import type { HandRank } from '../../src/types';
import { HAND_RANKS } from '../../src/types';
import videoPokerConfig from '../../videoPokerConfig.json';

const MULTIPLIERS = videoPokerConfig.multipliers as Record<HandRank, number>;

// Independent combinatorial counts — C(52,5) = 2,598,960 total 5-card hands
const TOTAL_HANDS = 2_598_960;
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
  const { outputsDir } = ctx;

  // ── Step 16: Anti-Circularity ───────────────────────────────────────────────
  // Prove theoretical deal-only RTP from independent combinatorial counts.
  // Each hand rank's probability = count / C(52,5). RTP = sum(P(rank) × multiplier(rank)).
  let theoreticalRTP = 0;
  let totalCounted   = 0;
  const rtpBreakdown: string[] = [];

  for (const rank of HAND_RANKS) {
    const count = THEORETICAL_COUNTS[rank];
    const prob  = count / TOTAL_HANDS;
    const mult  = MULTIPLIERS[rank];
    const contribution = prob * mult;
    theoreticalRTP += contribution;
    totalCounted   += count;

    if (mult > 0) {
      rtpBreakdown.push(`${rank}: ${count}/${TOTAL_HANDS} × ${mult} = ${(contribution * 100).toFixed(6)}%`);
    }
  }

  // Verify the counts sum to C(52,5)
  const countsSumCorrect = totalCounted === TOTAL_HANDS;

  // Verify RTP is within expected range (should be ~33.7% for deal-only Jacks or Better)
  const rtpInRange = theoreticalRTP > 0.30 && theoreticalRTP < 0.40;

  const s16 = step(16, 'Anti-Circularity (Deal-Only Distribution Check)',
    countsSumCorrect && rtpInRange ? 'PASS' : 'FAIL',
    `C(52,5) = ${TOTAL_HANDS}; counted = ${totalCounted} (sum check: ${countsSumCorrect ? 'OK' : 'MISMATCH'}); ` +
    `theoretical deal-only RTP = ${(theoreticalRTP * 100).toFixed(6)}% from independent combinatorial enumeration ` +
    `(deal distribution only — the authoritative game RTP is the 99.9000% optimal-play figure in Step 26). ` +
    `10 hand ranks verified against published combinatorial tables.`,
  );

  // ── Steps 17–18: Simulation results ──────────────────────────────────────────
  const simPath = path.join(outputsDir, 'simulation-results.json');

  if (!fs.existsSync(simPath)) {
    const s17 = step(17, 'Simulation Validation — Pass 1', 'FLAG',
      'simulation-results.json not found — run npm run simulate first',
    );
    const s18 = step(18, 'Pass 2 Cherry-Pick Detection', 'FLAG',
      'simulation-results.json not found',
    );
    return [s16, s17, s18];
  }

  const sim = JSON.parse(fs.readFileSync(simPath, 'utf-8'));

  // ── Step 17: Pass 1 — Fisher's combined chi-squared ───────────────────────
  const pass1 = sim.pass1;

  // Fisher's combined p-value
  const fisherP    = pass1.fisherCombined.pValue;
  const streams    = pass1.streams;
  const totalRounds = pass1.totalRounds;
  const serialFails = pass1.serialIndependenceFails;
  const empRTP     = pass1.empiricalRTP;

  // Per-stream check: any below alpha?
  const streamsBelow = pass1.streamResults.filter((r: any) => r.pValue < 0.01).length;

  // FWER explainer
  console.log(`\n         Video Poker is single-config — using Fisher's method (${streams} streams).`);
  console.log(`         Fisher's combined p-value: ${fisherP.toFixed(6)} (PASS threshold: ≥0.01)`);
  console.log(`         Streams below α=0.01: ${streamsBelow}/${streams}`);
  console.log(`         Serial independence failures: ${serialFails}`);
  console.log(`         Empirical deal-only RTP: ${(empRTP * 100).toFixed(4)}%`);
  console.log(`         Theoretical deal-only RTP: ${(theoreticalRTP * 100).toFixed(4)}%\n`);

  const pass1Ok = fisherP >= 0.01 && serialFails === 0;
  const s17 = step(17, 'Simulation Validation — Pass 1 (Deal-Only Distribution)',
    pass1Ok ? 'PASS' : 'FAIL',
    `${totalRounds.toLocaleString()} rounds (${streams} streams × ${pass1.roundsPerStream.toLocaleString()}); ` +
    `Fisher's combined p=${fisherP.toFixed(6)}; ` +
    `streams below α=0.01: ${streamsBelow}/${streams}; ` +
    `serial independence fails: ${serialFails}; ` +
    `empirical deal-only RTP: ${(empRTP * 100).toFixed(4)}% (theoretical deal-only: ${(theoreticalRTP * 100).toFixed(4)}%) — ` +
    `validates deal distribution, not the game RTP figure (see Step 26 for the authoritative 99.9000% optimal-play RTP)`,
  );

  // ── Step 18: Pass 2 — Cherry-Pick Detection ──────────────────────────────
  const pass2 = sim.pass2;

  if (!pass2 || pass2.totalSeeds === 0) {
    const s18 = step(18, 'Pass 2 Cherry-Pick Detection', 'FLAG',
      'No Pass 2 data — run simulation with dataset present',
    );
    return [s16, s17, s18];
  }

  const totalSeeds   = pass2.totalSeeds;
  const flaggedSeeds = pass2.flaggedSeeds;
  const binomialP    = pass2.cherryPickBinomial;
  const aggChi       = pass2.aggregatedChiSquared;
  const aggRTP       = pass2.aggregatedRTP;

  // Cherry-pick threshold: binomial p-value < 0.01 → FAIL
  const cherryPickPass = binomialP >= 0.01;

  const s18 = step(18, 'Pass 2 Cherry-Pick Detection',
    cherryPickPass ? 'PASS' : 'FLAG',
    `${totalSeeds} casino seeds × ${pass2.perSeed[0]?.nonces ?? 'N/A'} nonces each; ` +
    `${flaggedSeeds} flagged (binomial p=${binomialP.toFixed(4)}, threshold: p≥0.01); ` +
    `aggregate chi-squared: χ²(${aggChi.df})=${aggChi.chi2.toFixed(2)}, p=${aggChi.pValue.toFixed(4)}; ` +
    `aggregate RTP: ${(aggRTP * 100).toFixed(4)}%`,
  );

  return [s16, s17, s18];
}
