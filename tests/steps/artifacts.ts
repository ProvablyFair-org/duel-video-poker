/**
 * Step 28 — Artifact Integrity.
 *
 * Recompute the SHA-256 of every artifact of record and compare it with the pin in
 * src/artifact-pins.ts. A missing or altered artifact is a HARD FAIL, not a flag: the figures in
 * these files are published, and a flag exits 0.
 *
 * The verifier's own products (verification-results.json, determinism-log.json,
 * chi-squared-results.json, payout-coverage.json) are not pinned here — they are scored by the
 * reproduction gate in tests/verify.ts, field by field at tolerance.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { StepResult, VerifyContext } from './context';
import { step } from './context';
import { ARTIFACT_PINS } from '../../src/artifact-pins';
import { domainRules, validateDomains, describeDomainFailures } from '../../src/domains';

export function run(ctx: VerifyContext): StepResult[] {
  const outputsDir = ctx.outputsDir ?? path.join(__dirname, '..', '..', 'outputs');

  const issues: string[] = [];
  const matched: string[] = [];
  let absent = 0, mismatched = 0;

  for (const [file, expected] of Object.entries(ARTIFACT_PINS)) {
    const fp = path.join(outputsDir, file);
    if (!fs.existsSync(fp)) {
      absent++;
      issues.push(`${file} ABSENT — a pinned artifact of record is missing`);
      continue;
    }
    const actual = createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    if (actual !== expected) {
      mismatched++;
      issues.push(`${file} sha256 ${actual.slice(0, 16)}… != pin ${expected.slice(0, 16)}… — the scored artifact is not the committed one`);
    } else {
      matched.push(file);
    }
  }

  const pinned = Object.keys(ARTIFACT_PINS).length;

  // VALUE DOMAINS (profile VP-27, added 2026-09-26; src/domains.ts). A pin proves the bytes did not move
  // since pinning; it cannot tell a genuine figure from an impossible one that was written and re-pinned.
  // Every numeric leaf of every committed JSON artifact the rule table names is validated in both
  // directions: an impossible value FAILs, and a numeric leaf no rule covers FAILs. An absent or
  // unreadable artifact FAILs too — zero leaves checked is not a pass.
  const rules = domainRules();
  const domainProblems: string[] = [];
  let domainLeaves = 0;
  for (const [file, fileRules] of Object.entries(rules)) {
    let doc: unknown;
    try { doc = JSON.parse(fs.readFileSync(path.join(outputsDir, file), 'utf8')); }
    catch { domainProblems.push(`${file} absent or not valid JSON`); continue; }
    const r = validateDomains(doc, fileRules);
    domainLeaves += r.checked;
    if (r.checked === 0) domainProblems.push(`${file}: no numeric leaf found — nothing was checked`);
    domainProblems.push(...describeDomainFailures(file, r));
  }
  const domainFiles = Object.keys(rules).length;

  // The detail names the files, never the hashes: the hashes live in src/artifact-pins.ts, and a
  // detail string must stay identical across runs for the reproduction gate to compare it.
  const ok = issues.length === 0 && domainProblems.length === 0;
  return [step(28, 'Artifact Integrity (pinned artifacts of record)',
    ok ? 'PASS' : 'FAIL',
    !ok
      ? [
        ...(issues.length ? [`${issues.length} of ${pinned} pinned artifact(s) failed: ${issues.join('; ')}`] : []),
        ...(domainProblems.length ? [`VALUE DOMAINS (VP-27): ${domainProblems.length} numeric leaf problem(s): ${domainProblems.slice(0, 4).join('; ')}`] : []),
      ].join(' | ')
      : `${pinned} artifacts of record match their SHA-256 pins in src/artifact-pins.ts: ${matched.join(', ')}. `
        + `verification-results.json, determinism-log.json, chi-squared-results.json and payout-coverage.json `
        + `are this verifier's own products and are scored by the reproduction gate instead. VALUE DOMAINS (VP-27): every one `
        + `of the ${domainLeaves} numeric leaves of ${domainFiles} committed JSON artifacts (${Object.keys(rules).join(', ')}) lies in `
        + `the domain src/domains.ts declares for it (bounds from src/loader.ts and the pinned pay table) and none is undeclared.`,
    { artifactsPinned: pinned, matched: matched.length, absent, mismatched, domainFiles, domainLeavesChecked: domainLeaves, domainProblems: domainProblems.length },
  )];
}
