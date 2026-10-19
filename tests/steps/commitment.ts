/**
 * Steps 1–4: Commit-Reveal Integrity
 */

import * as crypto from 'crypto';
import type { StepResult, VerifyContext } from './context';
import { step } from './context';
import { verifyHash, computeShuffledDeck } from '../../src/rng';
import { evaluateHand } from '../../src/hand-evaluator';
import {
  EXPECTED_SEEDS, EXPECTED_EPOCHS, EXPECTED_CHAIN_LINKS, EXPECTED_PHASE_BOUNDARY_SKIPS,
  EXPECTED_UNREVEALED_SEEDS, EXPECTED_REVEALED_EPOCHS, EXPECTED_CAPTURE_RETRY_GAPS,
} from '../../src/loader';

export function run(ctx: VerifyContext): StepResult[] {
  const { seeds, bets, seedMap, byHash } = ctx;

  // ── Step 1: Seed Hash Integrity ──────────────────────────────────────────────
  // THIS STEP COULD NOT FAIL. It walked `seedMap` and re-tested `verifyHash(plaintext,
  // hashed)` on every entry — but `buildSeedMap` in src/loader.ts only INSERTS a pair after
  // checking that same condition, so a pair that failed the hash never reached the map and
  // `hashFailed` was structurally always 0. The step re-asked a question the map's construction
  // had already answered affirmatively by discarding every counterexample, and reported the
  // size of the filtered survivors as though it were a result.
  //
  // The seed array is walked directly here, so a seed whose plaintext does NOT hash to its
  // commitment is counted rather than silently dropped, and the totals are bound to the
  // population declared in src/loader.ts — because "0 mismatches" over an empty or truncated
  // list is not a result either.
  let verified = 0, fails = 0, phaseBoundarySkips = 0, unrevealed = 0;
  const failedHashes: string[] = [];

  for (let i = 0; i < seeds.length; i++) {
    const ss = seeds[i].seed.serverSeed;
    if (!ss) { unrevealed++; continue; }
    // seeds[i].serverSeed is the plaintext of the PRECEDING entry's commitment: a rotation
    // reveals the seed it is retiring, not the one it is activating.
    if (i === 0) { unrevealed++; continue; }
    const prevHash = seeds[i - 1].seed.serverSeedHashed;
    if (verifyHash(ss, prevHash)) { verified++; continue; }
    if (seeds[i].phase !== seeds[i - 1].phase) { phaseBoundarySkips++; continue; }
    fails++;
    failedHashes.push(`seed[${i}] -> ${prevHash.slice(0, 16)}...`);
  }

  const s1Issues: string[] = [];
  if (seeds.length !== EXPECTED_SEEDS) s1Issues.push(`seed records ${seeds.length} != ${EXPECTED_SEEDS}`);
  if (unrevealed !== EXPECTED_UNREVEALED_SEEDS) {
    s1Issues.push(`unrevealed seeds ${unrevealed} != ${EXPECTED_UNREVEALED_SEEDS} in the capture plan`);
  }
  if (verified + phaseBoundarySkips !== EXPECTED_CHAIN_LINKS) {
    s1Issues.push(`${verified} verified + ${phaseBoundarySkips} boundary != ${EXPECTED_CHAIN_LINKS} transitions`);
  }
  if (phaseBoundarySkips !== EXPECTED_PHASE_BOUNDARY_SKIPS) {
    s1Issues.push(`${phaseBoundarySkips} phase-boundary skips != ${EXPECTED_PHASE_BOUNDARY_SKIPS} in the capture plan`);
  }
  if (seedMap.size !== EXPECTED_REVEALED_EPOCHS) {
    s1Issues.push(`${seedMap.size} epochs have a usable plaintext != ${EXPECTED_REVEALED_EPOCHS}`);
  }

  const s1 = step(1, 'Seed Hash Integrity',
    fails === 0 && s1Issues.length === 0 ? 'PASS' : 'FAIL',
    fails > 0
      ? `${fails} revealed seeds do NOT hash to their commitment: ${failedHashes.slice(0, 3).join('; ')}`
      : s1Issues.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s1Issues.join('; ')}`
        : `All ${EXPECTED_SEEDS} seed records walked directly. ${EXPECTED_CHAIN_LINKS} transitions accounted `
          + `for — ${EXPECTED_CHAIN_LINKS - EXPECTED_PHASE_BOUNDARY_SKIPS} whose revealed plaintext hashes to `
          + `the preceding commitment, ${EXPECTED_PHASE_BOUNDARY_SKIPS} phase-opening rotations that reveal the `
          + `previous phase's last bet-bearing seed (the end-of-phase record before each has no bets and `
          + `is never revealed in the capture). `
          + `${EXPECTED_UNREVEALED_SEEDS} seed is unrevealed (the first, retired before capture began), and `
          + `${EXPECTED_REVEALED_EPOCHS} epochs carry a usable plaintext.`,
    { seedRecords: seeds.length, expectedSeeds: EXPECTED_SEEDS, verified, phaseBoundarySkips,
      unrevealed, mismatches: fails, usableEpochs: seedMap.size },
  );

  // ── Step 2: Commitment Linkage ───────────────────────────────────────────────
  // Set membership proves a bet was served under SOME captured seed. It says nothing about
  // ORDER, and order is the whole property: without it an operator may pick, after seeing the
  // bet, which of the seeds it already holds to serve it under. The forward commitment removes
  // that freedom — every rotation publishes the hash of the seed it will activate NEXT.
  //
  // The chain itself was already checked. What was missing: a broken link was a FLAG rather
  // than a FAIL, so the suite still reported "PROVABLY FAIR"; the first epoch had no anchor at
  // all; and `nextSeedPromotion.match`, a boolean the CAPTURE SCRIPT wrote, was trusted rather
  // than cross-checked against the recomputation.
  const chainFailures: string[] = [];
  let linksChecked = 0, linksOk = 0;

  for (let i = 0; i < seeds.length - 1; i++) {
    linksChecked++;
    if (seeds[i].seed.nextServerSeedHash === seeds[i + 1].seed.serverSeedHashed) linksOk++;
    else chainFailures.push(
      `seed[${i}].nextServerSeedHash != seed[${i + 1}].serverSeedHashed — epoch ${i + 1} was not pre-committed by epoch ${i}`);
  }

  // The first captured epoch has no predecessor inside the capture, so the chain above cannot
  // reach it. Its own rotation record carries the hash that was standing as "next" BEFORE
  // capture began; that is the pre-capture link, and it is the only evidence that the first
  // epoch was committed rather than chosen. An ABSENT link must FAIL — if it passed quietly,
  // deleting the field would be a way to make the check disappear.
  const first = seeds[0];
  const preCapture = (first as any)?.nextSeedPromotion;
  let preCaptureOk = false;
  if (!preCapture) {
    chainFailures.push('seed[0] carries no nextSeedPromotion — the pre-capture link is ABSENT, not satisfied');
  } else if (preCapture.previousNextHash !== first.seed.serverSeedHashed) {
    chainFailures.push('seed[0]: the hash standing as "next" before capture != the first epoch\'s active hash');
  } else {
    preCaptureOk = true;
  }

  // Cross-check the capture script's own verdict against what was just recomputed.
  let promoChecked = 0, promoDisagreements = 0;
  for (const s of seeds) {
    const promo = (s as any).nextSeedPromotion;
    if (!promo) continue;
    promoChecked++;
    const recomputed = promo.previousNextHash === promo.newActiveHash;
    if (recomputed !== promo.match) promoDisagreements++;
  }
  if (promoDisagreements > 0) {
    chainFailures.push(
      `${promoDisagreements} rotation record(s) where the capture script's stored \`match\` disagrees with the recomputed hashes`);
  }
  if (linksChecked !== EXPECTED_CHAIN_LINKS) {
    chainFailures.push(`${linksChecked} chain links != ${EXPECTED_CHAIN_LINKS} in the capture plan`);
  }
  if (promoChecked !== EXPECTED_SEEDS) {
    chainFailures.push(`${promoChecked} rotation records != ${EXPECTED_SEEDS} in the capture plan`);
  }

  const s2 = step(2, 'Commitment Linkage',
    chainFailures.length === 0 ? 'PASS' : 'FAIL',
    chainFailures.length > 0
      ? `Forward commitment chain broken: ${chainFailures.slice(0, 3).join('; ')}`
      : `All ${EXPECTED_CHAIN_LINKS} epoch transitions recomputed from the raw hashes: each epoch's `
        + `serverSeedHashed equals the previous rotation record's nextServerSeedHash, and the first epoch's `
        + `active hash equals the hash the capture read as "next" before its first rotation (the pre-capture `
        + `link). Link equality is a consistency check: it shows the ${EXPECTED_SEEDS} records fit together, `
        + `not when each hash was shown; that each next hash was shown before its epoch's bets rests on the `
        + `capture's rotation records (capture integrity assumed, MANIFEST premise P5). The capture script's `
        + `own \`match\` flags agree with the recomputation on all ${EXPECTED_SEEDS} records.`,
    {
      chainLinksChecked: linksChecked,
      chainLinksOk: linksOk,
      expectedChainLinks: EXPECTED_CHAIN_LINKS,
      preCaptureLinkPresent: preCapture !== undefined,
      preCaptureLinkVerified: preCaptureOk,
      rotationRecords: promoChecked,
      captureFlagDisagreements: promoDisagreements,
    },
  );

  // ── Step 3: Hash Consistency Within Epoch ────────────────────────────────────
  // THE OLD FORM WAS A TAUTOLOGY. Bets were grouped BY their own serverSeedHashed (src/loader.ts
  // groupByHash) and the step then asserted that every bet in a group carried the group's hash —
  // true of any input whatsoever, including a dataset in which every bet carried a different
  // hash. Its FAIL branch was unreachable.
  //
  // Epoch membership now comes from the capture TIMELINE (src/loader.ts groupByEpochWindow): a
  // bet belongs to the last rotation record that precedes it. That source never reads the bet's
  // hash, so the claim is falsifiable: every bet served while rotation record i was active must
  // carry record i's committed serverSeedHashed AND record i's clientSeed. Same construction as
  // Duel mines.
  const { epochs, orphanBets } = ctx;
  const s3Failures: string[] = [];
  let betBearing = 0, emptyEpochs = 0;
  for (const e of epochs) {
    if (e.bets.length === 0) { emptyEpochs++; continue; }
    betBearing++;
    const tag = `seeds[${e.index}] (${e.record.seed.serverSeedHashed.substring(0, 16)})`;
    const hashes  = new Set(e.bets.map(b => b.seed.serverSeedHashed));
    const clients = new Set(e.bets.map(b => b.seed.clientSeed));
    if (hashes.size !== 1) {
      s3Failures.push(`${tag}: ${hashes.size} distinct serverSeedHashed among its ${e.bets.length} bets`);
    } else if (!hashes.has(e.record.seed.serverSeedHashed)) {
      s3Failures.push(`${tag}: its bets carry ${[...hashes][0].substring(0, 16)}, not the hash the rotation committed`);
    }
    if (clients.size !== 1) {
      s3Failures.push(`${tag}: ${clients.size} distinct client seeds among its bets`);
    } else if (!clients.has(e.record.seed.clientSeed)) {
      s3Failures.push(`${tag}: its bets carry client seed ${[...clients][0]}, not the rotation record's ${e.record.seed.clientSeed}`);
    }
  }
  if (orphanBets.length > 0) {
    s3Failures.push(`${orphanBets.length} bet(s) captured before any rotation record — no epoch can claim them`);
  }
  if (betBearing !== EXPECTED_EPOCHS) {
    s3Failures.push(`${betBearing} bet-bearing epochs != ${EXPECTED_EPOCHS} in the capture plan`);
  }
  if (emptyEpochs !== EXPECTED_SEEDS - EXPECTED_EPOCHS) {
    s3Failures.push(`${emptyEpochs} rotation records without bets != ${EXPECTED_SEEDS - EXPECTED_EPOCHS} (the end-of-phase rotations)`);
  }

  const s3 = step(3, 'Hash Consistency Within Epoch',
    s3Failures.length === 0 ? 'PASS' : 'FAIL',
    s3Failures.length > 0
      ? `${s3Failures.length} disagreement(s) between the bets and their rotation record: ${s3Failures.slice(0, 3).join('; ')}`
      : `Epochs keyed by the capture timeline, not by the bets' own hash: every bet served under each of `
        + `the ${EXPECTED_EPOCHS} bet-bearing rotation records carries that record's committed serverSeedHashed `
        + `and its clientSeed; the ${EXPECTED_SEEDS - EXPECTED_EPOCHS} remaining records are the end-of-phase `
        + `rotations and carry no bets. 0 orphan bets.`,
    { rotationRecords: epochs.length, betBearingEpochs: betBearing, emptyEpochs, orphanBets: orphanBets.length,
      disagreements: s3Failures.length },
  );

  // ── Step 4: Nonce Audit ─────────────────────────────────────────────────────
  // Within each epoch, nonces must run 0, 1, 2, ... with no duplicates.
  //
  // The old form could not FAIL on anything. A duplicated nonce produced no gap and passed
  // silently; a gap under an unrevealed seed was only a FLAG; and the two capture-retry gaps —
  // whose full round (hold, final hand, payout) was never witnessed — were scored PASS. Now:
  //   - a duplicated nonce, or a gap whose epoch seed is not revealed, is a FAIL;
  //   - the number of gaps is bound to the capture plan (src/loader.ts EXPECTED_CAPTURE_RETRY_GAPS),
  //     so a gap more or a gap fewer is a different dataset and FAILs;
  //   - the planned gaps are a capture-origin FLAG, not a PASS: the revealed seed (which hashes
  //     to the pre-bet commitment) fixes the initial deal at the missed nonce, but the round
  //     itself was not captured. Disclosed on every run, verdict-neutral (same rule as plinko).
  let totalEpochs = 0;
  let cleanEpochs = 0;
  let gapsFound   = 0;
  let duplicates  = 0;
  let initialDealDerivable = 0;
  let unverifiable  = 0;
  const gapDetails: string[] = [];
  const s4Failures: string[] = [];

  let reordered = 0;
  for (const [hash, epochBets] of byHash.entries()) {
    totalEpochs++;

    // ORDER (added 2026-10-19, Mike's QA). The gap and duplicate checks below run on the SORTED
    // nonce set, so on their own they cannot see a sequence served out of order: nonce 6 before
    // nonce 5 sorts to the same set, and every deck still recomputes from its own nonce. In
    // capture order (each bet's `at`; array order breaks a tie) every nonce must exceed the one
    // served before it. Mutation M04c swaps two capture times and must FAIL here.
    const inCaptureOrder = epochBets
      .map((b, i) => ({ b, i }))
      .sort((x, y) => (x.b.at < y.b.at ? -1 : x.b.at > y.b.at ? 1 : x.i - y.i))
      .map(x => x.b);
    let reorderedHere = 0;
    for (let i = 1; i < inCaptureOrder.length; i++) {
      if (inCaptureOrder[i].seed.nonce < inCaptureOrder[i - 1].seed.nonce) reorderedHere++;
    }
    if (reorderedHere > 0) {
      reordered += reorderedHere;
      s4Failures.push(`Epoch ${hash.slice(0, 8)}: ${reorderedHere} nonce(s) served below the nonce served before them (out of order in capture time)`);
    }

    const nonces = epochBets.map(b => b.seed.nonce).sort((a, b) => a - b);

    const dupHere = nonces.length - new Set(nonces).size;
    if (dupHere > 0) {
      duplicates += dupHere;
      s4Failures.push(`Epoch ${hash.slice(0, 8)}: ${dupHere} duplicated nonce(s) — one nonce served twice`);
    }

    // Find gaps
    const missingNonces: number[] = [];
    for (let i = 1; i < nonces.length; i++) {
      if (nonces[i] > nonces[i - 1] + 1) {
        for (let n = nonces[i - 1] + 1; n < nonces[i]; n++) {
          missingNonces.push(n);
        }
      }
    }
    if (nonces.length > 0 && nonces[0] !== 0) {
      for (let n = 0; n < nonces[0]; n++) missingNonces.push(n);
    }

    if (missingNonces.length === 0) {
      if (dupHere === 0 && reorderedHere === 0) cleanEpochs++;
      continue;
    }

    gapsFound += missingNonces.length;

    const ss = seedMap.get(hash);
    const clientSeed = epochBets[0].seed.clientSeed;

    if (ss) {
      // Server seed revealed and hashes to the commitment (seedMap only holds verified pairs):
      // the initial deal for the missing nonce is derivable. The full round is NOT verified.
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
        s4Failures.push(`Epoch ${hash.slice(0, 8)}: nonce ${missedNonce} missed and the epoch seed is UNREVEALED — unverifiable`);
      }
    }
  }
  if (gapsFound !== EXPECTED_CAPTURE_RETRY_GAPS) {
    s4Failures.push(`${gapsFound} nonce gap(s) != ${EXPECTED_CAPTURE_RETRY_GAPS} capture-retry gaps in the capture plan`);
  }
  if (totalEpochs !== EXPECTED_EPOCHS) {
    s4Failures.push(`${totalEpochs} epochs != ${EXPECTED_EPOCHS} in the capture plan`);
  }

  const s4Data = { epochs: totalEpochs, cleanEpochs, gaps: gapsFound, expectedGaps: EXPECTED_CAPTURE_RETRY_GAPS,
    duplicates, outOfOrder: reordered, initialDealDerivable, unverifiable };
  const s4 = s4Failures.length > 0
    ? step(4, 'Nonce Audit', 'FAIL',
        `${s4Failures.length} nonce violation(s): ${s4Failures.slice(0, 4).join('; ')}`, s4Data)
    : gapsFound === 0
      ? step(4, 'Nonce Audit', 'PASS',
          `${cleanEpochs}/${totalEpochs} epochs have clean sequential nonces, no duplicates, every nonce above the one served before it in capture order`, s4Data)
      : step(4, 'Nonce Audit', 'FLAG',
          `${cleanEpochs}/${totalEpochs} epochs sequential with no duplicates; in all ${totalEpochs} epochs every nonce is above `
          + `the one served before it in capture order (${reordered} out of order); ${gapsFound} nonce gaps, matching the `
          + `${EXPECTED_CAPTURE_RETRY_GAPS} capture-retry gaps in the capture plan. For each, the revealed server seed `
          + `hashes to the epoch's commitment, so the initial deal at the missed nonce is derivable from it — but the round `
          + `itself (hold, final hand, payout) was not captured and is NOT verified. Capture-origin FLAG: disclosed, `
          + `verdict-neutral. ${gapDetails.join('; ')}`,
          s4Data, 'capture');

  return [s1, s2, s3, s4];
}
