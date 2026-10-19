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
import { EXPECTED_BETS, CLIENT_SEED_SAMPLE } from '../../src/loader';
import { loadSiteVerifier, SITE_VERIFIER_PROVENANCE } from '../../src/site-verifier';
import { runOperatorVerifier, checkOperatorCites, OPERATOR_EXPECTED_LOGS } from '../../src/operator-verifier';

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

  // A bet that is skipped is a bet this step did not decide. Passing on "0 mismatches" while
  // skipping freely would let a capture in which nothing was recomputable score a clean pass,
  // so the number actually recomputed is bound to the declared population.
  // ── PLAYER-VERIFIER PARITY (profile VP-24, added 2026-09-26) ──
  // The ProvablyFair.org docs-site verifier (vendored byte-exact under verifier-parity/, pinned in
  // src/site-verifier.ts) is run on EVERY captured bet with its recorded holds. Its initial hand,
  // final hand, hand rank and multiplier must each equal the served values. A pin mismatch, a load
  // failure, a population shortfall or any disagreement FAILs this step.
  const site = loadSiteVerifier();
  let siteRun = 0;
  const siteDiff = { initial: 0, final: 0, combination: 0, multiplier: 0 };
  const siteFirst: string[] = [];
  if (site.derive) {
    for (const b of bets) {
      const ss = seedMap.get(b.seed.serverSeedHashed);
      if (!ss) continue;
      siteRun++;
      const r = site.derive({ clientSeed: b.seed.clientSeed, serverSeed: ss, nonce: b.seed.nonce,
        heldCards: [...b.draw.response.held_cards] });
      const bad: string[] = [];
      if (!arrEq(r.initialHand, b.draw.response.initial_cards!)) { siteDiff.initial++; bad.push('initial'); }
      if (!r.finalHand || !arrEq(r.finalHand, b.draw.response.final_cards!)) { siteDiff.final++; bad.push('final'); }
      if (r.combination !== b.draw.response.combination) { siteDiff.combination++; bad.push('combination'); }
      if (String(r.multiplier) !== b.draw.response.multiplier) { siteDiff.multiplier++; bad.push('multiplier'); }
      if (bad.length && siteFirst.length < 3) siteFirst.push(`hand_id=${b.draw.response.hand_id}: ${bad.join('+')}`);
    }
  }
  const siteDisagree = siteDiff.initial + siteDiff.final + siteDiff.combination + siteDiff.multiplier;

  // ── DUEL'S OWN VERIFY-TAB CODE (profile VP-09, added 2026-09-26) ──
  // evidence/verify-tab/duel-verify-tab-video-poker-2026-04-23.captured.json (pinned, run unedited by
  // verifier-parity/operator/run-operator-verifier.cjs) is executed on every captured hand. Its first
  // ten cards must equal src/rng.ts deck[0..9]; its deal must equal the served initial hand; the served
  // holds applied to its replacement cards must give the served final hand (the operator code has no
  // hold logic — the hold rule is src/rng.ts computeFinalHand). It must print only its own empty-input
  // line, and every OPERATOR_SOURCE_CITES line in src/rng.ts must quote it verbatim.
  const opRounds: Array<{ id: string; serverSeed: string; clientSeed: string; nonce: number }> = [];
  bets.forEach((b, i) => {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (ss) opRounds.push({ id: String(i), serverSeed: ss, clientSeed: b.seed.clientSeed, nonce: b.seed.nonce });
  });
  const op = runOperatorVerifier(opRounds);
  const cites = checkOperatorCites();
  let opRun = 0;
  const opDiff = { adapter: 0, initial: 0, final: 0 };
  const opFirst: string[] = [];
  if (op.results) {
    bets.forEach((b, i) => {
      const cards = op.results!.get(String(i));
      const ss = seedMap.get(b.seed.serverSeedHashed);
      if (!ss) return;
      opRun++;
      const bad: string[] = [];
      const ours = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce).slice(0, 10);
      if (!cards || !arrEq(cards, ours)) { opDiff.adapter++; bad.push('deck[0..9] vs src/rng.ts'); }
      if (!cards || !arrEq(cards.slice(0, 5), b.draw.response.initial_cards!)) { opDiff.initial++; bad.push('initial'); }
      if (!cards || !arrEq(computeFinalHand(cards.slice(0, 5), b.draw.response.held_cards, cards.slice(5, 10)), b.draw.response.final_cards!)) { opDiff.final++; bad.push('final'); }
      if (bad.length && opFirst.length < 3) opFirst.push(`hand_id=${b.draw.response.hand_id}: ${bad.join('+')}`);
    });
  }
  const opDisagree = opDiff.adapter + opDiff.initial + opDiff.final;
  const opIssues: string[] = [];
  if (!op.results) opIssues.push(`operator code not run: ${op.error}`);
  else if (opRun !== EXPECTED_BETS) opIssues.push(`operator code ran on ${opRun} != ${EXPECTED_BETS}`);
  if (op.results && JSON.stringify(op.logs) !== JSON.stringify(OPERATOR_EXPECTED_LOGS)) opIssues.push(`operator code printed ${JSON.stringify(op.logs)}`);
  if (opDisagree > 0) opIssues.push(`OPERATOR CODE DISAGREES on ${opDisagree} field(s) (deck vs src/rng.ts ${opDiff.adapter}, initial ${opDiff.initial}, final ${opDiff.final}; first: ${opFirst.join('; ')})`);
  if (cites.bad.length || cites.checked === 0) opIssues.push(`operator source cites: ${cites.bad.length} of ${cites.checked} do not quote the file (${cites.bad.slice(0, 2).join('; ')})`);

  const siteIssues: string[] = [...opIssues];
  if (!site.derive) siteIssues.push(`site verifier not run: ${site.error}`);
  else if (siteRun !== EXPECTED_BETS) siteIssues.push(`site verifier ran on ${siteRun} != ${EXPECTED_BETS}`);
  if (siteDisagree > 0) siteIssues.push(`SITE VERIFIER DISAGREES with the served hand on ${siteDisagree} field(s) `
    + `(initial ${siteDiff.initial}, final ${siteDiff.final}, combination ${siteDiff.combination}, multiplier ${siteDiff.multiplier}; `
    + `first: ${siteFirst.join('; ')})`);
  const s5Issues: string[] = [];
  if (bets.length !== EXPECTED_BETS) s5Issues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (reconstructedSkipped !== 0) s5Issues.push(`${reconstructedSkipped} bet(s) are gap-fill reconstructions, not captured outcomes`);
  if (skipped - reconstructedSkipped !== 0) s5Issues.push(`${skipped - reconstructedSkipped} bet(s) not recomputable — their epoch seed was never revealed`);
  if (verified !== EXPECTED_BETS) s5Issues.push(`recomputed ${verified} != ${EXPECTED_BETS}`);

  const s5 = step(5, 'Outcome Recomputation',
    mismatches === 0 && s5Issues.length === 0 && siteIssues.length === 0 ? 'PASS' : 'FAIL',
    mismatches > 0
      ? `${mismatches} of ${verified + mismatches} recomputed hands disagree with the captured hand`
        + (mismatchDetails.length > 0 ? ` — ${mismatchDetails.join('; ')}` : '')
      : s5Issues.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s5Issues.join('; ')}`
      : siteIssues.length > 0
        ? `PLAYER VERIFIER: ${siteIssues.join('; ')}`
        : `All ${EXPECTED_BETS} captured bets recomputed with src/rng.ts, whose RNG code is ported from Duel's published `
          + `Verify-tab code (E19): the deck shuffle reproduces `
          + `initial_cards, and the held-card replacement rule applied to deck[5..9] reproduces `
          + `final_cards. 0 skipped, 0 unverifiable, 0 mismatches. The ProvablyFair.org docs-site player `
          + `verifier (derive.js + evaluator.js + paytables.js + lib/hmac-sha256.js, ${SITE_VERIFIER_PROVENANCE.repository} `
          + `${SITE_VERIFIER_PROVENANCE.ref} @ ${SITE_VERIFIER_PROVENANCE.head.slice(0, 7)}, vendored and SHA-256 pinned) run on `
          + `all ${siteRun} bets with their recorded holds: initial hand, final hand, hand rank and multiplier equal the served `
          + `values on every bet (0 differ). Duel's own Verify-tab code (captured 2026-04-23, pinned, run unedited) on all `
          + `${opRun} hands: its deck[0..9] equals src/rng.ts, its deal equals the served initial hand and, with the served holds, `
          + `its replacement cards give the served final hand (0 differ); ${cites.checked}/${cites.checked} operator source lines cited in `
          + `src/rng.ts quote it verbatim.`,
    { bets: bets.length, expectedBets: EXPECTED_BETS, recomputed: verified, skipped,
      reconstructedSkipped, mismatches, siteVerifierRun: siteRun, siteVerifierDisagreements: siteDisagree,
      operatorCodeRun: opRun, operatorCodeDisagreements: opDisagree, operatorCitesChecked: cites.checked },
  );

  // ── Step 6: Client Seed Influence ──────────────────────────────────────────
  // For a sample of bets, recompute with a wrong client seed and verify the deck changes.
  let tested  = 0;
  let changed = 0;

  for (const b of bets) {
    if (tested >= CLIENT_SEED_SAMPLE) break;
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;

    const correctDeck = computeShuffledDeck(ss, b.seed.clientSeed, b.seed.nonce);
    const wrongDeck   = computeShuffledDeck(ss, 'wrong-client-seed-test', b.seed.nonce);
    tested++;
    if (!arrEq(correctDeck, wrongDeck)) changed++;
  }

  // `changeRate >= 0.95` forgave one bet in twenty being INSENSITIVE to the client seed — the
  // exact defect this step exists to detect, waved through by the threshold meant to detect
  // it. Unlike games with few distinct outcomes, a shuffle here is a permutation of 52 cards:
  // two different client seeds landing on the same one is not a case that arises, so there is
  // no combinatorial reason to tolerate any collision. Every sampled bet must change, and the
  // sample size is bound so a shrunken capture cannot pass by testing almost nothing.
  const s6Issues: string[] = [];
  if (tested !== CLIENT_SEED_SAMPLE) {
    s6Issues.push(`bets sampled ${tested} != ${CLIENT_SEED_SAMPLE}`);
  }

  const s6 = step(6, 'Client Seed Influence',
    changed === tested && s6Issues.length === 0 ? 'PASS' : 'FAIL',
    changed !== tested
      ? `${tested - changed} of ${tested} sampled bets produced the SAME deck under a wrong client seed`
      : s6Issues.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s6Issues.join('; ')}`
        : `All ${CLIENT_SEED_SAMPLE} sampled bets produce a different deck under a wrong client seed — `
          + `the client seed is a genuine HMAC input, with no exceptions permitted.`,
    { betsSampled: tested, expectedSample: CLIENT_SEED_SAMPLE, changed, unchanged: tested - changed },
  );

  return [s5, s6];
}

function arrEq(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
