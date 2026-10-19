/**
 * Video Poker audit verification suite — 28 scored steps + informational items.
 * Run: npm run verify
 * Expected: 27/28 PASS + 1 capture-origin FLAG (step 4, the two capture-retry nonce gaps),
 * verdict PROVABLY FAIR — Full Pass, exit 0. A capture-origin FLAG is disclosed, verdict-neutral.
 */

import * as fs   from 'fs';
import * as path from 'path';

import { loadDataset, checkDatasetHash, checkConfigHash, buildSeedMap, groupByHash, groupByEpochWindow } from '../src/loader';
import { labelFor, profileCoverageBlock } from '../src/profile-map';
import { runRtpClaimGate, RTP_CLAIM_STEP } from '../src/rtp-settings';
import { rtpClaimVerdict, RTP_FIGURE_OVERSTATED, RTP_FIGURE_OVERSTATED_EXIT } from '../src/rtp-claim';
import type { VerifyContext, InfoItem }                 from './steps/context';

import * as commitment   from './steps/commitment';
import * as determinism  from './steps/determinism';
import * as payouts      from './steps/payouts';
import * as dataset      from './steps/dataset';
import * as simulation   from './steps/simulation';
import * as gameSpecific from './steps/game-specific';
import * as statistical  from './steps/statistical';
import * as artifacts    from './steps/artifacts';
import { fieldDiff, beyondTolerance, maxima, DIFF_ATOL, DIFF_RTOL } from '../src/diff';

// ── Pre-flight: dataset hash ───────────────────────────────────────────────────

const hashCheck = checkDatasetHash();
console.log('\n  Dataset hash check:');
console.log(`    Expected: ${hashCheck.expected}`);
console.log(`    Actual:   ${hashCheck.actual}`);
console.log(`    Status:   ${hashCheck.match ? 'MATCH ✓' : 'MISMATCH ✗ — abort'}\n`);
if (!hashCheck.match) { process.exit(1); }

// The paytable config the derivation reads is pinned too (profile VP-26): abort before any step.
const configCheck = checkConfigHash();
console.log('  Paytable config hash check:');
console.log(`    Expected: ${configCheck.expected}`);
console.log(`    Actual:   ${configCheck.actual}`);
console.log(`    Status:   ${configCheck.match ? 'MATCH ✓' : 'MISMATCH ✗ — abort'}\n`);
if (!configCheck.match) { process.exit(1); }

// ── Setup ─────────────────────────────────────────────────────────────────────

const ds      = loadDataset();
const seedMap = buildSeedMap(ds.seeds);

const bets   = ds.bets;
const seeds  = ds.seeds;
const phaseA = bets.filter(b => b.phase === 'A');
const phaseB = bets.filter(b => b.phase === 'B');
const phaseC = bets.filter(b => b.phase === 'C');
const phaseD = bets.filter(b => b.phase === 'D');
const phaseE = bets.filter(b => b.phase === 'E');

const outputsDir = path.join(__dirname, '../outputs');

console.log('══════════════════════════════════════════════════════════');
console.log('  VIDEO POKER AUDIT — VERIFICATION SUITE');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Dataset: ${bets.length} bets  |  Seeds: ${seeds.length}  |  Revealed: ${seedMap.size}`);
console.log(`  Phase A: ${phaseA.length}  B: ${phaseB.length}  C: ${phaseC.length}  D: ${phaseD.length}  E: ${phaseE.length}\n`);

// ── Build context ─────────────────────────────────────────────────────────────

const byHash = groupByHash(bets);
const { epochs, orphans: orphanBets } = groupByEpochWindow(bets, seeds);

const ctx: VerifyContext = {
  bets, seeds, seedMap, byHash, epochs, orphanBets,
  phaseA, phaseB, phaseC, phaseD, phaseE,
  outputsDir,
  headerPhaseBetCounts: (ds.meta as { phaseBetCounts?: Record<string, number> })?.phaseBetCounts ?? null,
  step5Mismatches: 0,
  step5Skipped:    0,
  chiResultsLog:   [],
  payoutCoverage:  null,
};

// ── Run scored steps ─────────────────────────────────────────────────────────

const results = [
  ...commitment.run(ctx),    // Steps  1– 4
  ...determinism.run(ctx),   // Steps  5– 6
  ...payouts.run(ctx),       // Steps  7– 9
  ...dataset.run(ctx),       // Steps 10–15
  ...simulation.run(ctx),    // Steps 16–18
  ...gameSpecific.run(ctx),  // Steps 19–27
  ...artifacts.run(ctx),     // Step  28
];

// ── RTP-CLAIM rule (1.2.0, Methodology v1.1; wired 2026-10-14, decision D4) ───────
// The optimal-play RTP table held to the published claim (src/rtp-settings.ts). The package switch
// RTP_CLAIM_RULE_ENFORCED is true (D3, 2026-10-14). Status OVERSTATED (a house-side miss) is scored on
// the step carrying VP-19 as an operator-origin FLAG (the profile's policy) and the verdict becomes
// RTP FIGURE OVERSTATED, exit 5 (rtpClaimVerdict) — never NOT PROVABLY FAIR: the draws themselves
// pass. Status FAIL means the committed table no longer equals this run (or its pin): a reproduction
// failure, exit 1, whether or not the rule is enforced; no step moves for it.
const rtpClaim = runRtpClaimGate();
console.log('');
for (const line of rtpClaim.lines) console.log(`  ${line}`);
const rtpOverstated = rtpClaim.status === 'OVERSTATED';
if (rtpOverstated) {
  const s = (results as any[]).find(r => r.step === RTP_CLAIM_STEP);
  if (s && s.status !== 'FAIL') {
    s.status = 'FLAG'; delete s.origin;   // operator-origin: this package marks only capture flags
    s.detail += ` — ${RTP_FIGURE_OVERSTATED} (RTP-CLAIM enforced): ${rtpClaim.result.minimalFix}`;
    // The step printed its own line when it ran, before this rule was scored. Print it again at the
    // status it is now counted at, so the console agrees with the summary and the emitted record.
    console.log(`  [FLAG] Step ${s.step} — ${s.name} (re-scored: RTP-CLAIM enforced, ${RTP_FIGURE_OVERSTATED})`);
    console.log(`         ${s.detail}`);
  }
}

// ── Run informational items (live-bet stats — underpowered, not scored) ──────

const infoItems: InfoItem[] = statistical.run(ctx);

// ── Summary ───────────────────────────────────────────────────────────────────

const passed   = results.filter(r => r.status === 'PASS').length;
const flags    = results.filter(r => r.status === 'FLAG').length;
const hardFail = results.filter(r => r.status === 'FAIL').length;
// INFO (profile policy INFORMATIONAL — the live-sample fit, Mike 2026-09-29): reported, never counted
// as a flag, never enters the verdict or the exit code.
const informational = results.filter(r => r.status === 'INFO').length;
// A capture-origin FLAG (an auditor-side capture retry that left a nonce gap) is disclosed but
// verdict-neutral; only an operator-origin FLAG downgrades to Conditional Pass. Same rule as Duel
// plinko (adopted 2026-09-22): not a PASS, but not against the verdict either.
const captureFlags  = results.filter(r => r.status === 'FLAG' && r.origin === 'capture');
const operatorFlags = results.filter(r => r.status === 'FLAG' && r.origin !== 'capture');
// Ranked by the rule's rtpClaimVerdict: a failed draw check (NOT PROVABLY FAIR) > RTP FIGURE
// OVERSTATED > Conditional Pass > Full Pass. This suite has no INCOMPLETE state.
const ruled    = rtpClaimVerdict({ fails: hardFail, complete: true, overstated: rtpOverstated, opFlags: operatorFlags.length });
const verdict  = ruled.verdict;

// Display informational items
if (infoItems.length > 0) {
  console.log('');
  console.log('  ┌── Informational Context (not scored) ──');
  for (const item of infoItems) console.log(`  │ ${item.label}: ${item.detail}`);
  console.log('  └──');
}

console.log('\n══════════════════════════════════════════════════════════');
console.log('  RESULTS SUMMARY');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Passed:     ${passed}/${results.length}`);
console.log(`  Hard fails: ${hardFail}`);
console.log(`  Flags:      ${flags} (${operatorFlags.length} verdict-affecting, ${captureFlags.length} capture-origin)`);
if (informational > 0) console.log(`  Informational deviations: ${informational} (reported, not counted, verdict unchanged)`);
if (captureFlags.length > 0) {
  console.log('\n  CAPTURE-ORIGIN LIMITATIONS (disclosed, verdict-neutral):');
  for (const r of captureFlags) console.log(`  ⚑ Step ${r.step}: ${r.name}`);
}
console.log(`\n  VERDICT: ${verdict}`);
console.log('══════════════════════════════════════════════════════════\n');

// ── Write output ──────────────────────────────────────────────────────────────

// NO RUN METADATA in the committed results (profile VP-27, 2026-09-26): `generatedAt` was removed
// from these three objects, as in the dice and mines packages; the runtime is in outputs/run/diff.json.
const verificationOutput = {
  totalBets:   bets.length,
  totalSeeds:  seeds.length,
  revealedSeeds: seedMap.size,
  // Each scored step says which ProvablyFair.org Video Poker profile check it implements
  // (src/profile-map.ts), so the conformance matrix is derived from this artifact. The label is
  // attached to the emitted record only; it cannot change what a step asserts.
  steps:       results.map(r => ({ ...r, ...labelFor(r.step) })),
  profileCoverage: profileCoverageBlock(),
  info:        infoItems,
  summary:     { passed, flags, operatorFlags: operatorFlags.length, captureFlags: captureFlags.length, hardFail, verdict },
};

const determinismOutput = {
  verified:    bets.length - ctx.step5Skipped,
  mismatches:  ctx.step5Mismatches,
  skipped:     ctx.step5Skipped,
};

const chiSquaredOutput = {
  groups:      ctx.chiResultsLog,
};

// Which of the ten pay-table hand ranks live play actually finished on, and the deal-stage
// payout mass resting on the ones it never produced — royal_flush above all, the largest
// multiplier in the table and the rarest outcome in the game. NO `generatedAt`: this is an
// artifact of record derived wholly from the pinned dataset and the pinned config, so a
// timestamp inside it would mean a regeneration could never reproduce the pinned bytes even
// when every figure is identical. Step 11 fills it; the reproduction gate below scores it.
const payoutCoverageOutput = ctx.payoutCoverage ?? { error: 'step 11 did not run' };

// A VERIFICATION RUN MUST NOT REWRITE THE ARTIFACT IT SCORES. A run that disagrees with the
// committed evidence would otherwise destroy the evidence of the disagreement, and the next run
// would compare the repo against what the failing run had just written. This run writes under
// outputs/run/ — gitignored, a run record rather than audit evidence. The committed copies in
// outputs/ are refreshed only by PF_EMIT=1.
const PF_EMIT = process.env.PF_EMIT === '1';
const RUN_DIR = path.join(outputsDir, 'run');
const RESULTS_DIR = PF_EMIT ? outputsDir : RUN_DIR;
fs.mkdirSync(outputsDir, { recursive: true });
fs.mkdirSync(RUN_DIR, { recursive: true });

fs.writeFileSync(path.join(RESULTS_DIR, 'verification-results.json'), JSON.stringify(verificationOutput, null, 2));
fs.writeFileSync(path.join(RESULTS_DIR, 'determinism-log.json'), JSON.stringify(determinismOutput, null, 2));
fs.writeFileSync(path.join(RESULTS_DIR, 'chi-squared-results.json'), JSON.stringify(chiSquaredOutput, null, 2));
fs.writeFileSync(path.join(RESULTS_DIR, 'payout-coverage.json'), JSON.stringify(payoutCoverageOutput, null, 2));

const WROTE_TO = PF_EMIT ? 'outputs' : 'outputs/run';
console.log(`  Outputs written to: ${WROTE_TO}/verification-results.json`);
console.log(`  Outputs written to: ${WROTE_TO}/determinism-log.json`);
console.log(`  Outputs written to: ${WROTE_TO}/chi-squared-results.json`);
console.log(`  Outputs written to: ${WROTE_TO}/payout-coverage.json`);
if (!PF_EMIT) console.log('  Committed artifacts NOT modified.');

// ── Reproduction gate ─────────────────────────────────────────────────────────
// THE GATE IS "BEYOND TOLERANCE", NOT "ANY FIELD". Byte identity is the right bar for exact
// content — the dataset, hash-guarded above. It is the wrong bar for a DERIVED statistic:
// recomputed on other hardware a floating-point figure can move by a unit in the last place.
// Scoring that as a disagreement trains a reader to ignore the diff, which is the one outcome
// that makes it useless. The bound is declared in src/diff.ts, far below the precision of any
// figure this audit publishes; outside it is a DIFFERENT result, and the run exits 1.
let reproductionFailures = 0;
if (!PF_EMIT) {
  const readJsonOrNull = (p: string): unknown => {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  };
  const targets: { file: string; fresh: unknown }[] = [
    { file: 'verification-results.json', fresh: verificationOutput },
    { file: 'determinism-log.json',      fresh: determinismOutput },
    { file: 'chi-squared-results.json',  fresh: chiSquaredOutput },
    { file: 'payout-coverage.json',      fresh: payoutCoverageOutput },
  ];
  // A simulation re-run (`npm run simulate` without PF_EMIT, as `npm run test:full` does) writes
  // its product under outputs/run/ instead of over the pinned artifact. When one is present it is
  // compared against the committed simulation-results.json the same way — at tolerance — so a
  // re-derived simulation is scored rather than merely produced.
  const runSim = path.join(RUN_DIR, 'simulation-results.json');
  if (fs.existsSync(runSim)) {
    const fresh = readJsonOrNull(runSim);
    if (fresh !== null) targets.push({ file: 'simulation-results.json', fresh });
  }
  // Same for the optimal-play enumeration (profile VP-19, added 2026-09-26): `npm run test:full` re-runs
  // src/compute-optimal-rtp.ts into outputs/run/, and the re-derived artifact is scored against the
  // pinned one here, field by field at tolerance.
  const runOpt = path.join(RUN_DIR, 'optimal-play-rtp.json');
  if (fs.existsSync(runOpt)) {
    const fresh = readJsonOrNull(runOpt);
    if (fresh !== null) targets.push({ file: 'optimal-play-rtp.json', fresh });
  }
  const perFile = targets.map(t => {
    const committed = readJsonOrNull(path.join(outputsDir, t.file));
    // `generatedAt` is a property of the run, not of the evidence, and differs by construction.
    const diffs = fieldDiff(committed, t.fresh, ['generatedAt']);
    return { file: t.file, readable: committed !== null, diffs, real: beyondTolerance(diffs) };
  });
  const allDiffs  = perFile.flatMap(p => p.diffs);
  const realTotal = perFile.reduce((n, p) => n + p.real.length, 0);
  const gap       = maxima(allDiffs);

  fs.writeFileSync(path.join(RUN_DIR, 'diff.json'), JSON.stringify({
    runtime: process.versions.node,
    verdict,
    tolerance: { atol: DIFF_ATOL, rtol: DIFF_RTOL, rule: '|a-b| <= atol + rtol*max(|a|,|b|); two distinct integers never agree' },
    reproduced: realTotal === 0,
    beyondToleranceCount: realTotal,
    withinToleranceCount: allDiffs.length - realTotal,
    largestGap: gap,
    note: 'Field-level diff between the COMMITTED artifacts and THIS RUN. `generatedAt` is '
      + 'excluded because it differs by construction. Entries marked `withinTolerance` are the '
      + 'same result computed on different hardware and are recorded, not scored. Any entry NOT '
      + 'so marked means this run disagrees with the committed evidence — investigate it; do not '
      + 're-run until it goes away, and do not regenerate the committed artifact to make it go away.',
    files: perFile.map(p => ({ file: `outputs/${p.file}`, committedReadable: p.readable, differences: p.diffs })),
  }, null, 2));

  console.log(`  Reproduction vs the committed artifacts on Node ${process.versions.node}: `
    + `${realTotal === 0 ? 'REPRODUCED' : `${realTotal} field(s) BEYOND TOLERANCE`}`
    + `${allDiffs.length - realTotal > 0 ? ` (${allDiffs.length - realTotal} within tolerance` + (gap ? `, largest ${gap.absDiff.toExponential(2)} at ${gap.path}` : '') + ')' : ''}`);
  console.log(`  Diff written to: outputs/run/diff.json`);
  if (realTotal > 0) {
    console.log('  ⚠ THIS RUN DISAGREES WITH THE COMMITTED EVIDENCE:');
    for (const p of perFile) {
      if (!p.readable) { console.log(`      outputs/${p.file}: committed copy absent or unreadable`); continue; }
      for (const d of p.real.slice(0, 4)) {
        console.log(`      ${p.file} ${d.path}: committed ${JSON.stringify(d.committed)} vs this run ${JSON.stringify(d.thisRun)}`);
      }
    }
  }
  reproductionFailures = realTotal;
} else {
  console.log('  REPORT GENERATION (PF_EMIT=1): the committed artifacts in outputs/ were rewritten.');
}

// ── Exit contract ─────────────────────────────────────────────────────────────
// FAIL -> 1, RTP FIGURE OVERSTATED -> 5, operator-origin FLAG -> 2, otherwise 0, so an automated
// caller reads the verdict from the exit status. A reproduction beyond tolerance — the committed
// RTP-claim table included — is a FAIL, not a warning: a gate that only prints is not a gate.
if (hardFail > 0 || reproductionFailures > 0 || !rtpClaim.tableMatches) process.exit(1);
if (ruled.exit === RTP_FIGURE_OVERSTATED_EXIT) process.exit(RTP_FIGURE_OVERSTATED_EXIT);
if (operatorFlags.length > 0) process.exit(2);
// A capture-origin FLAG is disclosed but verdict-neutral: exit 0, so npm test stays green.
