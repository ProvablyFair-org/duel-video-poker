import { hmacSha256Hex, hexToBytes } from '../../lib/hmac-sha256';
import { evaluateHand } from './evaluator';
import { multiplierFor, HAND_LABELS } from './paytables';

/**
 * Video Poker RNG — port of Duel's HMAC-SHA256 backward-Fisher-Yates shuffle.
 *
 * Source of truth (audit repo):
 *   https://github.com/ProvablyFair-org/duel-video-poker/blob/main/src/rng.ts
 *
 * Verified bit-for-bit against the full 5,400-bet live audit dataset:
 * every initial hand, final hand, and multiplier reproduced exactly.
 *
 * Algorithm:
 *
 *   ALL_CARDS = ['2D','2H','2S','2C', ..., 'AD','AH','AS','AC']    // 52, rank-major
 *   deck = [...ALL_CARDS]
 *   for i from 51 downto 1:
 *     cursor  = 51 - i                            // 0, 1, ..., 50
 *     range   = i + 1
 *     maxFair = 0xFFFFFFFF - (0xFFFFFFFF % range) // bias-free ceiling
 *     hmac    = HMAC-SHA256(hexBytes(serverSeed), `${clientSeed}:${nonce}:${cursor}`)
 *     scan 4-byte chunks of hmac (up to 8):
 *       if chunk < maxFair → j = chunk % range; swap deck[i] ↔ deck[j]; break
 *     else throw                                   // NO cursor++ retry
 *
 *   initial_hand     = deck[0..4]
 *   replacement_pool = deck[5..9]
 *
 * Final hand: held cards stay at original positions; non-held positions
 * consume from replacement_pool sequentially, left-to-right.
 *
 * Hold semantics (verifier UX):
 *   heldCards === null         → "not yet decided" — show deal only
 *   heldCards === []           → "explicit hold-none" — Final Hand = full pool
 *   heldCards === [...]        → mixed — Final Hand interleaves held + pool
 */

const DECK_SIZE  = 52;
const HAND_SIZE  = 5;
const MAX_UINT32 = 0xFFFFFFFF;

const ALL_CARDS = [
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

/**
 * Compute the fully shuffled 52-card deck for a given seed pair.
 * Mirrors `computeShuffledDeck` from the audit repo's rng.ts.
 *
 * Throws if rejection sampling exhausts all 8 chunks at any step
 * (probability ≈ 10^-75 — has never been observed in 27M simulated rounds).
 */
function computeShuffledDeck(serverSeed, clientSeed, nonce) {
  const key = isHex(serverSeed) ? hexToBytes(serverSeed) : utf8Bytes(serverSeed);
  const deck = [...ALL_CARDS];
  let firstHmac = '';

  for (let i = DECK_SIZE - 1; i > 0; i--) {
    const range   = i + 1;
    const maxFair = MAX_UINT32 - (MAX_UINT32 % range);
    const cursor  = DECK_SIZE - 1 - i;

    const message = `${clientSeed}:${nonce}:${cursor}`;
    const hmac    = hmacSha256Hex(key, message);
    if (cursor === 0) firstHmac = hmac;

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

    // The published algorithm throws rather than incrementing cursor.
    // ~10^-75 probability — astronomically unlikely, but matches reference.
    if (!found) {
      throw new Error(`Fisher-Yates rejection exhausted at i=${i}, nonce=${nonce}`);
    }
  }

  return { deck, firstHmac };
}

/**
 * Apply the held-cards rule: held cards stay at their original positions,
 * non-held positions consume from the replacement pool sequentially.
 * Mirrors `computeFinalHand` from the audit repo.
 *
 * Exported so the Viz can re-evaluate locally on hold-toggle without
 * re-running the deck shuffle (the deck is identical for any given seed
 * pair regardless of hold choice).
 */
export function applyHolds(initialCards, heldCards, replacementPool) {
  const heldSet = new Set(heldCards || []);
  const final = [];
  let poolIdx = 0;

  for (let pos = 0; pos < HAND_SIZE; pos++) {
    const card = initialCards[pos];
    if (heldSet.has(card)) {
      final.push(card);
    } else {
      if (poolIdx >= replacementPool.length) {
        throw new Error(`Replacement pool exhausted at position ${pos}`);
      }
      final.push(replacementPool[poolIdx++]);
    }
  }

  return final;
}

/**
 * Look up the multiplier and label for a final 5-card hand.
 * Exported for Viz reuse.
 */
export function evaluateAndPay(finalHand) {
  const combination = evaluateHand(finalHand);
  const multiplier = multiplierFor(combination);
  return {
    combination,
    combinationLabel: HAND_LABELS[combination] || combination,
    multiplier,
    isWin: multiplier > 0,
  };
}

/**
 * Derive a Video Poker bet outcome.
 *
 * @param {Object} p
 * @param {string}            p.clientSeed
 * @param {string}            p.serverSeed   hex post-reveal, or any string for testing
 * @param {number}            p.nonce
 * @param {string[]|null}     [p.heldCards]  null (or undefined) = undecided;
 *                                            [] = explicit hold-none;
 *                                            [...] = mixed.
 *
 * @returns {{
 *   initialHand: string[],          // length 5 — the deal
 *   replacementPool: string[],      // length 5 — left-to-right fill into non-held positions
 *   heldCards: string[]|null,       // null = undecided, else echo intersected with initialHand
 *   finalHand: string[]|null,       // null only when heldCards is null (undecided)
 *   combination: string|null,
 *   combinationLabel: string|null,
 *   multiplier: number|null,        // 0 for losing final hand
 *   isWin: boolean,
 *   firstHmac: string,
 * }}
 */
export function deriveVideoPoker({ clientSeed, serverSeed, nonce, heldCards }) {
  const { deck, firstHmac } = computeShuffledDeck(serverSeed, clientSeed, nonce);
  const initialHand     = deck.slice(0, HAND_SIZE);
  const replacementPool = deck.slice(HAND_SIZE, HAND_SIZE * 2);

  // Undecided state: user hasn't chosen any hold action yet. Show the deal,
  // but suppress final hand + multiplier (we don't speculate).
  if (heldCards == null) {
    return {
      initialHand,
      replacementPool,
      heldCards: null,
      finalHand: null,
      combination: null,
      combinationLabel: null,
      multiplier: null,
      isWin: false,
      firstHmac,
    };
  }

  // Explicit decision: filter to cards actually in the dealt hand,
  // protecting against typos / pasted values.
  const dealtSet = new Set(initialHand);
  const heldFiltered = heldCards.filter(c => dealtSet.has(c));

  const finalHand = applyHolds(initialHand, heldFiltered, replacementPool);
  const evald = evaluateAndPay(finalHand);

  return {
    initialHand,
    replacementPool,
    heldCards: heldFiltered,
    finalHand,
    ...evald,
    firstHmac,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isHex(s) {
  return typeof s === 'string' && s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

function utf8Bytes(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}
