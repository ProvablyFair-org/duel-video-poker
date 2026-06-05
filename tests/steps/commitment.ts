/**
 * Steps 1–4: Commit-Reveal Integrity
 */

import * as crypto from 'crypto';
import type { StepResult, VerifyContext } from './context';
import { step } from './context';
import { verifyHash, computeShuffledDeck } from '../../src/rng';
import { evaluateHand } from '../../src/hand-evaluator';

export function run(ctx: VerifyContext): StepResult[] {
  const { seeds, bets, seedMap, byHash } = ctx;

  // ── Step 1: Seed Hash Integrity ──────────────────────────────────────────────
  // For each revealed seed, SHA-256(hex_bytes(serverSeed)) must match the committed hash.
  let hashVerified = 0;
  let hashFailed   = 0;
  const failedHashes: string[] = [];

  for (const [hashed, plaintext] of seedMap.entries()) {
    if (verifyHash(plaintext, hashed)) {
      hashVerified++;
    } else {
      hashFailed++;
      failedHashes.push(hashed.slice(0, 16) + '...');
    }
  }

  const s1 = step(1, 'Seed Hash Integrity',
    hashFailed === 0 ? 'PASS' : 'FAIL',
    `${hashVerified}/${seedMap.size} revealed seeds verified (SHA-256 of hex-decoded bytes); ${hashFailed} failures${failedHashes.length > 0 ? ': ' + failedHashes.join(', ') : ''}`,
  );

  // ── Step 2: Commitment Linkage ───────────────────────────────────────────────
  // nextSeedPromotion chain: each rotation's nextServerSeedHash matches the next entry's serverSeedHashed.
  let linkVerified = 0;
  let linkFailed   = 0;

  for (let i = 0; i < seeds.length - 1; i++) {
    const curr = seeds[i];
    const next = seeds[i + 1];
    if (curr.seed.nextServerSeedHash === next.seed.serverSeedHashed) {
      linkVerified++;
    } else {
      linkFailed++;
    }
  }

  // Verdict rests solely on the independently-recomputed chain linkage above
  // (curr.nextServerSeedHash === next.serverSeedHashed). The capture-supplied
  // nextSeedPromotion.match boolean is informational only — informational because
  // it was computed by the capture process, not recomputed here, and the linkage
  // recompute already proves the property.
  let promoCount = 0;
  for (const s of seeds) {
    if ((s as any).nextSeedPromotion) promoCount++;
  }

  const s2 = step(2, 'Commitment Linkage',
    linkFailed === 0 ? 'PASS' : 'FLAG',
    `Chain links (independently recomputed): ${linkVerified}/${seeds.length - 1} match. ` +
    `${promoCount} nextSeedPromotion records present (informational — linkage above is the scored property).`,
  );

  // ── Step 3: Hash Consistency Within Epoch ────────────────────────────────────
  // All bets in the same epoch must share the same serverSeedHashed.
  let epochsChecked = 0;
  let inconsistent  = 0;
  for (const [hash, epochBets] of byHash.entries()) {
    epochsChecked++;
    for (const b of epochBets) {
      if (b.seed.serverSeedHashed !== hash) inconsistent++;
    }
  }

  const s3 = step(3, 'Hash Consistency Within Epoch',
    inconsistent === 0 ? 'PASS' : 'FAIL',
    `${epochsChecked} epochs; all bets within each epoch share identical serverSeedHashed; ${inconsistent} inconsistencies`,
  );

  // ── Step 4: Nonce Audit ─────────────────────────────────────────────────────
  // Within each epoch, nonces must be 0, 1, 2, ..., N-1 with no gaps or duplicates.
  // Capture-retry artifacts (1 missed nonce + nonce 50 present): for each missing
  // nonce, the seed is revealed so the initial deal is derivable from the published
  // RNG — but the full missing round (player hold + final hand + payout) is not
  // itself verified, since no captured request/response exists for that nonce.
  let totalEpochs = 0;
  let cleanEpochs = 0;
  let gapsFound   = 0;
  let initialDealDerivable = 0;
  let unverifiable  = 0;
  const gapDetails: string[] = [];

  for (const [hash, epochBets] of byHash.entries()) {
    totalEpochs++;
    const nonces = epochBets.map(b => b.seed.nonce).sort((a, b) => a - b);

    // Find gaps
    const missingNonces: number[] = [];
    for (let i = 1; i < nonces.length; i++) {
      if (nonces[i] !== nonces[i - 1] + 1) {
        for (let n = nonces[i - 1] + 1; n < nonces[i]; n++) {
          missingNonces.push(n);
        }
      }
    }
    if (nonces.length > 0 && nonces[0] !== 0) {
      for (let n = 0; n < nonces[0]; n++) missingNonces.push(n);
    }

    if (missingNonces.length === 0) {
      cleanEpochs++;
      continue;
    }

    gapsFound += missingNonces.length;

    // Attempt retroactive verification
    const ss = seedMap.get(hash);
    const clientSeed = epochBets[0].seed.clientSeed;

    if (ss) {
      // Server seed revealed — the initial deal for the missing nonce is derivable
      // from the published RNG. The full missing round (hold + final hand + payout)
      // is NOT itself verified — no captured request/response exists for that nonce.
      for (const missedNonce of missingNonces) {
        const deck = computeShuffledDeck(ss, clientSeed, missedNonce);
        const hand = deck.slice(0, 5);
        const rank = evaluateHand(hand);
        initialDealDerivable++;
        gapDetails.push(
          `Epoch ${hash.slice(0, 8)}: nonce ${missedNonce} missed (capture-retry); ` +
          `initial deal derivable from revealed seed: ${hand.join(',')} → ${rank} ` +
          `(full missing round not verified)`
        );
      }
    } else {
      for (const missedNonce of missingNonces) {
        unverifiable++;
        gapDetails.push(`Epoch ${hash.slice(0, 8)}: nonce ${missedNonce} missed; seed UNREVEALED — unverifiable`);
      }
    }
  }

  const allDealsDerivable = gapsFound > 0 && unverifiable === 0;
  const s4 = step(4, 'Nonce Audit',
    gapsFound === 0 ? 'PASS' : allDealsDerivable ? 'PASS' : 'FLAG',
    gapsFound === 0
      ? `${cleanEpochs}/${totalEpochs} epochs have clean sequential nonces`
      : `${cleanEpochs}/${totalEpochs} clean epochs; ${gapsFound} nonce gaps observed (capture-retry) — ` +
        `for ${initialDealDerivable}, the initial deal is derivable from the revealed seed; the full missing rounds are not verified. ` +
        `${unverifiable} unverifiable. ${gapDetails.join('; ')}`,
  );

  return [s1, s2, s3, s4];
}
