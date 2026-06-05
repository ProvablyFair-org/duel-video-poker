import type { HandRank } from './types';

/**
 * Independent 5-card poker hand evaluator for Jacks-or-Better video poker.
 *
 * Classifies any 5-card hand into one of the 10 rank categories used by
 * Duel.com's Video Poker pay table.
 *
 * Ranking (highest → lowest):
 *   royal_flush     — T-J-Q-K-A, all same suit
 *   straight_flush  — 5 consecutive ranks, same suit (but not royal)
 *   four_of_a_kind
 *   full_house
 *   flush           — 5 same suit, not straight
 *   straight        — 5 consecutive ranks, mixed suits. Ace can be low (A-2-3-4-5)
 *                     or high (T-J-Q-K-A).
 *   three_of_a_kind
 *   two_pair
 *   jacks_or_better — pair of Jacks, Queens, Kings, or Aces ONLY (not 2-10)
 *   none            — any hand below Jacks or Better (including low pairs)
 *
 * Card format: `${rank}${suit}` where:
 *   rank ∈ {'2','3','4','5','6','7','8','9','10','J','Q','K','A'}
 *   suit ∈ {'D','H','S','C'}
 *
 * Card encoding note: indices 0-51 in ALL_CARDS map to rank-major ordering
 * (2D, 2H, 2S, 2C, 3D, ...). The evaluator operates on the string form only;
 * it does not depend on the index encoding.
 */

/**
 * Rank → numeric value. Ace maps to 14 (high) by default; ace-low straights
 * are detected separately.
 */
const RANK_VALUE: Record<string, number> = {
  '2':  2,
  '3':  3,
  '4':  4,
  '5':  5,
  '6':  6,
  '7':  7,
  '8':  8,
  '9':  9,
  '10': 10,
  'J':  11,
  'Q':  12,
  'K':  13,
  'A':  14,
};

/** Parse "10D" → { rank: 10, suit: 'D' }. Note the 2-char rank for 10. */
export function parseCard(card: string): { rank: number; suit: string } {
  if (card.length < 2 || card.length > 3) {
    throw new Error(`Invalid card string: "${card}"`);
  }
  const suit = card[card.length - 1];
  const rankStr = card.slice(0, card.length - 1);
  const rank = RANK_VALUE[rankStr];
  if (rank === undefined) {
    throw new Error(`Invalid card rank in "${card}"`);
  }
  if (!'DHSC'.includes(suit)) {
    throw new Error(`Invalid card suit in "${card}"`);
  }
  return { rank, suit };
}

/**
 * Classify a 5-card hand. Throws if the hand is malformed (wrong size,
 * duplicates, invalid card strings).
 */
export function evaluateHand(cards: readonly string[]): HandRank {
  if (cards.length !== 5) {
    throw new Error(`Expected 5 cards, got ${cards.length}`);
  }

  const seen = new Set<string>();
  const ranks: number[] = [];
  const suits: string[] = [];
  for (const c of cards) {
    if (seen.has(c)) throw new Error(`Duplicate card in hand: ${c}`);
    seen.add(c);
    const p = parseCard(c);
    ranks.push(p.rank);
    suits.push(p.suit);
  }

  const rankCounts = countBy(ranks);
  const counts     = Object.values(rankCounts).sort((a, b) => b - a); // e.g. [4,1], [3,2], [3,1,1], [2,2,1], [2,1,1,1], [1,1,1,1,1]
  const isFlush    = suits.every(s => s === suits[0]);
  const sortedR    = [...ranks].sort((a, b) => a - b);
  const isStraightHigh = isSequential(sortedR);
  const isWheel        = isAceLowStraight(sortedR);
  const isStraight     = isStraightHigh || isWheel;

  // Royal flush = T-J-Q-K-A suited. Checked BEFORE straight flush.
  if (isFlush && isStraightHigh && sortedR[0] === 10 && sortedR[4] === 14) {
    return 'royal_flush';
  }

  if (isFlush && isStraight) {
    return 'straight_flush';
  }

  if (counts[0] === 4) return 'four_of_a_kind';
  if (counts[0] === 3 && counts[1] === 2) return 'full_house';
  if (isFlush)   return 'flush';
  if (isStraight) return 'straight';
  if (counts[0] === 3) return 'three_of_a_kind';
  if (counts[0] === 2 && counts[1] === 2) return 'two_pair';

  // Jacks or better: exactly one pair, and the paired rank must be J/Q/K/A (11-14).
  if (counts[0] === 2 && counts[1] === 1) {
    const pairedRank = Number(Object.entries(rankCounts).find(([, c]) => c === 2)![0]);
    if (pairedRank >= 11) return 'jacks_or_better';
  }

  return 'none';
}

/** Returns true iff the 5 sorted ranks form a consecutive run (2-3-4-5-6 through 10-J-Q-K-A). */
function isSequential(sortedRanks: readonly number[]): boolean {
  for (let i = 1; i < sortedRanks.length; i++) {
    if (sortedRanks[i] !== sortedRanks[i - 1] + 1) return false;
  }
  return true;
}

/** Detect A-2-3-4-5 ("wheel"). sortedRanks would be [2, 3, 4, 5, 14]. */
function isAceLowStraight(sortedRanks: readonly number[]): boolean {
  return (
    sortedRanks[0] === 2 &&
    sortedRanks[1] === 3 &&
    sortedRanks[2] === 4 &&
    sortedRanks[3] === 5 &&
    sortedRanks[4] === 14
  );
}

function countBy(values: readonly number[]): Record<number, number> {
  const m: Record<number, number> = {};
  for (const v of values) m[v] = (m[v] ?? 0) + 1;
  return m;
}
