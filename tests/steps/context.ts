import type { VideoPokerBet, SeedEntry, InfoItem } from '../../src/types';

export type { InfoItem };

export interface StepResult {
  step:   number;
  name:   string;
  status: 'PASS' | 'FLAG' | 'FAIL';
  detail: string;
}

export interface VerifyContext {
  bets:       VideoPokerBet[];
  seeds:      SeedEntry[];
  seedMap:    Map<string, string>;   // serverSeedHashed → plaintext
  byHash:     Map<string, VideoPokerBet[]>;
  phaseA:     VideoPokerBet[];
  phaseB:     VideoPokerBet[];
  phaseC:     VideoPokerBet[];
  phaseD:     VideoPokerBet[];
  phaseE:     VideoPokerBet[];
  outputsDir: string;
  // Mutable accumulators
  step5Mismatches: number;
  step5Skipped:    number;
  chiResultsLog:   Record<string, unknown>[];
}

export function step(
  num:    number,
  name:   string,
  status: 'PASS' | 'FLAG' | 'FAIL',
  detail: string,
): StepResult {
  const tag = status === 'PASS' ? '[PASS]' : status === 'FLAG' ? '[FLAG]' : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  return { step: num, name, status, detail };
}
