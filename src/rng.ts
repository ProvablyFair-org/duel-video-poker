import * as crypto from 'crypto';

/**
 * Video Poker RNG — Duel.com provably fair algorithm.
 *
 * Source: duel.com/fairness/verify (game selector → Video Poker)
 *
 * Algorithm: backward Fisher-Yates shuffle of a 52-card deck with rejection sampling.
 *
 *   ALL_CARDS = ['2D','2H','2S','2C','3D', ..., 'AD','AH','AS','AC']    // 52, rank-major
 *   deck = [...ALL_CARDS]
 *   for i from 51 downto 1:
 *     cursor  = 51 - i                                         // 0, 1, ..., 50
 *     range   = i + 1
 *     maxFair = 0xFFFFFFFF - (0xFFFFFFFF % range)              // bias-free ceiling
 *     hash    = HMAC-SHA256(key=hex_bytes(serverSeed), msg=`${clientSeed}:${nonce}:${cursor}`)
 *     scan 4-byte big-endian chunks (up to 8 per hash):
 *       if chunk < maxFair → j = chunk % range; swap deck[i] ↔ deck[j]; break
 *     else throw (NO cursor++ retry — differs from keno)
 *
 *   initial_hand     = deck[0..4]
 *   replacement_pool = deck[5..9]
 *
 * Key encoding: Buffer.from(serverSeed, 'hex') — hex-decoded bytes, NOT UTF-8 string.
 * Message format: `${clientSeed}:${nonce}:${cursor}` — colon-separated, no spaces.
 *
 * Card encoding (index 0-51, rank-major):
 *   rank = floor(index/4) + 2      (2, 3, ..., 10, 11=J, 12=Q, 13=K, 14=A)
 *   suit = index % 4                (0=D, 1=H, 2=S, 3=C)
 *
 * Draw replacement logic (verified live):
 *   - Non-held positions consume from deck[5..9] sequentially, left to right
 *   - Held cards stay at their original positions
 *   - The entire outcome is determined at deal time — no re-shuffle after holds
 */

export const ALL_CARDS: readonly string[] = [
  '2D',  '2H',  '2S',  '2C',
  '3D',  '3H',  '3S',  '3C',
  '4D',  '4H',  '4S',  '4C',
  '5D',  '5H',  '5S',  '5C',
  '6D',  '6H',  '6S',  '6C',
  '7D',  '7H',  '7S',  '7C',
  '8D',  '8H',  '8S',  '8C',
  '9D',  '9H',  '9S',  '9C',
  '10D', '10H', '10S', '10C',
  'JD',  'JH',  'JS',  'JC',
  'QD',  'QH',  'QS',  'QC',
  'KD',  'KH',  'KS',  'KC',
  'AD',  'AH',  'AS',  'AC',
];

export const DECK_SIZE  = 52;
export const HAND_SIZE  = 5;
export const MAX_UINT32 = 0xFFFFFFFF;

/**
 * Computes the fully shuffled 52-card deck for a given (serverSeed, clientSeed, nonce).
 * Pre-allocates the HMAC key buffer variant for use in hot simulation loops.
 */
export function computeShuffledDeckFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
): string[] {
  const deck: string[] = [...ALL_CARDS];

  for (let i = DECK_SIZE - 1; i > 0; i--) {
    const range   = i + 1;
    const maxFair = MAX_UINT32 - (MAX_UINT32 % range);
    const cursor  = DECK_SIZE - 1 - i;

    const message = `${clientSeed}:${nonce}:${cursor}`;
    const hmac    = crypto.createHmac('sha256', keyBuffer).update(message).digest('hex');

    let found = false;
    for (let off = 0; off + 8 <= hmac.length; off += 8) {
      const value = parseInt(hmac.substring(off, off + 8), 16);
      if (value < maxFair) {
        const j = value % range;
        [deck[i], deck[j]] = [deck[j], deck[i]];
        found = true;
        break;
      }
    }

    if (!found) {
      // All 8 chunks >= maxFair. Probability ≈ (4 / 2^32)^8 ≈ 10^-75 — astronomically unlikely.
      // The published algorithm throws rather than incrementing cursor.
      throw new Error(`Fisher-Yates rejection exhausted at i=${i}, nonce=${nonce}`);
    }
  }

  return deck;
}

/**
 * String-key convenience wrapper. Allocates a Buffer per call — slower in loops.
 */
export function computeShuffledDeck(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): string[] {
  const key = Buffer.from(serverSeed, 'hex');
  return computeShuffledDeckFromBuffer(key, clientSeed, nonce);
}

/**
 * Returns the initial 5-card hand dealt to the player.
 */
export function dealInitialHand(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): string[] {
  return computeShuffledDeck(serverSeed, clientSeed, nonce).slice(0, HAND_SIZE);
}

/**
 * Returns the 5 replacement cards (deck positions 5..9) — the pool from which
 * discarded positions are filled in order.
 */
export function getReplacementPool(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): string[] {
  return computeShuffledDeck(serverSeed, clientSeed, nonce).slice(HAND_SIZE, HAND_SIZE * 2);
}

/**
 * Given initial hand + held_cards, produce the final 5-card hand exactly as the server does.
 * Held cards remain in their original positions; non-held positions consume from the pool
 * sequentially, left-to-right.
 */
export function computeFinalHand(
  initialCards: readonly string[],
  heldCards: readonly string[],
  replacementPool: readonly string[],
): string[] {
  const heldSet = new Set(heldCards);
  const final: string[] = [];
  let poolIdx = 0;

  for (let pos = 0; pos < HAND_SIZE; pos++) {
    const card = initialCards[pos];
    if (heldSet.has(card)) {
      final.push(card);
    } else {
      if (poolIdx >= replacementPool.length) {
        throw new Error(`Pool exhausted at position ${pos}`);
      }
      final.push(replacementPool[poolIdx++]);
    }
  }

  return final;
}

/**
 * SHA-256 commit-reveal check: verifies that SHA-256(hex_bytes(serverSeed)) === serverSeedHashed.
 */
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean {
  const seedBytes = Buffer.from(serverSeed, 'hex');
  const computed  = crypto.createHash('sha256').update(seedBytes).digest('hex');
  return computed === serverSeedHashed;
}

/**
 * Full-flow recomputation convenience — used by verify.ts Step 5.
 * Returns { initialHand, replacementPool, finalHand } from seeds + held_cards.
 */
export function recomputeRound(
  serverSeed: string,
  clientSeed: string,
  nonce:      number,
  heldCards:  readonly string[],
): { initialHand: string[]; replacementPool: string[]; finalHand: string[] } {
  const deck            = computeShuffledDeck(serverSeed, clientSeed, nonce);
  const initialHand     = deck.slice(0, HAND_SIZE);
  const replacementPool = deck.slice(HAND_SIZE, HAND_SIZE * 2);
  const finalHand       = computeFinalHand(initialHand, heldCards, replacementPool);
  return { initialHand, replacementPool, finalHand };
}
