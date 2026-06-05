/**
 * Informational context items (live-bet statistics — not scored).
 *
 * At n < 1000/config, statistical tests have insufficient power.
 * These are displayed as informational context after scored steps.
 */

import type { VerifyContext, InfoItem } from './context';
import type { HandRank } from '../../src/types';
import { HAND_RANKS } from '../../src/types';
import { evaluateHand } from '../../src/hand-evaluator';
import { lag1Autocorrelation, runsTest } from '../../src/stats';
import videoPokerConfig from '../../videoPokerConfig.json';

const MULTIPLIERS = videoPokerConfig.multipliers as Record<HandRank, number>;

export function run(ctx: VerifyContext): InfoItem[] {
  const { bets, phaseA, phaseB } = ctx;
  const items: InfoItem[] = [];

  // 1. RTP Analysis — per phase
  const phases: Record<string, typeof bets> = {
    A: phaseA,
    B: phaseB,
    C: ctx.phaseC,
    D: ctx.phaseD,
    E: ctx.phaseE,
  };

  const rtpParts: string[] = [];
  for (const [label, phaseBets] of Object.entries(phases)) {
    if (phaseBets.length === 0) continue;
    let payout = 0;
    for (const b of phaseBets) payout += parseFloat(b.draw.response.multiplier);
    const rtp = payout / phaseBets.length;
    rtpParts.push(`${label}=${(rtp * 100).toFixed(2)}% (n=${phaseBets.length})`);
  }

  items.push({
    label: 'RTP Analysis',
    detail: `Post-draw empirical RTP: ${rtpParts.join(', ')}. ` +
      `Deviations from optimal-play RTP (99.9000%) reflect player hold decisions and sample variance. ` +
      `The authoritative optimal-play RTP (99.9000%) is established in Step 26 / the optimal-play solver; ` +
      `the deal-only steps (16–18) validate deal distribution, not the RTP figure.`,
  });

  // 2. Serial Independence (lag-1 autocorrelation) — Phase B only (largest uniform phase)
  if (phaseB.length >= 50) {
    const multSequence = phaseB.map(b => parseFloat(b.draw.response.multiplier));
    const lag1R = lag1Autocorrelation(multSequence);
    const lag1Z = lag1R * Math.sqrt(phaseB.length);
    const threshold = 3 / Math.sqrt(phaseB.length);

    items.push({
      label: 'Serial Independence (lag-1)',
      detail: `Phase B (n=${phaseB.length}): r₁=${lag1R.toFixed(4)} (±${threshold.toFixed(4)} = 3/√n threshold), z=${lag1Z.toFixed(2)}. ` +
        `Authoritative test: simulation Pass 1 at ${(10_000_000).toLocaleString()} deal-only rounds (distribution check, not the RTP figure).`,
    });
  }

  // 3. Serial Independence (Wald-Wolfowitz runs test) — Phase B only
  if (phaseB.length >= 50) {
    const multSequence = phaseB.map(b => parseFloat(b.draw.response.multiplier));
    const runs = runsTest(multSequence);

    items.push({
      label: 'Serial Independence (runs test)',
      detail: `Phase B: runs z=${runs.z.toFixed(2)}, p=${runs.pValue.toFixed(4)}. ` +
        `Live sample size insufficient for authoritative test.`,
    });
  }

  // 4. Hand Rank Distribution — live bets
  const rankCounts: Record<HandRank, number> = {} as Record<HandRank, number>;
  for (const r of HAND_RANKS) rankCounts[r] = 0;
  for (const b of bets) {
    const combo = b.draw.response.combination as HandRank;
    rankCounts[combo] = (rankCounts[combo] ?? 0) + 1;
  }

  const breakdown = HAND_RANKS
    .filter(r => rankCounts[r] > 0)
    .map(r => `${r}: ${rankCounts[r]}`)
    .join(', ');

  items.push({
    label: 'Hand Rank Distribution (Live Bets)',
    detail: `${bets.length} hands: ${breakdown}. ` +
      `Live distribution reflects player hold decisions (post-draw), not raw deal probabilities. ` +
      `Authoritative deal-only distribution validated in simulation Pass 1 (chi-squared) — deal distribution only, not the RTP figure. ` +
      `The authoritative RTP figure (99.9000%) is in Step 26 / the optimal-play solver.`,
  });

  return items;
}
