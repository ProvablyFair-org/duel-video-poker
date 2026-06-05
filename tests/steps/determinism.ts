/**
 * Steps 5–6: RNG Determinism
 *
 * Step 5 recomputes the full deck shuffle for every bet, then verifies:
 *   - initial_cards match deck[0..4]
 *   - replacement pool is deck[5..9]
 *   - final_cards match the held + pool replacement logic
 *
 * Step 6 proves the client seed is a genuine HMAC input.
 */

import type { StepResult, VerifyContext } from './context';
import { step } from './context';
import { computeShuffledDeck, computeFinalHand } from '../../src/rng';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap } = ctx;

  // ── Step 5: Outcome Recomputation ──────────────────────────────────────────
  let verified   = 0;
  let mismatches = 0;
  let skipped    = 0;
  const mismatchDetails: string[] = [];

  let reconstructedSkipped = 0;
  for (const b of bets) {
    // Skip reconstructed gap-filled bets — handled in Step 27
    if (b._reconstructed) { reconstructedSkipped++; skipped++; continue; }

    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { skipped++; continue; }

    const deck        = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce);
    const expInitial  = deck.slice(0, 5);
    const expPool     = deck.slice(5, 10);
    const expFinal    = computeFinalHand(expInitial, b.draw.response.held_cards, expPool);

    const initialMatch = arrEq(expInitial, b.draw.response.initial_cards!);
    const finalMatch   = arrEq(expFinal,   b.draw.response.final_cards!);

    if (initialMatch && finalMatch) {
      verified++;
    } else {
      mismatches++;
      if (mismatchDetails.length < 5) {
        const nonce = b.seed.nonce;
        const hash  = b.seed.serverSeedHashed.slice(0, 8);
        mismatchDetails.push(`nonce=${nonce} epoch=${hash}: initial=${initialMatch}, final=${finalMatch}`);
      }
    }
  }

  ctx.step5Mismatches = mismatches;
  ctx.step5Skipped    = skipped;

  const s5 = step(5, 'Outcome Recomputation',
    mismatches === 0 ? 'PASS' : 'FAIL',
    `${verified}/${bets.length} bets: deck shuffle + held-card replacement recomputed independently; ${mismatches} mismatches, ${skipped} skipped (${reconstructedSkipped} reconstructed + ${skipped - reconstructedSkipped} unrevealed seed)${mismatchDetails.length > 0 ? ' — ' + mismatchDetails.join('; ') : ''}`,
  );

  // ── Step 6: Client Seed Influence ──────────────────────────────────────────
  // For a sample of bets, recompute with a wrong client seed and verify the deck changes.
  let tested  = 0;
  let changed = 0;

  for (const b of bets) {
    if (tested >= 500) break;  // sample 500 bets
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;

    const correctDeck = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce);
    const wrongDeck   = computeShuffledDeck(ss, 'wrong-client-seed-test', b.seed.nonce);
    tested++;
    if (!arrEq(correctDeck, wrongDeck)) changed++;
  }

  const changeRate = tested > 0 ? changed / tested : 0;
  const s6 = step(6, 'Client Seed Influence',
    changeRate >= 0.95 ? 'PASS' : 'FAIL',
    `${changed}/${tested} sampled bets produce different decks with wrong client seed (${(changeRate * 100).toFixed(1)}% change rate)`,
  );

  return [s5, s6];
}

function arrEq(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
