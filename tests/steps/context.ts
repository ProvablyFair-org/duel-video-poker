import type { VideoPokerBet, SeedEntry, InfoItem } from '../../src/types';
import type { EpochGroup } from '../../src/loader';

export type { InfoItem };

export interface StepResult {
  step:   number;
  name:   string;
  /** INFO: an informational step's deviation (profile policy INFORMATIONAL — the live-sample fit, Mike
   *  2026-09-29): reported, never counted as a flag, never affects the verdict. */
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO';
  detail: string;
  /**
   * The step's measurements, as numbers.
   *
   * A MEASURED FLOAT MUST NEVER BE EMBEDDED IN `detail`. A string leaf cannot be
   * tolerance-compared: the reproduction gate in tests/verify.ts can only ask whether two
   * strings are identical, so a rate or an RTP printed into the sentence turns ordinary
   * last-place drift on another machine into a permanent, unfixable disagreement — and the
   * first thing a reader does with a diff that always fails is stop reading it.
   *
   * The split: `detail` states the BOUND the step tested against, which is a constant and
   * compares exactly. The measurement goes here, where the tolerance applies.
   */
  data?:  Record<string, unknown>;
  /**
   * 'capture' marks a FLAG raised by the AUDITOR'S capture (a retried request that left a nonce
   * gap), not by anything the operator served. It is disclosed on every run but is
   * verdict-neutral: the verdict stays Full Pass and the exit status 0. Only an operator-origin
   * FLAG downgrades to Conditional Pass. Same rule as Duel plinko (adopted 2026-09-22).
   */
  origin?: 'capture';
}

export interface VerifyContext {
  bets:       VideoPokerBet[];
  seeds:      SeedEntry[];
  seedMap:    Map<string, string>;   // serverSeedHashed → plaintext
  byHash:     Map<string, VideoPokerBet[]>;
  /** Epochs keyed by the capture TIMELINE (src/loader.ts groupByEpochWindow), one per seed record. */
  epochs:     EpochGroup[];
  /** Bets captured before any rotation record — no epoch can claim them. */
  orphanBets: VideoPokerBet[];
  phaseA:     VideoPokerBet[];
  phaseB:     VideoPokerBet[];
  phaseC:     VideoPokerBet[];
  phaseD:     VideoPokerBet[];
  phaseE:     VideoPokerBet[];
  outputsDir: string;
  /** The capture's own `meta.phaseBetCounts`, reconciled against src/loader.ts by step 13. */
  headerPhaseBetCounts: Record<string, number> | null;
  // Mutable accumulators
  step5Mismatches: number;
  step5Skipped:    number;
  chiResultsLog:   Record<string, unknown>[];
  /** Filled by step 11; written to outputs/payout-coverage.json and scored by the reproduction gate. */
  payoutCoverage:  Record<string, unknown> | null;
}

export function step(
  num:    number,
  name:   string,
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO',
  detail: string,
  data?:  Record<string, unknown>,
  origin?: 'capture',
): StepResult {
  const tag = status === 'PASS' ? '[PASS]' : status === 'INFO' ? '[INFO]' : status === 'FLAG' ? (origin === 'capture' ? '[FLAG:capture]' : '[FLAG]') : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  const r: StepResult = data === undefined
    ? { step: num, name, status, detail }
    : { step: num, name, status, detail, data };
  if (status === 'FLAG' && origin === 'capture') r.origin = 'capture';
  return r;
}
