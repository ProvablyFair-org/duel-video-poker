export type HandRank =
  | 'royal_flush'
  | 'straight_flush'
  | 'four_of_a_kind'
  | 'full_house'
  | 'flush'
  | 'straight'
  | 'three_of_a_kind'
  | 'two_pair'
  | 'jacks_or_better'
  | 'none';

export const HAND_RANKS: readonly HandRank[] = [
  'royal_flush',
  'straight_flush',
  'four_of_a_kind',
  'full_house',
  'flush',
  'straight',
  'three_of_a_kind',
  'two_pair',
  'jacks_or_better',
  'none',
];

export interface VideoPokerConfig {
  source: string;
  captured_at: string;
  variant: string;
  multipliers: Record<HandRank, number>;
  notes: string[];
}

export interface SeedEntry {
  at: string;
  context: string;
  phase: string;
  seed: {
    clientSeed: string;
    serverSeedHashed: string;
    nextServerSeedHash: string;
    serverSeed: string | null;
  };
  nonce: number;
  revealedFrom?: { transactionId: number };
}

/** Deal-phase request (POST /api/v2/video-poker). */
export interface DealRequest {
  amount_coins: string;     // e.g. "0.010000"
  amount_currency: string;  // 18-dec precision, e.g. "0.009998300288950800"
  currency: number;         // 105 = USDT
}

/** Deal-phase response (after POST /api/v2/video-poker). */
export interface DealResponse {
  hand_id: number;
  status: number;           // 0 = dealt, awaiting draw
  amount_coins: string;
  amount_currency: string;
  balance_type?: number;
  initial_cards: string[] | null;  // 5 card strings (null for post-capture seed-reveal bets)
  transaction_id: number;
  effective_edge: number;   // 0.1 during deal phase
  potential_payouts?: Record<HandRank, string>;
}

/** Draw-phase request (POST /api/v2/video-poker/{handId}/draw). */
export interface DrawRequest {
  held_cards: string[];     // subset of initial_cards (as card strings)
}

/** Draw-phase response. */
export interface DrawResponse {
  hand_id: number;
  status: number;           // 3 = completed
  initial_cards: string[] | null;
  held_cards: string[];
  final_cards: string[] | null;
  combination: HandRank;
  multiplier: string;       // "0" or decimal string e.g. "9.000000000000000000"
  amount_won: string;       // decimal string
  transaction_id: number;
  effective_edge: number;
}

/** Zero-Edge rakeback transaction (separate from the bet transaction). */
export interface ZeroEdgeRakeback {
  id: number;
  bet_id: number;
  amount_coins: string;
  amount_currency: string;
  created_at: string;
}

export interface BetSeed {
  serverSeedHashed: string;
  clientSeed: string;
  nonce: number;
}

/**
 * Canonical per-round record. Video Poker is a two-step game: every round has a deal
 * and a draw. We store both, plus the revealed seed data (post-rotation) and the
 * rakeback transaction.
 */
export interface VideoPokerBet {
  at: string;
  phase: 'A' | 'B' | 'C' | 'D' | 'E' | 'post-capture';
  deal: {
    request:  DealRequest;
    response: DealResponse;
  };
  draw: {
    request:  DrawRequest;
    response: DrawResponse;
  };
  rakeback?: ZeroEdgeRakeback | null;
  seed: BetSeed;
  _reconstructed?: boolean;
}

export interface VideoPokerDataset {
  meta: {
    captureWindow: { start: string; end: string };
    totalBets: number;
    phaseCounts: Record<string, number>;
    platform: string;
    game: string;
    version: string;
    [k: string]: unknown;
  };
  seeds: SeedEntry[];
  bets: VideoPokerBet[];
}

export type Severity = 'HARD_FAIL' | 'FLAG' | 'INFO' | 'PASS';

export interface StepResult {
  step: number;
  name: string;
  ecRefs: string[];
  severity: Severity;
  pass: boolean;
  summary: string;
  failures: string[];
  details?: Record<string, unknown>;
}

export interface InfoItem {
  label: string;
  detail: string;
}
