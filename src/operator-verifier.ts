/**
 * DUEL'S OWN Video Poker verification code, vendored and pinned (profile VP-09).
 *
 * WHAT THIS IS. duel.com → Provably Fair → Verify, game Video Poker, shows a JavaScript code panel.
 * It was captured on 2026-04-23 during a browser session on duel.com (the working notes of that
 * session say "Captured 2026-04-23 via browser session on duel.com"; the capture sat in the auditor's
 * working folder subtasks/duel-video-poker/fairness-verify-code.js and was brought into this package,
 * byte for byte, on 2026-09-26). The capture tool saved the panel as one JSON string literal; decoded,
 * it begins "// Code written in javascript / // User input values", the same header as the Dice,
 * Keno, Mines, Plinko and Blackjack panels copied from the same page on 2026-09-25.
 *
 * The runner (verifier-parity/operator/run-operator-verifier.cjs) decodes the literal and runs the
 * code unedited under Node's WebCrypto; both files are pinned below and checked before it runs.
 * Step 5 runs it on every captured hand; tests/videoPoker/VideoPokerTests.ts runs it on fixed
 * captured rounds.
 *
 * ROLE (since 20 Oct 2026, v1.2.0). This file is a SECOND CHECK, not the source of src/rng.ts. src/rng.ts is
 * rebuilt from the written specification docs/ALGORITHM.md by an implementer who never opened Duel's code;
 * Duel's file is run here, byte for byte, to show that it agrees with that rebuild and with the served
 * hands. Through v1.1.0 src/rng.ts was a port of this file and, from 26 Sep 2026, cited 13 of its lines
 * (OPERATOR_SOURCE_CITES, checked by checkOperatorCites); the port and that citation table were removed
 * on 20 Oct 2026.
 *
 * Ported from pf-duel-workspace/games/dice/src/operator-verifier.ts (2026-09-25).
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

export const PACKAGE_ROOT = path.join(__dirname, '..');
export const OPERATOR_VERIFIER_FILE = 'evidence/verify-tab/duel-verify-tab-video-poker-2026-04-23.captured.json';
export const OPERATOR_VERIFIER_RUNNER = 'verifier-parity/operator/run-operator-verifier.cjs';

export const OPERATOR_VERIFIER_PINS: Readonly<Record<string, string>> = Object.freeze({
  'evidence/verify-tab/duel-verify-tab-video-poker-2026-04-23.captured.json': 'f7e0278766eb6407053fe1a6a6ce2072b1a247097d9f27915a3ebb9d21269c87',
  'verifier-parity/operator/run-operator-verifier.cjs':                       '868a5b1487780ac2447ce9ed74619152fae39da08ee48394c1a20489835affb4',
});

/** The only thing the code prints when it runs as shipped (its inputs are empty strings). */
export const OPERATOR_EXPECTED_LOGS: readonly string[] = Object.freeze([
  'Please provide valid serverSeed, clientSeed, and nonce (>=0) before running.',
]);

export interface OperatorRound { id: string; serverSeed: string; clientSeed: string; nonce: number }
export interface OperatorRun {
  files: Array<{ file: string; pinned: string; actual: string | null; match: boolean }>;
  hashesMatch: boolean;
  /** id → the first ten cards of the operator's own shuffle (deal = 0..4, replacements = 5..9), or null if it threw. */
  results: Map<string, string[] | null> | null;
  allCards: string[] | null;
  logs: string[];
  error: string | null;
}

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

export const OPERATOR_RUNNER_TIMEOUT_MS = 300_000;
function runPinnedRunner(root: string, input: string): { status: number | null; stdout: string; stderr: string; error?: Error } {
  // Temp files and a hard timeout, not a pipe (the pipe deadlock seen in the blackjack battery).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-operator-runner-'));
  const inPath = path.join(dir, 'jobs.json');
  const outPath = path.join(dir, 'out.json');
  fs.writeFileSync(inPath, input);
  const inFd = fs.openSync(inPath, 'r');
  const outFd = fs.openSync(outPath, 'w');
  try {
    const r = spawnSync(process.execPath, [path.join(root, OPERATOR_VERIFIER_RUNNER), path.join(root, OPERATOR_VERIFIER_FILE)], {
      stdio: [inFd, outFd, 'pipe'], encoding: 'utf8', timeout: OPERATOR_RUNNER_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 24,
    });
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL';
    return {
      status: timedOut ? null : r.status,
      stdout: fs.readFileSync(outPath, 'utf8'),
      stderr: timedOut ? `runner killed after ${OPERATOR_RUNNER_TIMEOUT_MS} ms (hard timeout)` : (r.stderr || ''),
      error: r.error,
    };
  } finally {
    fs.closeSync(inFd); fs.closeSync(outFd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runOperatorVerifier(rounds: OperatorRound[], root = PACKAGE_ROOT): OperatorRun {
  const files = Object.entries(OPERATOR_VERIFIER_PINS).map(([file, pinned]) => {
    const p = path.join(root, file);
    const actual = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
    return { file, pinned, actual, match: actual === pinned };
  });
  const hashesMatch = files.every(f => f.match);
  if (!hashesMatch) return { files, hashesMatch, results: null, allCards: null, logs: [], error: 'operator Verify-tab code or its runner does not match its pinned SHA-256' };
  const r = runPinnedRunner(root, JSON.stringify({ rounds }));
  if (r.status !== 0) {
    return { files, hashesMatch, results: null, allCards: null, logs: [],
      error: `operator verifier runner exited ${r.status}: ${(r.stderr || String(r.error || '')).trim().slice(0, 400)}` };
  }
  try {
    const out = JSON.parse(r.stdout) as { logs: string[]; allCards: string[]; results: Array<{ id: string; cards: string[] | null }> };
    const results = new Map<string, string[] | null>();
    for (const x of out.results) results.set(String(x.id), Array.isArray(x.cards) ? x.cards : null);
    return { files, hashesMatch, results, allCards: out.allCards, logs: out.logs, error: null };
  } catch (e) {
    return { files, hashesMatch, results: null, allCards: null, logs: [], error: `operator verifier output unreadable: ${(e as Error).message}` };
  }
}
