/**
 * Steps 16–18: Anti-Circularity + Simulation Validation
 *
 * Step 16: Anti-circularity — exhaustive C(52,5) enumeration must reproduce the published
 *          combinatorial counts exactly; deal-only RTP derived from the enumerated counts
 * Step 17: Pass 1 — Fisher's combined chi-squared + serial independence + dealt-card uniformity,
 *          all re-derived from the artifact's census rows
 * Step 18: Pass 2 — Cherry-pick detection on captured casino seeds: window 0 (the captured epoch)
 *          ranked among its seed's windows under an exact permutation null (pre-registered rule)
 */

import * as fs   from 'fs';
import * as path from 'path';

import type { StepResult, VerifyContext } from './context';
import { step } from './context';
import type { HandRank } from '../../src/types';
import { HAND_RANKS } from '../../src/types';
import videoPokerConfig from '../../videoPokerConfig.json';
import { evaluateHand } from '../../src/hand-evaluator';
import { ALL_CARDS, computeShuffledDeckFromBuffer } from '../../src/rng';
import {
  EXPECTED_REVEALED_EPOCHS, EPOCH_SIZE_CAP, SIM_PASS1_STREAMS, SIM_PASS1_ROUNDS_PER_STREAM,
  SIM_PASS2_NONCES_PER_SEED, SIM_ALPHA, SIM_PASS2_SEED_FLAG_ALPHA,
  SIM_CARD_CENSUS_POSITIONS, SIM_SERIAL_Z_BOUND, SIM_PASS2_Z_CRIT,
} from '../../src/loader';
import { chiSquaredTest, chiSquaredPValue, binomialUpperTail, runsStatistic, medianFromCounts } from '../../src/stats';
import { numbersAgree } from '../../src/diff';

/** Normal lower-tail Φ(z) = ½·erfc(−z/√2), with erfc taken from the exact regularized incomplete gamma in src/stats.ts. */
function normalLowerTail(z: number): number {
  // P(Z ≤ z) = ½·erfc(−z/√2); erfc via the regularized upper gamma: erfc(x) = Q(½, x²) for x ≥ 0.
  const x = -z / Math.SQRT2;
  const q = chiSquaredPValue(2 * x * x, 1);  // = erfc(|x|)
  return x >= 0 ? 0.5 * q : 1 - 0.5 * q;
}

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
  const { outputsDir, seedMap, seeds, byHash } = ctx;

  // ── Step 16: Anti-Circularity ───────────────────────────────────────────────
  // The old step compared nothing it did not already hold: THEORETICAL_COUNTS is a constant in
  // this file, so "counts sum to C(52,5)" was true by construction, and the only live bound was
  // a 30–40% band on the resulting deal-only RTP — a ten-point window that any plausible pay
  // table falls inside. Its FAIL branch was unreachable on any input the step could see.
  //
  // Now the step ENUMERATES all C(52,5) = 2,598,960 five-card hands, classifies each with the
  // independent evaluator in src/hand-evaluator.ts (the same one step 19 scores the server's
  // `combination` against), and requires the resulting count for every one of the 10 ranks to
  // equal the published combinatorial count EXACTLY. A disagreement in either direction — a
  // wrong textbook constant, or an evaluator that misclassifies a hand — FAILs. The deal-only
  // RTP is then computed from the ENUMERATED counts; it is a derived figure, not a bound.
  const enumerated: Record<string, number> = {};
  let enumeratedTotal = 0;
  {
    const hand = ['', '', '', '', ''];
    const N = ALL_CARDS.length;
    for (let a = 0; a < N - 4; a++) for (let b = a + 1; b < N - 3; b++)
    for (let c = b + 1; c < N - 2; c++) for (let d = c + 1; d < N - 1; d++)
    for (let e = d + 1; e < N; e++) {
      hand[0] = ALL_CARDS[a]; hand[1] = ALL_CARDS[b]; hand[2] = ALL_CARDS[c];
      hand[3] = ALL_CARDS[d]; hand[4] = ALL_CARDS[e];
      const r = evaluateHand(hand);
      enumerated[r] = (enumerated[r] ?? 0) + 1;
      enumeratedTotal++;
    }
  }

  let theoreticalRTP = 0;
  const countMismatches: string[] = [];
  for (const rank of HAND_RANKS) {
    const got = enumerated[rank] ?? 0;
    if (got !== THEORETICAL_COUNTS[rank]) {
      countMismatches.push(`${rank}: enumerated ${got} != published ${THEORETICAL_COUNTS[rank]}`);
    }
    theoreticalRTP += (got / TOTAL_HANDS) * MULTIPLIERS[rank];
  }
  for (const r of Object.keys(enumerated)) {
    if (!(HAND_RANKS as readonly string[]).includes(r)) countMismatches.push(`evaluator returned unknown rank "${r}" x${enumerated[r]}`);
  }
  if (enumeratedTotal !== TOTAL_HANDS) countMismatches.push(`enumerated ${enumeratedTotal} hands != C(52,5) = ${TOTAL_HANDS}`);

  // NEGATIVE CONTROL (profile VP-18, added 2026-09-26). The comparison above must be able to reject:
  // for each hand rank in turn, one hand is moved from that rank to the next rank down in a COPY of
  // the enumerated counts (total unchanged), and the same count comparison must flag it. A comparison
  // that accepts any of these ten corruptions is not reading the enumeration.
  const countDiffs = (counts: Record<string, number>): number =>
    HAND_RANKS.filter(r => (counts[r] ?? 0) !== THEORETICAL_COUNTS[r]).length;
  let controlsRejected = 0;
  for (let i = 0; i < HAND_RANKS.length; i++) {
    const copy: Record<string, number> = { ...enumerated };
    const from = HAND_RANKS[i], to = HAND_RANKS[(i + 1) % HAND_RANKS.length];
    copy[from] = (copy[from] ?? 0) - 1;
    copy[to] = (copy[to] ?? 0) + 1;
    if (countDiffs(copy) > 0) controlsRejected++;
  }
  if (controlsRejected !== HAND_RANKS.length) {
    countMismatches.push(`negative control: ${controlsRejected} of ${HAND_RANKS.length} corrupted rank tallies rejected`);
  }

  // The sentence carries the claim; the measured RTP goes in `data`, where the reproduction
  // gate compares it under tolerance.
  const s16 = step(16, 'Anti-Circularity (Theoretical Deal-Only RTP)',
    countMismatches.length === 0 ? 'PASS' : 'FAIL',
    countMismatches.length > 0
      ? `Exhaustive enumeration disagrees with the published combinatorial counts: ${countMismatches.slice(0, 4).join('; ')}`
      : `All C(52,5) = ${TOTAL_HANDS} five-card hands enumerated and classified by the independent evaluator; `
        + `the count for each of the ${HAND_RANKS.length} hand ranks equals the published combinatorial count exactly. `
        + `The deal-only RTP is computed from those enumerated counts and the committed pay table, from no casino data. `
        + `Negative control: ${controlsRejected} of ${HAND_RANKS.length} corrupted rank tallies (one hand moved between adjacent ranks) are rejected.`,
    { totalHands: TOTAL_HANDS, enumeratedHands: enumeratedTotal, enumeratedCounts: enumerated,
      countMismatches: countMismatches.length, theoreticalDealOnlyRTP: theoreticalRTP, handRanks: HAND_RANKS.length },
  );

  // ── Steps 17–18: Simulation results ──────────────────────────────────────────
  const simPath = path.join(outputsDir, 'simulation-results.json');

  // A missing simulation artifact used to be a FLAG on both steps. The artifact is pinned
  // (src/artifact-pins.ts) and both steps are scored against it, so its absence means neither
  // step decided anything: FAIL, not a flag.
  if (!fs.existsSync(simPath)) {
    const s17 = step(17, 'Simulation Validation — Pass 1', 'FAIL',
      'outputs/simulation-results.json ABSENT — the pinned simulation artifact this step is scored against is missing',
    );
    const s18 = step(18, 'Pass 2 Cherry-Pick Detection', 'FAIL',
      'outputs/simulation-results.json ABSENT — the pinned simulation artifact this step is scored against is missing',
    );
    return [s16, s17, s18];
  }

  const sim = JSON.parse(fs.readFileSync(simPath, 'utf-8'));

  // ── RE-DERIVATION FROM THE SHIPPED ROWS (profile VP-20 / VP-21, added 2026-09-26) ──────────────
  // The artifact ships its raw rows: per-stream hand-rank counts (Pass 1) and per-seed early / extended
  // window counts (Pass 2). Every statistic the two steps score is recomputed here from those rows and
  // the exact C(52,5) law, and the artifact's own scalar must AGREE with the recomputation at the
  // reproduction tolerance (1e-14 abs + 1e-12 rel); the verdict is taken from the RECOMPUTED value.
  // Since the second 2026-09-26 regeneration the serial statistics, dealt-card uniformity and every Pass 2
  // window are re-derived as well, from the census blocks the artifact ships (below).
  const expPerRound = HAND_RANKS.map(r => THEORETICAL_COUNTS[r] / TOTAL_HANDS);
  const rederiveIssues: string[] = [];
  const agree = (what: string, artifactValue: unknown, recomputed: number) => {
    if (typeof artifactValue !== 'number' || !numbersAgree(artifactValue, recomputed)) {
      rederiveIssues.push(`${what}: artifact ${String(artifactValue)} != recomputed ${recomputed}`);
    }
  };

  // ── Step 17: Pass 1 — Fisher's combined chi-squared + serial census + dealt-card census ──────────
  const pass1 = sim.pass1;

  const streamRows: any[] = Array.isArray(pass1.streamResults) ? pass1.streamResults : [];
  if (streamRows.length !== SIM_PASS1_STREAMS) rederiveIssues.push(`Pass 1 stream rows ${streamRows.length} != ${SIM_PASS1_STREAMS}`);
  const p1Totals: Record<string, number> = {};
  for (const r of HAND_RANKS) p1Totals[r] = 0;
  const recomputedStreamP: number[] = [];
  let p1Payout = 0;
  for (const row of streamRows) {
    const obs = HAND_RANKS.map(r => Number(row.observed?.[r]));
    const n = obs.reduce((a, b) => a + b, 0);
    if (obs.some(v => !Number.isInteger(v) || v < 0) || n !== SIM_PASS1_ROUNDS_PER_STREAM) {
      rederiveIssues.push(`Pass 1 stream ${row.stream}: counts sum to ${n}, expected ${SIM_PASS1_ROUNDS_PER_STREAM}`);
      continue;
    }
    const chi = chiSquaredTest(obs, expPerRound.map(p => p * n));
    agree(`Pass 1 stream ${row.stream} chi2`, row.chi2, chi.chi2);
    agree(`Pass 1 stream ${row.stream} p`, row.pValue, chi.pValue);
    recomputedStreamP.push(chi.pValue);
    HAND_RANKS.forEach((r, i) => { p1Totals[r] += obs[i]; p1Payout += obs[i] * MULTIPLIERS[r]; });
  }
  for (const r of HAND_RANKS) if (pass1.observedCounts?.[r] !== p1Totals[r]) rederiveIssues.push(`Pass 1 observedCounts.${r} ${pass1.observedCounts?.[r]} != Σ streams ${p1Totals[r]}`);
  const fisherStatR = -2 * recomputedStreamP.reduce((s, p) => s + Math.log(p), 0);
  const fisherPR    = chiSquaredPValue(fisherStatR, 2 * recomputedStreamP.length);
  const p1Rounds    = SIM_PASS1_STREAMS * SIM_PASS1_ROUNDS_PER_STREAM;
  agree('Pass 1 Fisher statistic', pass1.fisherCombined?.statistic, fisherStatR);
  agree('Pass 1 Fisher p', pass1.fisherCombined?.pValue, fisherPR);
  agree('Pass 1 empirical RTP', pass1.empiricalRTP, p1Payout / p1Rounds);
  if (pass1.totalRounds !== p1Rounds) rederiveIssues.push(`Pass 1 totalRounds ${pass1.totalRounds} != ${p1Rounds}`);

  // SERIAL INDEPENDENCE, RE-DERIVED (profile VP-20, 2026-09-26). The artifact ships the 10 × 10
  // transition counts of the concatenated rank-index sequence (pass1.serialCensus). Its marginals must
  // reconcile EXACTLY with the per-stream histograms (row sums + last = column sums + first = the
  // pooled counts), and both serial statistics are functions of it alone: lag-1 r = Σ T_ab(a−m)(b−m) /
  // Σ c_v(v−m)², and the runs test's run count = 1 + the transitions that cross the median. The verdict
  // uses these recomputed values; the artifact's own lag1Autocorrelation / runsTest (computed by the
  // simulator on the sequence itself) must agree — runs exactly, z and p at the reproduction tolerance,
  // lag-1 r within the first-order floating-point bound of the simulator's 10^7-term sequential sums.
  const K = HAND_RANKS.length;
  const sc = pass1.serialCensus;
  const T: number[][] | null = Array.isArray(sc?.transitions) && sc.transitions.length === K
    && sc.transitions.every((row: unknown) => Array.isArray(row) && row.length === K && row.every(v => Number.isInteger(v) && (v as number) >= 0))
    ? sc.transitions : null;
  let lag1R = NaN, lag1Z = NaN, runsR: { runs: number; z: number; pValue: number } = { runs: NaN, z: NaN, pValue: NaN };
  let lag1Tol = NaN;
  if (!T || sc.n !== p1Rounds || !Number.isInteger(sc.first) || !Number.isInteger(sc.last) || sc.first < 0 || sc.first >= K || sc.last < 0 || sc.last >= K) {
    rederiveIssues.push(`Pass 1 serial census missing or malformed (need n = ${p1Rounds}, first/last in 0..${K - 1}, a ${K}×${K} matrix of non-negative integers)`);
  } else {
    const pairs = T.reduce((a, row) => a + row.reduce((b, v) => b + v, 0), 0);
    if (pairs !== p1Rounds - 1) rederiveIssues.push(`Pass 1 serial census holds ${pairs} transitions, expected ${p1Rounds - 1}`);
    const c = HAND_RANKS.map(r => p1Totals[r]);
    for (let v = 0; v < K; v++) {
      const rowSum = T[v].reduce((a, b) => a + b, 0) + (sc.last === v ? 1 : 0);
      const colSum = T.reduce((a, row) => a + row[v], 0) + (sc.first === v ? 1 : 0);
      if (rowSum !== c[v] || colSum !== c[v]) rederiveIssues.push(`Pass 1 serial census marginal for ${HAND_RANKS[v]} (${rowSum}/${colSum}) != pooled count ${c[v]}`);
    }
    const n = p1Rounds;
    const m = c.reduce((a, cv, v) => a + cv * v, 0) / n;
    let num = 0, absNum = 0, den = 0;
    for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) { num += T[a][b] * (a - m) * (b - m); absNum += T[a][b] * Math.abs((a - m) * (b - m)); }
    for (let v = 0; v < K; v++) den += c[v] * (v - m) ** 2;
    lag1R = den === 0 ? 0 : num / den;
    lag1Z = lag1R * Math.sqrt(n);
    // |Δr| ≤ 4·n·u·(Σ|terms| + |r|·den)/den — the γ_n bound for two sequential n-term sums (u = 2^-53),
    // doubled for the mean the simulator subtracted. At n = 10^7 this is ~1e-9, far below the 3/√n ≈ 9.5e-4
    // the serial rule tests against.
    lag1Tol = 4 * n * 2 ** -53 * (absNum + Math.abs(lag1R) * den) / den;
    if (typeof pass1.lag1Autocorrelation !== 'number' || !(Math.abs(pass1.lag1Autocorrelation - lag1R) <= lag1Tol)) {
      rederiveIssues.push(`Pass 1 lag1Autocorrelation: artifact ${pass1.lag1Autocorrelation} vs census ${lag1R} (bound ${lag1Tol.toExponential(2)})`);
    }
    const med = medianFromCounts(c);
    const above = (v: number) => v >= med;
    let n1 = 0; for (let v = 0; v < K; v++) if (above(v)) n1 += c[v];
    let runs = 1; for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) if (above(a) !== above(b)) runs += T[a][b];
    runsR = runsStatistic(runs, n1, n);
    if (pass1.runsTest?.runs !== runsR.runs) rederiveIssues.push(`Pass 1 runs: artifact ${pass1.runsTest?.runs} != census ${runsR.runs}`);
    agree('Pass 1 runs z', pass1.runsTest?.z, runsR.z);
    agree('Pass 1 runs p', pass1.runsTest?.pValue, runsR.pValue);
  }
  const serialOk = Math.abs(lag1Z) < SIM_SERIAL_Z_BOUND && runsR.pValue >= SIM_ALPHA;
  const serialFails = serialOk ? 0 : 1;
  if (pass1.serialIndependenceFails !== serialFails) rederiveIssues.push(`Pass 1 serialIndependenceFails ${pass1.serialIndependenceFails} != recomputed ${serialFails}`);

  // DEALT-CARD UNIFORMITY (profile VP-20, 2026-09-26). pass1.cardCensus counts every card at deck
  // positions 0..9 (5 dealt + 5 replacement) over the 10^7 deals; each position is tested against the
  // uniform 1/52 by chi-squared (df 51) at family level SIM_ALPHA over the positions (Bonferroni).
  const cc = pass1.cardCensus;
  const cardAlphaEach = SIM_ALPHA / SIM_CARD_CENSUS_POSITIONS;
  const cardP: number[] = [];
  const cardChi: number[] = [];
  if (!cc || cc.positions !== SIM_CARD_CENSUS_POSITIONS || !Array.isArray(cc.counts) || cc.counts.length !== SIM_CARD_CENSUS_POSITIONS) {
    rederiveIssues.push(`Pass 1 card census missing or malformed (need ${SIM_CARD_CENSUS_POSITIONS} positions × ${ALL_CARDS.length} cards)`);
  } else {
    cc.counts.forEach((row: unknown, pos: number) => {
      const ok = Array.isArray(row) && row.length === ALL_CARDS.length && row.every(v => Number.isInteger(v) && (v as number) >= 0);
      const sum = ok ? (row as number[]).reduce((a, b) => a + b, 0) : NaN;
      if (!ok || sum !== p1Rounds) { rederiveIssues.push(`Pass 1 card census position ${pos}: ${ok ? `sums to ${sum}` : 'malformed'}, expected ${p1Rounds}`); return; }
      const chi = chiSquaredTest(row as number[], (row as number[]).map(() => p1Rounds / ALL_CARDS.length));
      cardChi.push(chi.chi2); cardP.push(chi.pValue);
    });
  }
  const cardMinP = cardP.length ? Math.min(...cardP) : NaN;
  const cardOk = cardP.length === SIM_CARD_CENSUS_POSITIONS && cardMinP >= cardAlphaEach;

  const fisherP    = fisherPR;                        // the verdict uses the recomputed value
  const streams    = recomputedStreamP.length;
  const totalRounds = p1Rounds;
  const empRTP     = p1Payout / p1Rounds;

  // Per-stream check: any below alpha?
  const streamsBelow = recomputedStreamP.filter(p => p < SIM_ALPHA).length;

  // FWER explainer
  console.log(`\n         Video Poker is single-config — using Fisher's method (${streams} streams).`);
  console.log(`         Fisher's combined p-value: ${fisherP.toFixed(6)} (PASS threshold: ≥0.01)`);
  console.log(`         Streams below α=0.01: ${streamsBelow}/${streams}`);
  console.log(`         Serial (from the census): lag-1 z ${lag1Z.toFixed(3)}, runs p ${runsR.pValue.toFixed(4)}`);
  console.log(`         Dealt-card census: smallest per-position p ${cardMinP.toFixed(4)} (threshold ${cardAlphaEach})`);
  console.log(`         Empirical deal-only RTP: ${(empRTP * 100).toFixed(4)}%`);
  console.log(`         Theoretical deal-only RTP: ${(theoreticalRTP * 100).toFixed(4)}%\n`);

  const p1Issues = rederiveIssues.filter(i => i.startsWith('Pass 1'));
  const pass1Ok = fisherP >= SIM_ALPHA && serialOk && cardOk && p1Issues.length === 0;
  const s17 = step(17, 'Simulation Validation — Pass 1',
    pass1Ok ? 'PASS' : 'FAIL',
    `${totalRounds.toLocaleString()} rounds (${streams} streams × ${pass1.roundsPerStream.toLocaleString()}); ` +
    (p1Issues.length > 0
      ? `RE-DERIVATION DISAGREES WITH THE ARTIFACT: ${p1Issues.slice(0, 3).join('; ')}; `
      : '') +
    (pass1Ok
      ? `Fisher's combined p clears the α=${SIM_ALPHA} threshold (streams below α: ${streamsBelow}/${streams}); serial independence `
        + `holds (|lag-1 z| < ${SIM_SERIAL_Z_BOUND}, runs p ≥ ${SIM_ALPHA}); dealt-card uniformity holds at all ${SIM_CARD_CENSUS_POSITIONS} deck `
        + `positions (5 dealt + 5 replacement, chi-squared df ${ALL_CARDS.length - 1} each, family α ${SIM_ALPHA}, Bonferroni ${cardAlphaEach}); `
        + `empirical RTP tracks the theoretical deal-only RTP. Every statistic re-derived in verify from the artifact's rows: the `
        + `${streams} per-stream hand-rank counts (chi-squared, Fisher, pooled counts, RTP), the 10 × 10 rank-transition census `
        + `(lag-1 and runs, marginals reconciled exactly with the histograms) and the ${SIM_CARD_CENSUS_POSITIONS} × ${ALL_CARDS.length} `
        + `dealt-card census; the artifact's own scalars must agree with the recomputation. Measured values in this step's data block`
      : `FAILED: Fisher's combined p ${fisherP >= SIM_ALPHA ? 'clears' : 'is below'} ${SIM_ALPHA}; serial ${serialOk ? 'holds' : 'FAILS'} `
        + `(|lag-1 z| < ${SIM_SERIAL_Z_BOUND}, runs p ≥ ${SIM_ALPHA} required); dealt-card uniformity ${cardOk ? 'holds' : 'FAILS'} `
        + `(every position p ≥ ${cardAlphaEach} required)`),
    { totalRounds, streams, roundsPerStream: pass1.roundsPerStream, fisherCombinedP: fisherP,
      alpha: SIM_ALPHA, streamsBelowAlpha: streamsBelow, serialIndependenceFails: serialFails,
      lag1R, lag1Z, lag1Tolerance: lag1Tol, runsZ: runsR.z, runsP: runsR.pValue,
      cardPositions: cardP.length, cardAlphaEach, cardMinP, cardChi2: cardChi,
      empiricalRTP: empRTP, theoreticalDealOnlyRTP: theoreticalRTP },
  );

  // ── Step 18: Pass 2 — Cherry-Pick Detection ──────────────────────────────
  const pass2 = sim.pass2;

  // No Pass 2, or a Pass 2 over fewer seeds than the capture revealed, is a step that did not
  // examine the population it claims to: FAIL. The seed count is bound to the capture plan.
  const perSeedLen = Array.isArray(pass2?.perSeed) ? pass2.perSeed.length : 0;
  if (!pass2 || pass2.totalSeeds !== EXPECTED_REVEALED_EPOCHS || perSeedLen !== EXPECTED_REVEALED_EPOCHS) {
    const s18 = step(18, 'Pass 2 Cherry-Pick Detection', 'FAIL',
      `Pass 2 does not cover the captured seeds: totalSeeds=${pass2?.totalSeeds}, perSeed rows=${perSeedLen}, `
      + `expected ${EXPECTED_REVEALED_EPOCHS} (every revealed epoch in the capture plan)`,
      { totalSeeds: pass2?.totalSeeds ?? null, perSeedRows: perSeedLen, expectedSeeds: EXPECTED_REVEALED_EPOCHS },
    );
    return [s16, s17, s18];
  }

  // Re-derived from the 110 shipped per-seed rows: window counts reconcile, each seed's early-window
  // chi-squared and flag, the flag count, the binomial p and the pooled chi-squared are recomputed and
  // must agree with the artifact (reconciliation; since 2026-09-26 not the decision rule).
  const early = EPOCH_SIZE_CAP;                       // captured nonce range 0..49 = one epoch
  const WINDOWS = SIM_PASS2_NONCES_PER_SEED / early;
  const royalMult = MULTIPLIERS.royal_flush;
  const intMult = (r: HandRank) => (r === 'royal_flush' ? 0 : MULTIPLIERS[r]);
  const nonIntegerMults = HAND_RANKS.filter(r => r !== 'royal_flush' && !Number.isInteger(MULTIPLIERS[r]));
  if (nonIntegerMults.length) rederiveIssues.push(`Pass 2 window census assumes integer multipliers except royal flush; not integer: ${nonIntegerMults.join(', ')}`);
  const maxWindowInt = early * Math.max(...HAND_RANKS.map(intMult));
  const agg: number[] = HAND_RANKS.map(() => 0);
  let flaggedR = 0, earlyPayoutSum = 0, earlyHands = 0, aggPayout = 0;
  // Window-rank statistic (the decision rule since 2026-09-26)
  let rankSum = 0, rankVar = 0, below = 0, above = 0, seedsRanked = 0;
  let replayedWindows = 0, windowReplayMismatches = 0, capturedBetsBound = 0, capturedDealMismatches = 0;
  const rowHashes = new Set<string>();
  for (const row of pass2.perSeed as any[]) {
    const e = HAND_RANKS.map(r => Number(row.earlyWindowCounts?.[r]));
    const x = HAND_RANKS.map(r => Number(row.extendedWindowCounts?.[r]));
    const o = HAND_RANKS.map(r => Number(row.observedCounts?.[r]));
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    const hash = String(row.serverSeedHashed);
    const tag = `Pass 2 seed ${hash.slice(0, 8)}`;
    rowHashes.add(hash);
    if (row.nonces !== SIM_PASS2_NONCES_PER_SEED || sum(e) !== early || sum(x) !== SIM_PASS2_NONCES_PER_SEED - early
        || o.some((v, i) => v !== e[i] + x[i])) {
      rederiveIssues.push(`${tag}: window counts do not reconcile (early ${sum(e)}, extended ${sum(x)}, nonces ${row.nonces})`);
      continue;
    }
    const chi = chiSquaredTest(e, expPerRound.map(p => p * early));
    agree(`${tag} early chi2`, row.earlyChiSquared?.chi2, chi.chi2);
    agree(`${tag} early p`, row.earlyChiSquared?.pValue, chi.pValue);
    const flag = chi.pValue < SIM_PASS2_SEED_FLAG_ALPHA;
    if (flag !== row.flaggedCherryPick) rederiveIssues.push(`${tag}: flag ${row.flaggedCherryPick} != recomputed ${flag}`);
    if (flag) flaggedR++;
    HAND_RANKS.forEach((r, i) => { agg[i] += o[i]; aggPayout += o[i] * MULTIPLIERS[r]; earlyPayoutSum += e[i] * MULTIPLIERS[r]; });
    earlyHands += early;

    // ── the window census: every window's deal-only return, re-derived and reconciled ──
    const wInt: number[] = typeof row.windowPayoutsInt === 'string' ? row.windowPayoutsInt.split(',').map(Number) : [];
    const wRoy: unknown[] = Array.isArray(row.windowRoyals) ? row.windowRoyals : [];
    if (wInt.length !== WINDOWS || wInt.some(v => !Number.isInteger(v) || v < 0 || v > maxWindowInt)
        || wRoy.some(w => !Number.isInteger(w) || (w as number) < 0 || (w as number) >= WINDOWS)) {
      rederiveIssues.push(`${tag}: window census malformed (${wInt.length} windows, need ${WINDOWS} integers in [0, ${maxWindowInt}] and royal indices in [0, ${WINDOWS - 1}])`);
      continue;
    }
    const royalsIn = new Array<number>(WINDOWS).fill(0);
    for (const w of wRoy as number[]) royalsIn[w]++;
    const intTotal = HAND_RANKS.reduce((s, r, i) => s + o[i] * intMult(r), 0);
    const intEarly = HAND_RANKS.reduce((s, r, i) => s + e[i] * intMult(r), 0);
    if (sum(wInt) !== intTotal) rederiveIssues.push(`${tag}: windows sum to ${sum(wInt)} (integer part), the per-seed counts give ${intTotal}`);
    if (wRoy.length !== o[0]) rederiveIssues.push(`${tag}: ${wRoy.length} royal window entries, the per-seed counts give ${o[0]}`);
    if (wInt[0] !== intEarly || royalsIn[0] !== e[0]) rederiveIssues.push(`${tag}: window 0 (${wInt[0]} + ${royalsIn[0]} royal) != the early-window counts (${intEarly} + ${e[0]} royal)`);

    // REPLAY IN VERIFY: window 0 (the captured epoch) and the last window are dealt again from the
    // revealed seed; both must equal the census, and every captured bet of the epoch must be dealt
    // exactly the cards it was served. This binds the census to the seeds at both ends and binds
    // window 0 to the capture.
    const plain = seedMap.get(hash);
    const entry = seeds.find(se => se.seed.serverSeedHashed === hash);
    if (!plain || !entry) { rederiveIssues.push(`${tag}: not a revealed seed of the capture`); continue; }
    const key = Buffer.from(plain, 'hex');
    const captured = new Map<number, string[]>();
    for (const b of byHash.get(hash) ?? []) if (b.deal?.response?.initial_cards) captured.set(b.seed.nonce, b.deal.response.initial_cards);
    for (const w of [0, WINDOWS - 1]) {
      let wi = 0, wr = 0;
      for (let j = 0; j < early; j++) {
        const nonce = w * early + j;
        const deck = computeShuffledDeckFromBuffer(key, entry.seed.clientSeed, nonce);
        const rank = evaluateHand(deck.slice(0, 5));
        if (rank === 'royal_flush') wr++; else wi += MULTIPLIERS[rank];
        const served = w === 0 ? captured.get(nonce) : undefined;
        if (served) { capturedBetsBound++; if (served.join(',') !== deck.slice(0, 5).join(',')) capturedDealMismatches++; }
      }
      replayedWindows++;
      if (wi !== wInt[w] || wr !== royalsIn[w]) windowReplayMismatches++;
    }

    // Exact permutation null: under no cherry-pick window 0 is exchangeable with the other windows,
    // so its mid-rank among all WINDOWS is uniform. Mid-ranks by sort; variance is the exact
    // permutation variance of the observed ranks.
    const vals = wInt.map((v, w) => v + royalsIn[w] * royalMult);
    const order = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array<number>(WINDOWS);
    for (let i = 0; i < WINDOWS;) {
      let j = i; while (j + 1 < WINDOWS && order[j + 1][0] === order[i][0]) j++;
      const mid = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[order[k][1]] = mid;
      i = j + 1;
    }
    const meanR = (WINDOWS + 1) / 2;
    rankSum += ranks[0] - meanR;
    rankVar += ranks.reduce((a, r) => a + (r - meanR) ** 2, 0) / WINDOWS;
    if (ranks[0] < meanR) below++; else if (ranks[0] > meanR) above++;
    seedsRanked++;
  }
  const missingRows = [...seedMap.keys()].filter(h => !rowHashes.has(h)).length;
  if (missingRows) rederiveIssues.push(`Pass 2: ${missingRows} revealed seed(s) have no per-seed row`);
  if (rowHashes.size !== pass2.perSeed.length) rederiveIssues.push(`Pass 2: duplicate per-seed rows (${pass2.perSeed.length} rows, ${rowHashes.size} distinct seeds)`);
  if (seedsRanked !== EXPECTED_REVEALED_EPOCHS) rederiveIssues.push(`Pass 2: ${seedsRanked} seeds ranked, expected ${EXPECTED_REVEALED_EPOCHS}`);
  if (windowReplayMismatches) rederiveIssues.push(`Pass 2: ${windowReplayMismatches} of ${replayedWindows} replayed windows differ from the census`);
  if (capturedDealMismatches) rederiveIssues.push(`Pass 2: ${capturedDealMismatches} of ${capturedBetsBound} captured deals differ from the replayed window 0`);
  const rankZ = rankSum / Math.sqrt(rankVar);
  const rankP = normalLowerTail(rankZ);
  // Detection power: the fraction f of seeds whose captured window sits in its worst decile (mean
  // rank shift ≈ −0.45·WINDOWS) that the rule detects with ≥ 50 % probability.
  const fDetect = (-SIM_PASS2_Z_CRIT) * Math.sqrt(rankVar) / (0.45 * WINDOWS * seedsRanked);

  const aggRounds = agg.reduce((a, b) => a + b, 0);
  const aggChiR = chiSquaredTest(agg, expPerRound.map(p => p * aggRounds));
  const binomialPR = binomialUpperTail(pass2.perSeed.length, SIM_PASS2_SEED_FLAG_ALPHA, flaggedR);
  if (pass2.flaggedSeeds !== flaggedR) rederiveIssues.push(`Pass 2 flaggedSeeds ${pass2.flaggedSeeds} != recomputed ${flaggedR}`);
  agree('Pass 2 binomial p', pass2.cherryPickBinomial, binomialPR);
  agree('Pass 2 aggregate chi2', pass2.aggregatedChiSquared?.chi2, aggChiR.chi2);
  agree('Pass 2 aggregate RTP', pass2.aggregatedRTP, aggPayout / aggRounds);
  if (pass2.totalRounds !== aggRounds) rederiveIssues.push(`Pass 2 totalRounds ${pass2.totalRounds} != Σ rows ${aggRounds}`);
  // The same captured-window return, pooled over every seed and standardised by the EXACT per-hand mean
  // and variance of the C(52,5) law (normal / CLT view) — reported beside the rank statistic.
  const mu = HAND_RANKS.reduce((s, r, i) => s + expPerRound[i] * MULTIPLIERS[r], 0);
  const v2 = HAND_RANKS.reduce((s, r, i) => s + expPerRound[i] * MULTIPLIERS[r] ** 2, 0) - mu * mu;
  const earlyZ = (earlyPayoutSum - earlyHands * mu) / Math.sqrt(earlyHands * v2);
  const earlyLowerP = normalLowerTail(earlyZ);
  const p2Issues = rederiveIssues.filter(i => i.startsWith('Pass 2'));

  const totalSeeds   = pass2.totalSeeds;
  const flaggedSeeds = flaggedR;
  const binomialP    = binomialPR;
  const aggChi       = aggChiR;
  const aggRTP       = aggPayout / aggRounds;

  // PRE-REGISTERED DECISION RULE (profile VP-21, since 2026-09-26): cherry-picking is indicated when the
  // rank-sum Z of the captured windows is below SIM_PASS2_Z_CRIT (one-sided α 0.001) — the return of
  // the hands the casino actually dealt, under an exact permutation null. It replaced the chi-squared
  // flag count, which is still recomputed and reconciled above but no longer decides the step.
  const cherryPickPass = rankZ >= SIM_PASS2_Z_CRIT && p2Issues.length === 0;

  const s18 = step(18, 'Pass 2 Cherry-Pick Detection',
    cherryPickPass ? 'PASS' : 'FAIL',
    p2Issues.length > 0
      ? `RE-DERIVATION DISAGREES WITH THE ARTIFACT: ${p2Issues.slice(0, 3).join('; ')}`
    : cherryPickPass
      ? `${totalSeeds} revealed seeds × ${SIM_PASS2_NONCES_PER_SEED.toLocaleString('en-US')} nonces = ${WINDOWS.toLocaleString('en-US')} disjoint windows `
        + `of ${early} per seed; window 0 is the captured epoch (nonces 0–${early - 1}). Pre-registered rule: the deal-only return `
        + `of the hands dealt in window 0 is ranked among its seed's ${WINDOWS.toLocaleString('en-US')} windows (exact permutation null — `
        + `window 0 is exchangeable with the others under no cherry-pick); rank sums over seeds give Z; cherry-pick indicated at `
        + `Z < ${SIM_PASS2_Z_CRIT.toFixed(3)} (one-sided α 0.001). Not indicated. Every window re-derived in verify from the shipped `
        + `window census (reconciled exactly with each seed's rank counts), windows 0 and ${WINDOWS - 1} of every seed dealt again `
        + `from the revealed seed and equal to the census, and all ${capturedBetsBound} captured deals reproduced by the window-0 replay. `
        + `The per-seed early-window chi-squared flags (${flaggedSeeds}), their binomial p and the pooled chi-squared are recomputed and `
        + `reconciled but no longer decide the step. Z, the direction split, detection power and the CLT view of the same return `
        + `are in this step's data block`
      : `${totalSeeds} revealed seeds: rank-sum Z of the captured windows is below ${SIM_PASS2_Z_CRIT.toFixed(3)} — the captured `
        + `epochs are dealt systematically worse than their seeds' other windows (cherry-pick signal)`,
    { totalSeeds, windowsPerSeed: WINDOWS, windowSize: early, zCritical: SIM_PASS2_Z_CRIT,
      rankSumZ: rankZ, rankSumLowerP: rankP, capturedBelowMedian: below, capturedAboveMedian: above,
      powerWorstDecileFraction: fDetect, replayedWindows, windowReplayMismatches, capturedBetsBound, capturedDealMismatches,
      flaggedSeeds, cherryPickBinomialP: binomialP, alpha: 0.01,
      aggregateChiSquared: aggChi.chi2, aggregateChiSquaredDf: aggChi.df,
      aggregateChiSquaredP: aggChi.pValue, aggregateRTP: aggRTP, earlyWindowReturnZ: earlyZ,
      earlyWindowReturnLowerP: earlyLowerP, rederivationIssues: rederiveIssues.length },
  );

  return [s16, s17, s18];
}
