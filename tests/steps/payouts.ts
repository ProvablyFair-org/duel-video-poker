/**
 * Steps 7–9: Payout Verification
 *
 * Step 7: amount_won = amount_coins × multiplier
 * Step 8: multiplier matches the pay table for the server-reported combination
 * Step 9: Phase C bet-size invariance — $10 bets compute same decks as $0.01
 */

import type { StepResult, VerifyContext } from './context';
import { step, finalHandOrNull } from './context';
import type { HandRank } from '../../src/types';
import { computeShuffledDeck } from '../../src/rng';
import { evaluateHand } from '../../src/hand-evaluator';
import { EXPECTED_BETS, EXPECTED_PHASE_BETS } from '../../src/loader';
import videoPokerConfig from '../../videoPokerConfig.json';

const MULTIPLIERS = videoPokerConfig.multipliers as Record<HandRank, number>;

/**
 * MONEY IS COMPARED EXACTLY, ON THE DECIMAL STRINGS THE SERVER SERVES (2026-09-26).
 *
 * Every stake (`deal.request.amount_coins`), multiplier and credited `amount_won` in this capture is a
 * plain decimal string (measured: amount_won carries 0 or 2 fractional digits, every multiplier is an
 * integer string). Each is parsed to an exact integer count of 1e-18 units (BigInt, no float) and a win
 * must satisfy payout × 10^18 = stake × multiplier EXACTLY — the product is exact in decimal, so there
 * is nothing to round. This replaces `|expected − won| ≤ 1e-12 × max(|expected|, 1)` on parsed doubles,
 * a bound that forgave any nudge below it. A string that is not a plain decimal, or has more than 18
 * fractional digits, is an error; a win whose exact product is not on the 1e-18 grid (possible only for
 * the royal-flush multiplier 812.9719437907615 at stakes the capture never reached) is an error rather
 * than a guess at the operator's rounding rule — no royal flush is in the capture.
 */
export const MONEY_DECIMALS = 18;
const UNIT = 10n ** BigInt(MONEY_DECIMALS);
export function toUnits(v: unknown): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(v ?? ''));
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > MONEY_DECIMALS) return null;
  return BigInt(m[1] + frac.padEnd(MONEY_DECIMALS, '0'));
}

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, phaseC, seedMap } = ctx;

  let payoutErrors = 0;
  let winsChecked  = 0;
  let lossesChecked = 0;
  const payoutDetails: string[] = [];

  for (const b of bets) {
    const mult = toUnits(b.draw.response.multiplier);
    const amt  = toUnits(b.deal.request.amount_coins);
    const won  = toUnits(b.draw.response.amount_won);

    if (mult === null || amt === null || won === null) {
      payoutErrors++;
      if (payoutDetails.length < 3) {
        payoutDetails.push(`hand_id=${b.draw.response.hand_id}: money field not a decimal on the 1e-${MONEY_DECIMALS} grid `
          + `(amount_coins=${b.deal.request.amount_coins}, multiplier=${b.draw.response.multiplier}, amount_won=${b.draw.response.amount_won})`);
      }
      continue;
    }

    if (mult === 0n) {
      lossesChecked++;
      if (won !== 0n) {
        payoutErrors++;
        if (payoutDetails.length < 3) payoutDetails.push(`hand_id=${b.draw.response.hand_id}: loss but amount_won=${b.draw.response.amount_won}`);
      }
    } else {
      winsChecked++;
      const product = amt * mult;               // in 1e-36 units
      if (product % UNIT !== 0n) {
        payoutErrors++;
        if (payoutDetails.length < 3) payoutDetails.push(`hand_id=${b.draw.response.hand_id}: stake × multiplier is not on the 1e-${MONEY_DECIMALS} grid — no rounding rule is declared`);
      } else if (product / UNIT !== won) {
        payoutErrors++;
        if (payoutDetails.length < 3) payoutDetails.push(`hand_id=${b.draw.response.hand_id}: stake ${b.deal.request.amount_coins} × ${b.draw.response.multiplier} `
          + `!= amount_won ${b.draw.response.amount_won} (diff ${won - product / UNIT} units of 1e-${MONEY_DECIMALS})`);
      }
    }
  }

  const s7Issues: string[] = [];
  if (bets.length !== EXPECTED_BETS) s7Issues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (winsChecked === 0) s7Issues.push('no winning bet was validated — a payout check that examined no payout is not a result');
  if (winsChecked + lossesChecked + payoutErrors < bets.length) s7Issues.push(`${bets.length - winsChecked - lossesChecked} bet(s) neither validated nor counted as errors`);

  const s7 = step(7, 'Payout Math',
    payoutErrors === 0 && s7Issues.length === 0 ? 'PASS' : 'FAIL',
    payoutErrors > 0
      ? `${payoutErrors} payout error(s) across ${bets.length} bets: ${payoutDetails.join('; ')}`
      : s7Issues.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s7Issues.join('; ')}`
        : `${EXPECTED_BETS} bets checked EXACTLY on the served decimal strings (integer 1e-${MONEY_DECIMALS} units, BigInt, no `
          + `tolerance): ${winsChecked} wins validated as amount_won = amount_coins × multiplier, ${lossesChecked} losses `
          + `validated as amount_won = 0. 0 errors, 0 unparseable money fields.`,
    { bets: bets.length, expectedBets: EXPECTED_BETS, winsChecked, lossesChecked, errors: payoutErrors, moneyDecimals: MONEY_DECIMALS },
  );

  // ── Step 8: Multiplier Provenance ────────────────────────────────────────────
  // The multiplier reported by the server must BE the config's multiplier for that combination.
  // The old bound, |expected − actual| > 1e-10, was a tolerance on an identity: both sides are
  // the same decimal literal parsed by the same parseFloat, so any honest pair is bit-identical
  // and anything else is a different multiplier. Measured on this capture: all 5,400 served
  // multiplier strings parse to exactly the config value. Compared with ===, and a string that
  // does not parse is an error rather than a NaN that no comparison can catch.
  let multErrors = 0;
  let multChecked = 0;
  const multErrDetails: string[] = [];

  for (const b of bets) {
    const combo    = b.draw.response.combination as HandRank;
    const expected = MULTIPLIERS[combo];
    const actual   = parseFloat(b.draw.response.multiplier);

    if (expected === undefined) {
      multErrors++;
      if (multErrDetails.length < 3) multErrDetails.push(`hand_id=${b.draw.response.hand_id}: unknown combination "${combo}"`);
    } else if (!Number.isFinite(actual)) {
      multErrors++;
      if (multErrDetails.length < 3) multErrDetails.push(`hand_id=${b.draw.response.hand_id}: unparseable multiplier "${b.draw.response.multiplier}"`);
    } else if (actual !== expected) {
      multErrors++;
      if (multErrDetails.length < 3) multErrDetails.push(`hand_id=${b.draw.response.hand_id}: ${combo} expected=${expected}, got=${b.draw.response.multiplier}`);
    } else {
      multChecked++;
    }
  }
  const s8Issues: string[] = [];
  if (bets.length !== EXPECTED_BETS) s8Issues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (multChecked + multErrors !== bets.length) s8Issues.push(`${bets.length - multChecked - multErrors} bet(s) neither matched nor counted as errors`);

  const s8 = step(8, 'Multiplier Provenance',
    multErrors === 0 && s8Issues.length === 0 ? 'PASS' : 'FAIL',
    multErrors > 0
      ? `${multErrors} of ${bets.length} bets: served multiplier is not the videoPokerConfig.json value for its combination: ${multErrDetails.join('; ')}`
      : s8Issues.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s8Issues.join('; ')}`
        : `${multChecked}/${EXPECTED_BETS} bets: the served multiplier equals the videoPokerConfig.json multiplier `
          + `for its combination exactly (===, no tolerance). 0 errors.`,
    { bets: bets.length, expectedBets: EXPECTED_BETS, exactMatches: multChecked, errors: multErrors },
  );

  // ── Step 9: Phase C Bet-Size Invariance ──────────────────────────────────────
  // Phase C bets ($10/hand) must produce the same shuffled deck as $0.01 bets
  // with the same (serverSeed, clientSeed, nonce).
  //
  // An empty Phase C used to return PASS with the words "step N/A". A step that examined
  // nothing reported success, so deleting the Phase C bets was a way to make this check
  // disappear without any hard-fail. The capture contains Phase C and the count is pinned, so
  // an empty one is now a FAIL; the number recomputed is bound too, since a bet skipped for
  // want of a revealed seed is a bet this step did not decide.
  // Extended 2026-09-26 (profile VP-12): the elevated-stake bet must recompute its FINAL hand too,
  // classify to its served rank, be served the same paytable cell as any base-stake bet with that
  // rank, and — for a paying hand — be credited exactly stake × multiplier. The elevated-stake paying
  // hands are counted, so the payout path at elevated stake is shown exercised, not assumed.
  let invVerified = 0;
  let invFailed   = 0;
  let invSkipped  = 0;
  let elevatedWins = 0;
  const invDetails: string[] = [];

  for (const b of phaseC) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { invSkipped++; continue; }

    const deck       = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce);
    const expInitial = deck.slice(0, 5);
    const expFinal   = finalHandOrNull(expInitial, b.draw.response.held_cards, deck.slice(5, 10));
    const rank       = expFinal ? evaluateHand(expFinal) : null;
    const mult       = toUnits(b.draw.response.multiplier);
    const amt        = toUnits(b.deal.request.amount_coins);
    const won        = toUnits(b.draw.response.amount_won);
    const cell       = MULTIPLIERS[rank as HandRank];
    const bad: string[] = [];
    if (!arrEq(expInitial, b.draw.response.initial_cards!)) bad.push('initial hand');
    if (!arrEq(expFinal, b.draw.response.final_cards!)) bad.push('final hand');
    if (rank !== b.draw.response.combination) bad.push('rank');
    if (cell === undefined || parseFloat(b.draw.response.multiplier) !== cell) bad.push('paytable cell');
    if (mult === null || amt === null || won === null || (mult === 0n ? won !== 0n : (amt * mult) !== won * UNIT)) bad.push('payout');
    if (mult !== null && mult > 0n) elevatedWins++;
    if (bad.length === 0) invVerified++;
    else { invFailed++; if (invDetails.length < 3) invDetails.push(`hand_id=${b.draw.response.hand_id}: ${bad.join('+')}`); }
  }

  const expectedPhaseC = EXPECTED_PHASE_BETS.C;
  const s9Issues: string[] = [];
  if (phaseC.length !== expectedPhaseC) s9Issues.push(`Phase C bets ${phaseC.length} != ${expectedPhaseC}`);
  if (invSkipped !== 0) s9Issues.push(`${invSkipped} Phase C bet(s) not recomputable — their epoch seed was never revealed`);
  if (invVerified !== expectedPhaseC) s9Issues.push(`recomputed ${invVerified} != ${expectedPhaseC}`);

  const s9 = step(9, 'Phase C Bet-Size Invariance',
    invFailed === 0 && s9Issues.length === 0 ? 'PASS' : 'FAIL',
    invFailed > 0
      ? `${invFailed} of ${phaseC.length} Phase C bets disagree with the recomputation: ${invDetails.join('; ')}`
      : s9Issues.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s9Issues.join('; ')}`
        : `All ${expectedPhaseC} Phase C bets at $10/hand recompute to the same shuffled deck the `
          + `$0.01 bets produce from the same (serverSeed, clientSeed, nonce) — the stake is not an `
          + `RNG input — and to their served final hand and rank, are served the same paytable cell as any `
          + `base-stake hand of that rank, and are credited exactly stake × multiplier; ${elevatedWins} of the `
          + `${expectedPhaseC} are paying hands. 0 skipped.`,
    { phaseCBets: phaseC.length, expectedPhaseC, recomputed: invVerified, mismatches: invFailed, skipped: invSkipped, elevatedWins },
  );

  return [s7, s8, s9];
}

function arrEq(a: readonly string[] | null, b: readonly string[]): boolean {
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
