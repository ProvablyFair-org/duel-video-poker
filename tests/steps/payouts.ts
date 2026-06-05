/**
 * Steps 7–9: Payout Verification
 *
 * Step 7: amount_won = amount_coins × multiplier
 * Step 8: multiplier matches the pay table for the server-reported combination
 * Step 9: Phase C bet-size invariance — $10 bets compute same decks as $0.01
 */

import type { StepResult, VerifyContext } from './context';
import { step } from './context';
import type { HandRank } from '../../src/types';
import { computeShuffledDeck } from '../../src/rng';
import videoPokerConfig from '../../videoPokerConfig.json';

const MULTIPLIERS = videoPokerConfig.multipliers as Record<HandRank, number>;

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, phaseC, seedMap } = ctx;

  // ── Step 7: Payout Math ──────────────────────────────────────────────────────
  let payoutErrors = 0;
  const payoutDetails: string[] = [];

  let winsChecked = 0;
  for (const b of bets) {
    const mult = parseFloat(b.draw.response.multiplier);
    const amt  = parseFloat(b.deal.request.amount_coins);
    const won  = parseFloat(b.draw.response.amount_won);

    if (!Number.isFinite(amt)) {
      payoutErrors++;
      if (payoutDetails.length < 3) payoutDetails.push(`hand_id=${b.draw.response.hand_id}: amount_coins missing/garbage (got ${b.deal.request.amount_coins})`);
      continue;
    }

    if (mult === 0) {
      // Loss — amount_won should be 0 or very close
      if (Math.abs(won) > 1e-12) {
        payoutErrors++;
        if (payoutDetails.length < 3) payoutDetails.push(`hand_id=${b.draw.response.hand_id}: loss but won=${won}`);
      }
    } else {
      // Win — amount_won should equal amount × multiplier
      winsChecked++;
      const expected = amt * mult;
      if (Math.abs(expected - won) > 1e-6) {
        payoutErrors++;
        if (payoutDetails.length < 3) payoutDetails.push(`hand_id=${b.draw.response.hand_id}: expected=${expected}, got=${won}`);
      }
    }
  }

  const s7 = step(7, 'Payout Math',
    payoutErrors === 0 ? 'PASS' : 'FAIL',
    `${bets.length} bets checked (${winsChecked} wins actively validated); amount_won = amount_coins × multiplier (tolerance 1e-6); ${payoutErrors} errors${payoutDetails.length > 0 ? ': ' + payoutDetails.join('; ') : ''}`,
  );

  // ── Step 8: Multiplier Provenance ────────────────────────────────────────────
  // The multiplier reported by the server must match our config for that combination.
  let multErrors = 0;
  const multErrDetails: string[] = [];

  for (const b of bets) {
    const combo    = b.draw.response.combination as HandRank;
    const expected = MULTIPLIERS[combo];
    const actual   = parseFloat(b.draw.response.multiplier);

    if (expected === undefined) {
      multErrors++;
      if (multErrDetails.length < 3) multErrDetails.push(`hand_id=${b.draw.response.hand_id}: unknown combination "${combo}"`);
    } else if (Math.abs(expected - actual) > 1e-10) {
      multErrors++;
      if (multErrDetails.length < 3) multErrDetails.push(`hand_id=${b.draw.response.hand_id}: ${combo} expected=${expected}, got=${actual}`);
    }
  }

  const s8 = step(8, 'Multiplier Provenance',
    multErrors === 0 ? 'PASS' : 'FAIL',
    `${bets.length} bets: combination → multiplier matches videoPokerConfig.json for all; ${multErrors} errors${multErrDetails.length > 0 ? ': ' + multErrDetails.join('; ') : ''}`,
  );

  // ── Step 9: Phase C Bet-Size Invariance ──────────────────────────────────────
  // Phase C bets ($10/hand) must produce the same shuffled deck as $0.01 bets
  // with the same (serverSeed, clientSeed, nonce).
  if (phaseC.length === 0) {
    const s9 = step(9, 'Phase C Bet-Size Invariance', 'PASS', 'No Phase C bets in dataset — step N/A');
    return [s7, s8, s9];
  }

  let invVerified = 0;
  let invFailed   = 0;

  for (const b of phaseC) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;

    const deck       = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce);
    const expInitial = deck.slice(0, 5);

    if (arrEq(expInitial, b.draw.response.initial_cards!)) {
      invVerified++;
    } else {
      invFailed++;
    }
  }

  const s9 = step(9, 'Phase C Bet-Size Invariance',
    invFailed === 0 ? 'PASS' : 'FAIL',
    `${invVerified}/${phaseC.length} Phase C ($10/hand) bets: deck shuffle is identical regardless of bet amount; ${invFailed} mismatches`,
  );

  return [s7, s8, s9];
}

function arrEq(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
