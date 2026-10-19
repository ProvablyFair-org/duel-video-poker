/**
 * Duel.com Video Poker — VALUE DOMAINS for every numeric leaf of the committed JSON artifacts of record
 * (`outputs/simulation-results.json`, `outputs/optimal-play-rtp.json`) and of the verifier's committed
 * products (`outputs/chi-squared-results.json`, `outputs/determinism-log.json`, `outputs/payout-coverage.json`).
 * Profile VP-27.
 *
 * Ported from the Duel Crash package's src/domains.ts (itself from Duel Dice), 2026-09-26.
 *
 * The SHA-256 pin (Step 28) proves the bytes have not moved since they were pinned; it cannot tell a
 * genuine figure from a physically impossible one that a forger wrote and re-pinned. Step 28 therefore
 * also validates every numeric leaf against a domain declared here, in BOTH directions: every leaf
 * satisfies its domain, and every leaf path is covered by a rule (a new, undeclared numeric field
 * fails). Every bound comes from src/ (src/loader.ts, the pinned videoPokerConfig.json the pre-flight
 * hash-checks, src/rng.ts), NEVER from the artifact being checked. The domains encode physical
 * possibility, not plausibility: nothing here rejects a value for being surprising.
 *
 * NOT COVERED: outputs/verification-results.json — the verifier's run record, compared field by field
 * with every run at the reproduction tolerance (tests/verify.ts), as in the Duel Crash package.
 */

import {
  EXPECTED_BETS, EPOCH_SIZE_CAP, EXPECTED_REVEALED_EPOCHS, C52_5, CANONICAL_CLASSES,
  SIM_PASS1_STREAMS, SIM_PASS1_ROUNDS_PER_STREAM, SIM_PASS2_NONCES_PER_SEED, SIM_CARD_CENSUS_POSITIONS,
} from './loader';
import { HAND_RANKS, type HandRank } from './types';
import videoPokerConfig from '../videoPokerConfig.json';
import { HAND_SIZE as HAND_CARDS } from './rng';

const MULTIPLIERS = videoPokerConfig.multipliers as Record<HandRank, number>;
const MAX_MULT = Math.max(...HAND_RANKS.map(r => MULTIPLIERS[r]));
const RANKS = HAND_RANKS.length;
const P1_TOTAL = SIM_PASS1_STREAMS * SIM_PASS1_ROUNDS_PER_STREAM;
const P2_TOTAL = EXPECTED_REVEALED_EPOCHS * SIM_PASS2_NONCES_PER_SEED;
const WINDOWS = SIM_PASS2_NONCES_PER_SEED / EPOCH_SIZE_CAP;
const RANK_ALT = HAND_RANKS.join('|');

export interface Domain {
  readonly label: string;
  readonly ok: (v: number) => boolean;
}

const D = (label: string, ok: (v: number) => boolean): Domain => ({ label, ok });

export const FINITE = D('a finite number', v => Number.isFinite(v));
export const NONNEG_REAL = D('a non-negative real', v => Number.isFinite(v) && v >= 0);
export const POSITIVE_INT = D('a positive integer', v => Number.isInteger(v) && v >= 1);
export const PROBABILITY = D('a probability in [0,1]', v => Number.isFinite(v) && v >= 0 && v <= 1);
export const CORRELATION = D('a correlation in [-1,1]', v => Number.isFinite(v) && v >= -1 && v <= 1);
export const CHI_SQUARED = D('a non-negative chi-squared statistic', v => Number.isFinite(v) && v >= 0);

export const exactly = (target: number, what: string): Domain =>
  D(`exactly ${target} (${what})`, v => v === target);
export const intAtMost = (max: number, what: string): Domain =>
  D(`an integer in [0, ${max}] (${what})`, v => Number.isInteger(v) && v >= 0 && v <= max);
export const intBetween = (lo: number, hi: number, what: string): Domain =>
  D(`an integer in [${lo}, ${hi}] (${what})`, v => Number.isInteger(v) && v >= lo && v <= hi);
export const realBetween = (lo: number, hi: number, what: string): Domain =>
  D(`a real in [${lo}, ${hi}] (${what})`, v => Number.isFinite(v) && v >= lo && v <= hi);

/** A per-hand average payout lies in [0, the largest multiplier of the pinned pay table]. */
const RETURN = realBetween(0, MAX_MULT, 'an attainable average payout per hand');
/** Chi-squared degrees of freedom over the hand ranks, after pooling. */
const RANK_DF = intBetween(1, RANKS - 1, 'hand-rank bins − 1 after pooling');

export interface Rule {
  /** Matches a COLLAPSED leaf path: array indices are rendered as `[]`. */
  readonly path: RegExp;
  readonly domain: Domain;
}

/** Collapse `a.b[3].c` to `a.b[].c` so one rule covers every element of a list. */
export function collapsePath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

const R = (re: string, domain: Domain): Rule => ({ path: new RegExp(`^${re}$`), domain });

/** Every numeric leaf of each committed JSON artifact, with the domain it physically admits. First match wins. */
export function domainRules(): Record<string, Rule[]> {
  return {
    'simulation-results.json': [
      R('\\.pass1\\.totalRounds', exactly(P1_TOTAL, 'SIM_PASS1_STREAMS × SIM_PASS1_ROUNDS_PER_STREAM')),
      R('\\.pass1\\.streams', exactly(SIM_PASS1_STREAMS, 'SIM_PASS1_STREAMS')),
      R('\\.pass1\\.roundsPerStream', exactly(SIM_PASS1_ROUNDS_PER_STREAM, 'SIM_PASS1_ROUNDS_PER_STREAM')),
      R('\\.pass1\\.streamResults\\[\\]\\.stream', intBetween(0, SIM_PASS1_STREAMS - 1, 'a stream index')),
      R('\\.pass1\\.streamResults\\[\\]\\.chi2', CHI_SQUARED),
      R('\\.pass1\\.streamResults\\[\\]\\.df', RANK_DF),
      R('\\.pass1\\.streamResults\\[\\]\\.pValue', PROBABILITY),
      R('\\.pass1\\.streamResults\\[\\]\\.rtp', RETURN),
      R(`\\.pass1\\.streamResults\\[\\]\\.observed\\.(${RANK_ALT})`, intAtMost(SIM_PASS1_ROUNDS_PER_STREAM, 'hands in one stream')),
      R('\\.pass1\\.fisherCombined\\.statistic', CHI_SQUARED),
      R('\\.pass1\\.fisherCombined\\.df', exactly(2 * SIM_PASS1_STREAMS, '2 × streams')),
      R('\\.pass1\\.fisherCombined\\.pValue', PROBABILITY),
      R('\\.pass1\\.serialIndependenceFails', intBetween(0, 1, 'the serial rule fails or not')),
      R('\\.pass1\\.lag1Autocorrelation', CORRELATION),
      R('\\.pass1\\.runsTest\\.runs', intBetween(1, P1_TOTAL, 'runs in the sequence')),
      R('\\.pass1\\.runsTest\\.expected', realBetween(1, P1_TOTAL, 'expected runs')),
      R('\\.pass1\\.runsTest\\.z', FINITE),
      R('\\.pass1\\.runsTest\\.pValue', PROBABILITY),
      R('\\.pass1\\.(empiricalRTP|theoreticalRTP)', RETURN),
      R('\\.pass1\\.rtpDeviation', realBetween(-1, MAX_MULT, 'a relative deviation of a non-negative return')),
      R('\\.pass1\\.rtpSnapshots\\[\\]\\.rounds', intBetween(1, P1_TOTAL, 'a cumulative round mark')),
      R('\\.pass1\\.rtpSnapshots\\[\\]\\.rtp', RETURN),
      R(`\\.pass1\\.observedCounts\\.(${RANK_ALT})`, intAtMost(P1_TOTAL, 'Pass 1 hands')),
      R(`\\.pass1\\.expectedCounts\\.(${RANK_ALT})`, realBetween(0, P1_TOTAL, 'expected Pass 1 hands')),
      R('\\.pass1\\.serialCensus\\.n', exactly(P1_TOTAL, 'the Pass 1 sequence length')),
      R('\\.pass1\\.serialCensus\\.(first|last)', intBetween(0, RANKS - 1, 'a hand-rank index')),
      R('\\.pass1\\.serialCensus\\.transitions\\[\\]\\[\\]', intAtMost(P1_TOTAL - 1, 'adjacent pairs in the sequence')),
      R('\\.pass1\\.cardCensus\\.positions', exactly(SIM_CARD_CENSUS_POSITIONS, 'SIM_CARD_CENSUS_POSITIONS')),
      R('\\.pass1\\.cardCensus\\.counts\\[\\]\\[\\]', intAtMost(P1_TOTAL, 'deals')),
      R('\\.pass2\\.totalSeeds', exactly(EXPECTED_REVEALED_EPOCHS, 'EXPECTED_REVEALED_EPOCHS')),
      R('\\.pass2\\.totalRounds', exactly(P2_TOTAL, 'EXPECTED_REVEALED_EPOCHS × SIM_PASS2_NONCES_PER_SEED')),
      R('\\.pass2\\.perSeed\\[\\]\\.nonces', exactly(SIM_PASS2_NONCES_PER_SEED, 'SIM_PASS2_NONCES_PER_SEED')),
      R(`\\.pass2\\.perSeed\\[\\]\\.observedCounts\\.(${RANK_ALT})`, intAtMost(SIM_PASS2_NONCES_PER_SEED, 'hands of one seed')),
      R(`\\.pass2\\.perSeed\\[\\]\\.earlyWindowCounts\\.(${RANK_ALT})`, intAtMost(EPOCH_SIZE_CAP, 'hands of the captured window')),
      R(`\\.pass2\\.perSeed\\[\\]\\.extendedWindowCounts\\.(${RANK_ALT})`, intAtMost(SIM_PASS2_NONCES_PER_SEED - EPOCH_SIZE_CAP, 'hands after the captured window')),
      R('\\.pass2\\.perSeed\\[\\]\\.(earlyWindowRTP|extendedWindowRTP)', RETURN),
      R('\\.pass2\\.perSeed\\[\\]\\.earlyChiSquared\\.chi2', CHI_SQUARED),
      R('\\.pass2\\.perSeed\\[\\]\\.earlyChiSquared\\.df', RANK_DF),
      R('\\.pass2\\.perSeed\\[\\]\\.(earlyChiSquared\\.pValue|windowDifferenceBinomial)', PROBABILITY),
      R('\\.pass2\\.perSeed\\[\\]\\.windowRoyals\\[\\]', intBetween(0, WINDOWS - 1, 'a window index')),
      R(`\\.pass2\\.aggregatedCounts\\.(${RANK_ALT})`, intAtMost(P2_TOTAL, 'Pass 2 hands')),
      R('\\.pass2\\.aggregatedRTP', RETURN),
      R('\\.pass2\\.aggregatedChiSquared\\.chi2', CHI_SQUARED),
      R('\\.pass2\\.aggregatedChiSquared\\.df', RANK_DF),
      R('\\.pass2\\.aggregatedChiSquared\\.pValue', PROBABILITY),
      R('\\.pass2\\.flaggedSeeds', intAtMost(EXPECTED_REVEALED_EPOCHS, 'a count of seeds')),
      R('\\.pass2\\.cherryPickBinomial', PROBABILITY),
    ],
    'optimal-play-rtp.json': [
      R('\\.totalHands', exactly(C52_5, 'C52_5')),
      R(`\\.crossValidation\\.payTable\\.(${RANK_ALT})`, NONNEG_REAL),
      R('\\.crossValidation\\.rtp', realBetween(0, 800, 'an attainable return under the 9/6 reference table (largest multiplier 800)')),
      R('\\.crossValidation\\.target', PROBABILITY),
      R('\\.crossValidation\\.tolerance', NONNEG_REAL),
      R('\\.(crossValidation|duel)\\.canonicalClasses', exactly(CANONICAL_CLASSES, 'CANONICAL_CLASSES')),
      ...HAND_RANKS.map(r => R(`\\.duel\\.payTable\\.${r}`, exactly(MULTIPLIERS[r], `videoPokerConfig.json ${r}`))),
      R('\\.duel\\.rtp', RETURN),
      R('\\.duel\\.classSummary\\.totalClasses', exactly(CANONICAL_CLASSES, 'CANONICAL_CLASSES')),
      R('\\.duel\\.classSummary\\.holdDistribution\\.[0-5]', intAtMost(C52_5, 'deals')),
      R('\\.duel\\.topClasses\\[\\]\\.count', intBetween(1, C52_5, 'deals in a class')),
      R('\\.duel\\.topClasses\\[\\]\\.optimalEV', RETURN),
      R('\\.duel\\.topClasses\\[\\]\\.optimalHoldCount', intBetween(0, 5, 'cards held')),
    ],
    'chi-squared-results.json': [
      // Steps 23–24 tally the rank and the suit of every initial card: 5 cards per captured bet.
      R('\\.groups\\[\\]\\.observed\\[\\]', intAtMost(EXPECTED_BETS * HAND_CARDS, 'initial cards of the captured bets')),
      R('\\.groups\\[\\]\\.expected\\[\\]', realBetween(0, EXPECTED_BETS * HAND_CARDS, 'expected initial cards')),
      R('\\.groups\\[\\]\\.chi2', CHI_SQUARED),
      R('\\.groups\\[\\]\\.df', POSITIVE_INT),
      R('\\.groups\\[\\]\\.pValue', PROBABILITY),
    ],
    'determinism-log.json': [
      R('\\.(verified|mismatches|skipped)', intAtMost(EXPECTED_BETS, 'captured bets')),
    ],
    'payout-coverage.json': [
      R('\\.handRanks', exactly(RANKS, 'HAND_RANKS')),
      R('\\.(multipliersPresent|ranksExercisedByLivePlay|ranksNeverExercised)', intAtMost(RANKS, 'hand ranks')),
      R('\\.betsObserved', exactly(EXPECTED_BETS, 'EXPECTED_BETS')),
      R(`\\.observedRankCounts\\.(${RANK_ALT})`, intAtMost(EXPECTED_BETS, 'captured bets')),
      R('\\.uncoveredDealStageRtpShare', PROBABILITY),
      R('\\.uncoveredCells\\[\\]\\.multiplier', realBetween(0, MAX_MULT, 'a pay-table multiplier')),
      R('\\.uncoveredCells\\[\\]\\.dealStageCombinations', intAtMost(C52_5, 'deals')),
      R('\\.uncoveredCells\\[\\]\\.dealStageProbability', PROBABILITY),
      R('\\.uncoveredCells\\[\\]\\.dealStageRtpContribution', RETURN),
    ],
  };
}

export interface DomainViolation { path: string; value: number; expected: string }

/** Collect every numeric leaf of `doc` as `[collapsedPath, value]`. */
export function numericLeaves(doc: unknown, path = '', out: [string, number][] = []): [string, number][] {
  if (typeof doc === 'number') { out.push([collapsePath(path), doc]); return out; }
  if (doc === null || typeof doc !== 'object') return out;
  if (Array.isArray(doc)) { doc.forEach((v, i) => numericLeaves(v, `${path}[${i}]`, out)); return out; }
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) numericLeaves(v, `${path}.${k}`, out);
  return out;
}

/**
 * Validate every numeric leaf of `doc` against `rules`. A leaf matched by NO rule is a violation in its
 * own right (`uncovered`): an unbounded new field is how this class reopens.
 */
export function validateDomains(doc: unknown, rules: Rule[]): { violations: DomainViolation[]; uncovered: string[]; checked: number } {
  const violations: DomainViolation[] = [];
  const uncovered: string[] = [];
  const leaves = numericLeaves(doc);
  for (const [p, v] of leaves) {
    const rule = rules.find(r => r.path.test(p));
    if (!rule) { if (!uncovered.includes(p)) uncovered.push(p); continue; }
    if (!rule.domain.ok(v)) violations.push({ path: p, value: v, expected: rule.domain.label });
  }
  return { violations, uncovered, checked: leaves.length };
}

/** One-line summaries for a step's detail string. */
export function describeDomainFailures(artifact: string, r: { violations: DomainViolation[]; uncovered: string[] }): string[] {
  const out: string[] = [];
  for (const v of r.violations.slice(0, 4)) out.push(`${artifact}${v.path} = ${v.value} is not ${v.expected}`);
  if (r.violations.length > 4) out.push(`${artifact}: +${r.violations.length - 4} more impossible value(s)`);
  for (const p of r.uncovered.slice(0, 4)) out.push(`${artifact}${p} has no declared value domain (add one in src/domains.ts)`);
  if (r.uncovered.length > 4) out.push(`${artifact}: +${r.uncovered.length - 4} more undeclared field(s)`);
  return out;
}
