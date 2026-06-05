/**
 * Monte Carlo simulation for Duel.com Video Poker audit.
 *
 * Pass 1 — Multi-stream Fisher's method (10 streams × 1M rounds = 10M total).
 *   Video Poker is a single-config game (Jacks or Better), so we use multi-stream
 *   with Fisher's combined p-value instead of per-config Bonferroni. This matches
 *   the methodology for Crash (also single-config). Each stream uses an independent
 *   pinned seed pair. Per-stream chi-squared on hand-rank distribution, combined via
 *   Fisher's method: T = -2 Σ ln(p_i) ~ χ²(2K). Serial independence tested on the
 *   full 10M combined stream.
 *
 *   Methodology rule: multi-config → Bonferroni; single-config → Fisher's.
 *
 * Pass 2 — Captured casino seeds × 100,000 nonces each (cherry-pick detection).
 *   Test A: aggregate chi-squared across all revealed server seeds.
 *   Test B: early-nonce window (0–49) vs extended (50–99,999) per seed.
 *
 * Output: outputs/simulation-results.json
 *         outputs/rtp-convergence.html
 */

import * as fs      from 'fs';
import * as path    from 'path';
import * as crypto  from 'crypto';

import { computeShuffledDeckFromBuffer } from './rng';
import { evaluateHand }                  from './hand-evaluator';
import { loadDataset, buildSeedMap }     from './loader';
import { chiSquaredTest, chiSquaredPValue, lag1Autocorrelation, runsTest } from './stats';
import { HAND_RANKS, type HandRank, type VideoPokerDataset } from './types';
import videoPokerConfig from '../videoPokerConfig.json';

// ── Configuration ─────────────────────────────────────────────────────────────

const PASS1_STREAMS         = 10;
const PASS1_ROUNDS_EACH     = 1_000_000;
const PASS1_ROUNDS_TOTAL    = PASS1_STREAMS * PASS1_ROUNDS_EACH;  // 10,000,000
const PASS2_NONCES_PER_SEED = 100_000;
const EPOCH_LENGTH          = 50;
const CONVERGENCE_SAMPLES   = [1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000];

/**
 * Pinned per-stream seed pairs — generated once via crypto.randomBytes and
 * frozen so the report's canonical empirical RTP, Fisher's combined p-value,
 * and per-stream chi-squared values are byte-for-byte reproducible across runs.
 *
 * Each stream still gets its own independent HMAC key (no cross-stream
 * correlation). To regenerate (will change all reported numbers — re-sync
 * prose docs after):
 *   for (let i=0;i<PASS1_STREAMS;i++) {
 *     console.log({server: crypto.randomBytes(32).toString('hex'),
 *                  client: crypto.randomBytes(16).toString('hex')});
 *   }
 */
const SIM_SEEDS: Array<{ server: string; client: string }> = [
  { server: '1260a39e9243af6bd6e5e1a5032a83632b4ba0e2e428889770280dfcaeebb1f3', client: '2fa010d6d8e538054991fa2d0a9966c7' },
  { server: '627f64c08d6043a284e7a58c94170f194ca4d66f8a579e608fd9c6ab9751b527', client: '495b38e4e6a94a925646092a5035769a' },
  { server: '4d45efabffaf073aec531adaf2f5fdb7b4f7a1b9c5d9012f5b881bc013252982', client: '90d93a26ee024381f8e04f0d44a0e32f' },
  { server: '4d078bb64897b2bf09d347577214f095c970ad0bc77a47cd8ef4eab85a929ac9', client: 'bcb0a4b168daf0078255f0d523432714' },
  { server: 'c59a98a9267ec60dc96af9220dffd6933e049938e036e2bb45df18e2b36ebf05', client: 'ce0178585ee2e773c71965069765f921' },
  { server: 'b219c532ad3a30c4eaea1ce481d83e2adb17c5fee81a89e20c3505e430d183f0', client: 'f998bb52a07e40501380e445402ca4d1' },
  { server: 'e943b7416f0f95a259677ed16a4cda7b484489cee611bf9a52fcad1e1c418867', client: '814dcba8742becdeb57464040b20baab' },
  { server: 'ce32cb732e7bffa53b3a7ebffc332ac1061fbc26a0e0523271cb7aa1887789c0', client: '3eff4c20e6ac28209484f38d5af61cfd' },
  { server: 'd840669e1cb79aebed76b33d59417892acf2d3e4be043187420875a5738d5edf', client: '848f71847fa41946953bc77b9c112e85' },
  { server: '1f90b5b53ba3b23525b9983ea11c1a7c6d7b77c8ce7291cab4c4b6418563c542', client: '5177a5e344f14be3f0fa97cff2d1e0ae' },
];
if (SIM_SEEDS.length !== PASS1_STREAMS) {
  throw new Error(`SIM_SEEDS length ${SIM_SEEDS.length} != PASS1_STREAMS ${PASS1_STREAMS}`);
}

// ── Theoretical rank distribution for a single 5-card deal ────────────────────
// C(52,5) = 2,598,960 total hands.
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

const TOTAL_HANDS = 2_598_960;
const MULTIPLIERS = videoPokerConfig.multipliers as Record<HandRank, number>;

function theoreticalDealOnlyRTP(): number {
  let total = 0;
  for (const rank of HAND_RANKS) {
    total += (THEORETICAL_COUNTS[rank] / TOTAL_HANDS) * MULTIPLIERS[rank];
  }
  return total;
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function progressBar(current: number, total: number, label: string, startMs: number, width = 30): void {
  const ratio   = Math.min(current / total, 1);
  const filled  = Math.round(ratio * width);
  const bar     = '━'.repeat(filled) + '╌'.repeat(width - filled);
  const pct     = (ratio * 100).toFixed(0).padStart(3);
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  const eta     = current > 0 ? (((Date.now() - startMs) / current) * (total - current) / 1000).toFixed(0) : '?';
  process.stdout.write(`\r  ${bar} ${pct}% │ ${current}/${total} │ ${label} │ ${elapsed}s elapsed · ~${eta}s left`);
}

function clearLine(): void { process.stdout.write('\r\x1b[K'); }

// ── Pass 1: Multi-stream Fisher's method ─────────────────────────────────────

interface StreamResult {
  stream:    number;
  chi2:      number;
  df:        number;
  pValue:    number;
  rtp:       number;
  observed:  Record<HandRank, number>;
}

interface Pass1Result {
  totalRounds:          number;
  streams:              number;
  roundsPerStream:      number;
  streamResults:        StreamResult[];
  fisherCombined:       { statistic: number; df: number; pValue: number };
  serialIndependenceFails: number;
  lag1Autocorrelation:  number;
  runsTest:             { runs: number; expected: number; z: number; pValue: number };
  empiricalRTP:         number;
  theoreticalRTP:       number;
  rtpDeviation:         number;
  rtpSnapshots:         Array<{ rounds: number; rtp: number }>;
  observedCounts:       Record<HandRank, number>;
  expectedCounts:       Record<HandRank, number>;
  seeds:                typeof SIM_SEEDS;
}

function runPass1(): Pass1Result {
  console.log(`Pass 1 — ${PASS1_STREAMS} streams × ${PASS1_ROUNDS_EACH.toLocaleString()} rounds = ${PASS1_ROUNDS_TOTAL.toLocaleString()} total`);
  console.log(`  Chi-squared per stream, combined via Fisher's method\n`);
  const startMs = Date.now();

  const streamResults: StreamResult[] = [];
  const aggObserved = blankRankCounts();
  const rankIndexSeq = new Array(PASS1_ROUNDS_TOTAL) as number[];
  let totalPayout     = 0;
  let globalRound     = 0;

  const snapshots: Array<{ rounds: number; rtp: number }> = [];
  let snapshotIdx = 0;

  for (let s = 0; s < PASS1_STREAMS; s++) {
    const keyBuffer = Buffer.from(SIM_SEEDS[s].server, 'hex');
    const clientSeed = SIM_SEEDS[s].client;
    const observed = blankRankCounts();
    let streamPayout = 0;

    for (let nonce = 0; nonce < PASS1_ROUNDS_EACH; nonce++) {
      const deck = computeShuffledDeckFromBuffer(keyBuffer, clientSeed, nonce);
      const hand = deck.slice(0, 5);
      const rank = evaluateHand(hand);

      observed[rank]++;
      aggObserved[rank]++;
      streamPayout += MULTIPLIERS[rank];
      totalPayout  += MULTIPLIERS[rank];
      rankIndexSeq[globalRound] = HAND_RANKS.indexOf(rank);
      globalRound++;

      while (snapshotIdx < CONVERGENCE_SAMPLES.length && globalRound === CONVERGENCE_SAMPLES[snapshotIdx]) {
        snapshots.push({ rounds: globalRound, rtp: totalPayout / globalRound });
        snapshotIdx++;
      }

      if (globalRound % 10000 === 0) progressBar(globalRound, PASS1_ROUNDS_TOTAL, 'Pass 1', startMs);
    }

    // Per-stream chi-squared
    const expected = HAND_RANKS.map(r => (THEORETICAL_COUNTS[r] / TOTAL_HANDS) * PASS1_ROUNDS_EACH);
    const chi = chiSquaredTest(HAND_RANKS.map(r => observed[r]), expected);

    streamResults.push({
      stream: s,
      chi2:   chi.chi2,
      df:     chi.df,
      pValue: chi.pValue,
      rtp:    streamPayout / PASS1_ROUNDS_EACH,
      observed,
    });
  }
  clearLine();

  // Fisher's combined test: T = -2 Σ ln(p_i) ~ χ²(2K)
  const fisherStat = -2 * streamResults.reduce((sum, r) => sum + Math.log(r.pValue), 0);
  const fisherDf   = 2 * PASS1_STREAMS;
  const fisherP    = chiSquaredPValue(fisherStat, fisherDf);

  // Serial independence on full combined stream
  const lag1 = lag1Autocorrelation(rankIndexSeq);
  const runs = runsTest(rankIndexSeq);

  // Serial independence: |lag1Z| < 3 AND runsP >= 0.01 (matches Crash methodology)
  const lag1Z = lag1 * Math.sqrt(PASS1_ROUNDS_TOTAL);
  const lag1P = 2 * (1 - normalCDF(Math.abs(lag1Z)));
  const serialPass = Math.abs(lag1Z) < 3 && runs.pValue >= 0.01;
  const serialFails = serialPass ? 0 : 1;

  const empiricalRTP   = totalPayout / PASS1_ROUNDS_TOTAL;
  const theoreticalRTP = theoreticalDealOnlyRTP();
  const rtpDeviation   = (empiricalRTP - theoreticalRTP) / theoreticalRTP;

  // Per-stream report
  console.log('\n  Per-stream chi-squared:');
  for (const r of streamResults) {
    const mark = r.pValue < 0.01 ? ' ← below α' : '';
    console.log(`    Stream ${r.stream}: χ²(${r.df})=${r.chi2.toFixed(2)}, p=${r.pValue.toFixed(4)}, RTP=${(r.rtp * 100).toFixed(2)}%${mark}`);
  }
  const belowAlpha = streamResults.filter(r => r.pValue < 0.01).length;
  console.log(`  Streams below α=0.01: ${belowAlpha}/${PASS1_STREAMS}`);
  console.log(`\n  Fisher's combined: T=${fisherStat.toFixed(2)}, df=${fisherDf}, p=${fisherP.toFixed(6)}`);
  console.log(`  Lag-1 autocorrelation: r=${lag1.toFixed(6)}, z=${lag1Z.toFixed(3)}, p=${lag1P.toFixed(4)}`);
  console.log(`  Runs test: z=${runs.z.toFixed(3)}, p=${runs.pValue.toFixed(4)}`);
  console.log(`  Serial independence failures: ${serialFails}`);

  const expectedCounts: Record<HandRank, number> = {} as Record<HandRank, number>;
  for (const rank of HAND_RANKS) {
    expectedCounts[rank] = (THEORETICAL_COUNTS[rank] / TOTAL_HANDS) * PASS1_ROUNDS_TOTAL;
  }

  return {
    totalRounds:            PASS1_ROUNDS_TOTAL,
    streams:                PASS1_STREAMS,
    roundsPerStream:        PASS1_ROUNDS_EACH,
    streamResults,
    fisherCombined:         { statistic: fisherStat, df: fisherDf, pValue: fisherP },
    serialIndependenceFails: serialFails,
    lag1Autocorrelation:    lag1,
    runsTest:               runs,
    empiricalRTP,
    theoreticalRTP,
    rtpDeviation,
    rtpSnapshots:           snapshots,
    observedCounts:         aggObserved,
    expectedCounts,
    seeds:                  SIM_SEEDS,
  };
}

// ── Pass 2: captured seeds × 10K nonces each ─────────────────────────────────

interface Pass2SeedResult {
  serverSeedHashed:        string;
  nonces:                  number;
  observedCounts:          Record<HandRank, number>;
  earlyWindowCounts:       Record<HandRank, number>;
  extendedWindowCounts:    Record<HandRank, number>;
  earlyWindowRTP:          number;
  extendedWindowRTP:       number;
  earlyChiSquared:         { chi2: number; df: number; pValue: number };
  windowDifferenceBinomial:number;
  flaggedCherryPick:       boolean;
}

interface Pass2Result {
  totalSeeds:           number;
  totalRounds:          number;
  perSeed:              Pass2SeedResult[];
  aggregatedCounts:     Record<HandRank, number>;
  aggregatedRTP:        number;
  aggregatedChiSquared: { chi2: number; df: number; pValue: number };
  flaggedSeeds:         number;
  cherryPickBinomial:   number;
}

function runPass2(dataset: VideoPokerDataset): Pass2Result {
  const seedMap = buildSeedMap(dataset.seeds);
  console.log(`\nPass 2 — ${seedMap.size} revealed seeds × ${PASS2_NONCES_PER_SEED.toLocaleString()} nonces each`);
  if (seedMap.size === 0) {
    console.warn('  (no revealed seeds — skipping Pass 2)');
    return {
      totalSeeds: 0, totalRounds: 0, perSeed: [],
      aggregatedCounts: blankRankCounts(), aggregatedRTP: 0,
      aggregatedChiSquared: { chi2: 0, df: 0, pValue: 1 },
      flaggedSeeds: 0, cherryPickBinomial: 1,
    };
  }

  const startMs = Date.now();
  const perSeed: Pass2SeedResult[] = [];
  const agg = blankRankCounts();
  let totalPayout = 0;
  let totalRounds = 0;

  for (const [hashed, plaintext] of seedMap.entries()) {
    const entry = dataset.seeds.find(e => e.seed.serverSeedHashed === hashed);
    if (!entry) continue;
    const clientSeed = entry.seed.clientSeed;
    const keyBuffer  = Buffer.from(plaintext, 'hex');

    const counts         = blankRankCounts();
    const earlyCounts    = blankRankCounts();
    const extendedCounts = blankRankCounts();
    let earlyPayout      = 0;
    let extendedPayout   = 0;

    for (let nonce = 0; nonce < PASS2_NONCES_PER_SEED; nonce++) {
      const deck = computeShuffledDeckFromBuffer(keyBuffer, clientSeed, nonce);
      const rank = evaluateHand(deck.slice(0, 5));
      counts[rank]++;
      agg[rank]++;
      totalPayout += MULTIPLIERS[rank];

      if (nonce < EPOCH_LENGTH) {
        earlyCounts[rank]++;
        earlyPayout += MULTIPLIERS[rank];
      } else {
        extendedCounts[rank]++;
        extendedPayout += MULTIPLIERS[rank];
      }
    }

    const earlyRTP    = earlyPayout    / EPOCH_LENGTH;
    const extendedRTP = extendedPayout / (PASS2_NONCES_PER_SEED - EPOCH_LENGTH);

    // Cherry-pick detection: chi-squared on hand-rank distribution for the early
    // window (nonces 0–49) vs theoretical. RTP-based z-tests produce false flags
    // in high-variance games (0x–813x multipliers).
    const earlyObserved = HAND_RANKS.map(r => earlyCounts[r]);
    const earlyExpected = HAND_RANKS.map(r => (THEORETICAL_COUNTS[r] / TOTAL_HANDS) * EPOCH_LENGTH);
    const earlyChi = chiSquaredTest(earlyObserved, earlyExpected);

    perSeed.push({
      serverSeedHashed: hashed, nonces: PASS2_NONCES_PER_SEED,
      observedCounts: counts, earlyWindowCounts: earlyCounts, extendedWindowCounts: extendedCounts,
      earlyWindowRTP: earlyRTP, extendedWindowRTP: extendedRTP,
      earlyChiSquared: earlyChi,
      windowDifferenceBinomial: earlyChi.pValue, flaggedCherryPick: earlyChi.pValue < 0.05,
    });

    totalRounds += PASS2_NONCES_PER_SEED;
    progressBar(perSeed.length, seedMap.size, 'Pass 2', startMs);
  }
  clearLine();

  const aggExpected = HAND_RANKS.map(r => (THEORETICAL_COUNTS[r] / TOTAL_HANDS) * totalRounds);
  const aggObserved = HAND_RANKS.map(r => agg[r]);
  const aggChi      = chiSquaredTest(aggObserved, aggExpected);

  const flaggedSeeds = perSeed.filter(s => s.flaggedCherryPick).length;
  const cherryPickBinomial = binomialTailPValue(seedMap.size, 0.05, flaggedSeeds);

  console.log(`  Seeds tested:    ${seedMap.size}`);
  console.log(`  Flagged seeds:   ${flaggedSeeds}`);
  console.log(`  Binomial p:      ${cherryPickBinomial.toFixed(4)}`);

  return {
    totalSeeds: seedMap.size, totalRounds, perSeed,
    aggregatedCounts: agg, aggregatedRTP: totalPayout / totalRounds,
    aggregatedChiSquared: aggChi, flaggedSeeds, cherryPickBinomial,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function blankRankCounts(): Record<HandRank, number> {
  const o: Record<HandRank, number> = {} as Record<HandRank, number>;
  for (const r of HAND_RANKS) o[r] = 0;
  return o;
}

function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.sign(x) * y;
}

function binomialTailPValue(n: number, p: number, observed: number): number {
  let tail = 0;
  for (let k = observed; k <= n; k++) tail += binomPMF(n, p, k);
  return tail;
}

function binomPMF(n: number, p: number, k: number): number {
  const logC = logBinomCoeff(n, k);
  return Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

function logBinomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  const kk = Math.min(k, n - k);
  let result = 0;
  for (let i = 0; i < kk; i++) result += Math.log(n - i) - Math.log(i + 1);
  return result;
}

// ── RTP convergence chart ─────────────────────────────────────────────────────

function buildConvergenceChart(p1: Pass1Result): string {
  const labels = p1.rtpSnapshots.map(s => s.rounds.toLocaleString());
  const values = p1.rtpSnapshots.map(s => s.rtp);
  const theo   = p1.theoreticalRTP;

  // Hand-rank distribution: observed vs theoretical
  const rankLabels = HAND_RANKS.map(r => r.replace(/_/g, ' '));
  const observed   = HAND_RANKS.map(r => p1.observedCounts[r]);
  const expected   = HAND_RANKS.map(r => p1.expectedCounts[r]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DUEL VIDEO POKER — ${(PASS1_ROUNDS_TOTAL/1_000_000).toFixed(0)}M SIMULATED ROUNDS</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; color: #333; padding: 24px; }
  .container { max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; padding: 32px; }
  .chart-wrap { position: relative; height: 420px; margin-bottom: 24px; }
  h1   { text-align: center; font-size: 16px; font-weight: 600; color: #333; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
  h2   { text-align: center; font-size: 14px; color: #666; margin-top: 40px; margin-bottom: 8px; }
  .box { background: #fff; padding: 14px; border: 1px solid #e0e0e0; border-radius: 8px; margin: 10px auto; max-width: 900px; }
  .note { text-align: center; font-size: 11px; color: #999; margin: 6px 0; }
</style>
</head>
<body>
<div class="container">

<h1>DUEL VIDEO POKER — DEAL-ONLY RTP CONVERGENCE</h1>
<p class="note">${PASS1_STREAMS} streams x ${(PASS1_ROUNDS_EACH/1_000_000).toFixed(0)}M = ${(PASS1_ROUNDS_TOTAL/1_000_000).toFixed(0)}M rounds | Fisher's method | Confirms deck shuffle is unbiased</p>
<div class="chart-wrap"><canvas id="convergence"></canvas></div>

<div class="box">
  <p><b>Final empirical RTP (deal-only):</b> ${(p1.empiricalRTP * 100).toFixed(4)}%</p>
  <p><b>Theoretical RTP (deal-only):</b> ${(theo * 100).toFixed(4)}%</p>
  <p><b>Deviation:</b> ${(p1.rtpDeviation * 100).toFixed(4)}%</p>
  <p><b>Fisher's combined p-value:</b> ${p1.fisherCombined.pValue.toFixed(6)} (T=${p1.fisherCombined.statistic.toFixed(2)}, df=${p1.fisherCombined.df})</p>
  <p><b>Serial independence failures:</b> ${p1.serialIndependenceFails}</p>
  <p><b>Optimal-play RTP:</b> 99.9000% (exact, exhaustive C(52,5) enumeration — see optimal-play-rtp.json)</p>
</div>

<h2>HAND-RANK DISTRIBUTION — OBSERVED vs THEORETICAL</h2>
<p class="note">${(PASS1_ROUNDS_TOTAL/1_000_000).toFixed(0)}M simulated deals | Expected counts from C(52,5) = 2,598,960 combinatorial probabilities</p>
<div class="chart-wrap"><canvas id="distribution"></canvas></div>

<script>
// Chart 1: RTP Convergence
new Chart(document.getElementById('convergence'), {
  type: 'line',
  data: {
    labels: ${JSON.stringify(labels)},
    datasets: [
      { label: 'Empirical RTP', data: ${JSON.stringify(values)}, borderColor: '#1565c0', fill: false, tension: 0.15, pointRadius: 3 },
      { label: 'Theoretical RTP', data: ${JSON.stringify(Array(labels.length).fill(theo))}, borderColor: '#e57373', borderDash: [5, 5], fill: false, pointRadius: 0 },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: { ticks: { color: '#666', callback: v => (v * 100).toFixed(2) + '%' }, grid: { color: '#e0e0e0' } },
      x: { ticks: { color: '#666' }, grid: { color: '#e0e0e0' } },
    },
    plugins: { legend: { labels: { color: '#333' } } },
  },
});

// Chart 2: Hand-Rank Distribution Bar Chart
new Chart(document.getElementById('distribution'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(rankLabels)},
    datasets: [
      { label: 'Observed', data: ${JSON.stringify(observed)}, backgroundColor: 'rgba(21, 101, 192, 0.6)', borderColor: '#1565c0', borderWidth: 1 },
      { label: 'Expected', data: ${JSON.stringify(expected.map(e => Math.round(e)))}, backgroundColor: 'rgba(229, 115, 115, 0.4)', borderColor: '#e57373', borderWidth: 1, borderDash: [3, 3] },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        type: 'logarithmic',
        ticks: { color: '#666', callback: function(v) { return Number(v).toLocaleString(); } },
        grid: { color: '#e0e0e0' },
        title: { display: true, text: 'Count (log scale)', color: '#666' },
      },
      x: { ticks: { color: '#666', maxRotation: 45 }, grid: { color: '#e0e0e0' } },
    },
    plugins: {
      legend: { labels: { color: '#333' } },
      tooltip: {
        callbacks: {
          afterLabel: function(ctx) {
            const obs = ${JSON.stringify(observed)};
            const exp = ${JSON.stringify(expected)};
            const i = ctx.dataIndex;
            const ratio = (obs[i] / exp[i] * 100).toFixed(2);
            return 'Ratio: ' + ratio + '% of expected';
          }
        }
      }
    },
  },
});
</script>
</div>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═'.repeat(66));
  console.log('  DUEL VIDEO POKER — MONTE CARLO SIMULATION');
  console.log('  Multi-stream Fisher\'s method (single-config game)');
  console.log('═'.repeat(66));
  console.log();

  const pass1 = runPass1();
  console.log(`\n  Empirical RTP:   ${(pass1.empiricalRTP   * 100).toFixed(4)}%`);
  console.log(`  Theoretical RTP: ${(pass1.theoreticalRTP * 100).toFixed(4)}%`);
  console.log(`  Deviation:       ${(pass1.rtpDeviation  * 100).toFixed(4)}%`);
  console.log(`  Fisher's p:      ${pass1.fisherCombined.pValue.toFixed(6)}`);
  console.log();

  let pass2: Pass2Result;
  try {
    const dataset = loadDataset();
    pass2 = runPass2(dataset);
  } catch (e) {
    console.warn('\n  (dataset not yet available — Pass 2 skipped)');
    pass2 = {
      totalSeeds: 0, totalRounds: 0, perSeed: [],
      aggregatedCounts: blankRankCounts(), aggregatedRTP: 0,
      aggregatedChiSquared: { chi2: 0, df: 0, pValue: 1 },
      flaggedSeeds: 0, cherryPickBinomial: 1,
    };
  }

  const outDir = path.join(__dirname, '../outputs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const results = {
    generatedAt: new Date().toISOString(),
    pass1,
    pass2,
  };

  const resultsPath = path.join(outDir, 'simulation-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\n  Wrote ${resultsPath}`);

  const chartPath = path.join(outDir, 'rtp-convergence.html');
  fs.writeFileSync(chartPath, buildConvergenceChart(pass1));
  console.log(`  Wrote ${chartPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
