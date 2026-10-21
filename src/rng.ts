/**
 * PROVENANCE (header added on integration, 20 Oct 2026; everything below this comment is the
 * clean-room module byte for byte).
 *
 * This module was REBUILT FROM A WRITTEN SPECIFICATION, not ported from Duel's code:
 *   spec      docs/ALGORITHM.md, a copy of games/video-poker/ALGORITHM.md in the ProvablyFair.org
 *             audit framework (pf-audit, branch clean-room-spec-2026-10-20; SHA-256 fe9cde76…).
 *             Written from Duel's public pages, the standard provably-fair construction and the
 *             5,400 live hands, without opening Duel's code (its §8 lists every file read).
 *   rebuild   written by an implementer who read ONLY that spec and a module-interface file, and
 *             never opened Duel's code, its Verify-tab file, or this package's earlier src/rng.ts.
 *   self-test tests/videoPoker/RngSpecTests.ts (the spec's §5 vectors and properties).
 *
 * Duel's published Verify-tab code (evidence/verify-tab/duel-verify-tab-video-poker-2026-04-23.captured.json,
 * E19) is NOT the source of this module. It is run byte for byte as a SECOND CHECK, by Step 5 and the
 * unit tests (src/operator-verifier.ts), next to the ProvablyFair.org docs-site verifier.
 *
 * Three-way agreement measured on integration (20 Oct 2026, the 5,400-hand capture): this module vs
 * the live hands, commitment / dealt hand / final hand 5,400/5,400; vs Duel's Verify-tab code
 * 5,400/5,400 decks (dealt hand + replacement cards); vs the pinned ProvablyFair.org docs-site
 * verifier 5,400/5,400 dealt hands, replacement cards and final hands. `npm run verify` re-runs these
 * comparisons on every run (Step 1 the commitments, Step 5 the hands, Duel's code and the site verifier).
 *
 * Rejected draws (spec O1, open). This module rejects v >= floor(2^32 / N) * N and moves to the next
 * counter value. Duel's Verify-tab code, run as the second check, uses the ceiling
 * 0xFFFFFFFF - (0xFFFFFFFF mod N) (equal to the spec's except when N is a power of two, where it also
 * rejects the top N values) and on a rejection reads the next 4 bytes of the same digest. The two agree
 * whenever neither rejects. In the 5,400 captured hands neither ceiling rejected any of the 275,400
 * draws (measured 20 Oct 2026), so the capture cannot tell the two continuations apart.
 */
// Clean-room implementation of the Duel Video Poker deal/draw derivation,
// written from ALGORITHM.md and INTERFACE.md only.
// Hand ranking and payout (ALGORITHM.md §3) are deliberately not here:
// INTERFACE.md says the package has its own evaluator.

import { createHash, createHmac } from 'crypto';

// §2 Step 1: ranks low to high, suits in the order D, H, S, C.
const RANKS: readonly string[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS: readonly string[] = ['D', 'H', 'S', 'C'];

// §2 Step 1: rank-major deck, so index 0 is 2D, index 1 is 2H, ..., index 51 is AC.
export const ALL_CARDS: readonly string[] = Object.freeze(
  RANKS.flatMap((rank) => SUITS.map((suit) => rank + suit)),
);

export const DECK_SIZE: number = 52;
export const HAND_SIZE: number = 5;
export const MAX_UINT32: number = 0xffffffff;

// Optional counter (INTERFACE.md): chunksRead counts every 4-byte value read,
// swaps counts every accepted value used for a swap.
export interface RejectionCensus {
  chunksRead: number;
  swaps: number;
}

const TWO_POW_32 = 0x100000000;

// §2 Step 2: LIMIT = floor(2^32 / N) * N. A value v >= LIMIT is rejected.
// For N = 2 this is 2^32 itself, i.e. no 32-bit value is ever rejected.
export function maxFairFor(range: number): number {
  if (!Number.isInteger(range) || range < 1 || range > TWO_POW_32) {
    throw new RangeError(`range must be an integer in 1..2^32, got ${range}`);
  }
  return Math.floor(TWO_POW_32 / range) * range;
}

// §1.1: the server seed is 64 hex characters (32 bytes). The spec writes it in
// lowercase; uppercase hex is accepted here because it decodes to the same bytes.
function decodeServerSeed(serverSeed: string): Buffer {
  if (typeof serverSeed !== 'string' || !/^[0-9a-fA-F]{64}$/.test(serverSeed)) {
    throw new TypeError('serverSeed must be 64 hexadecimal characters');
  }
  return Buffer.from(serverSeed, 'hex');
}

// §1.1: nonce is a non-negative integer; §2 Step 2 prints it in plain base 10.
function checkNonce(nonce: number): void {
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new RangeError(`nonce must be a non-negative safe integer, got ${nonce}`);
  }
}

// §2 Step 2: one uniform integer in [0, range), advancing the shared counter.
// message = clientSeed ":" nonce ":" k, UTF-8 (O6); digest = HMAC-SHA256(key, message);
// v = first 4 digest bytes as a big-endian unsigned 32-bit integer; the other 28 are unused.
// If v >= LIMIT the draw is rejected and the next counter value is tried (O1).
function drawInt(
  key: Buffer,
  clientSeed: string,
  nonce: number,
  range: number,
  counter: { k: number },
  census?: RejectionCensus,
): number {
  const limit = maxFairFor(range);
  for (;;) {
    const message = `${clientSeed}:${nonce}:${counter.k}`;
    const digest = createHmac('sha256', key).update(message, 'utf8').digest();
    counter.k += 1; // every value read consumes one counter step, accepted or not
    const v = digest.readUInt32BE(0);
    if (census) census.chunksRead += 1;
    if (v >= limit) continue; // rejected (§2 Step 2, O1): move on to k + 1
    return v % range;
  }
}

// §2 Steps 1-3: start from the rank-major deck and run a backward Fisher-Yates
// shuffle. For i = 51 down to 1, j is drawn over N = i + 1 outcomes and a[i], a[j]
// are swapped. The counter k starts at 0 for the first swap (i = 51).
export function computeShuffledDeckFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  census?: RejectionCensus,
): string[] {
  if (!Buffer.isBuffer(keyBuffer)) throw new TypeError('keyBuffer must be a Buffer');
  if (typeof clientSeed !== 'string') throw new TypeError('clientSeed must be a string');
  checkNonce(nonce);

  const a = ALL_CARDS.slice();
  const counter = { k: 0 };
  for (let i = DECK_SIZE - 1; i >= 1; i--) {
    const j = drawInt(keyBuffer, clientSeed, nonce, i + 1, counter, census);
    const tmp = a[i] as string;
    a[i] = a[j] as string;
    a[j] = tmp;
    if (census) census.swaps += 1;
  }
  return a;
}

// §2 Step 2: the HMAC key is the 32 bytes the server-seed hex encodes, not the ASCII text.
export function computeShuffledDeck(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  census?: RejectionCensus,
): string[] {
  return computeShuffledDeckFromBuffer(decodeServerSeed(serverSeed), clientSeed, nonce, census);
}

// §2 Step 4: the deal is the first five cards of the shuffled deck, a[0..4], left to right.
export function dealInitialHand(serverSeed: string, clientSeed: string, nonce: number): string[] {
  return computeShuffledDeck(serverSeed, clientSeed, nonce).slice(0, HAND_SIZE);
}

// §2 Step 5: the replacements are the next five cards, a[5..9], in deck order.
export function getReplacementPool(serverSeed: string, clientSeed: string, nonce: number): string[] {
  return computeShuffledDeck(serverSeed, clientSeed, nonce).slice(HAND_SIZE, 2 * HAND_SIZE);
}

// §2 Step 5: walk hand positions left to right; a held card stays where it is,
// each non-held position takes the next unused replacement in pool order.
// O7: holds are matched by card string. A held card that is not in the hand, or a
// card held twice, is not covered by the spec and is rejected with an error here.
export function computeFinalHand(
  initialCards: readonly string[],
  heldCards: readonly string[],
  replacementPool: readonly string[],
): string[] {
  if (initialCards.length !== HAND_SIZE) {
    throw new RangeError(`initialCards must have ${HAND_SIZE} cards`);
  }
  const held = new Set<string>();
  for (const card of heldCards) {
    if (!initialCards.includes(card)) throw new Error(`held card ${card} is not in the initial hand`);
    if (held.has(card)) throw new Error(`held card ${card} listed twice`);
    held.add(card);
  }
  const needed = HAND_SIZE - held.size;
  if (replacementPool.length < needed) {
    throw new RangeError(`replacement pool has ${replacementPool.length} cards, ${needed} needed`);
  }
  const final: string[] = [];
  let t = 0;
  for (let p = 0; p < HAND_SIZE; p++) {
    const card = initialCards[p] as string;
    if (held.has(card)) {
      final.push(card);
    } else {
      final.push(replacementPool[t] as string);
      t += 1;
    }
  }
  return final;
}

// §1.2: commitment = lowercase hex of SHA-256 over the 32 decoded seed bytes.
// A malformed seed cannot match any commitment, so it returns false rather than throwing.
// The published hash is compared case-insensitively.
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean {
  let key: Buffer;
  try {
    key = decodeServerSeed(serverSeed);
  } catch {
    return false;
  }
  if (typeof serverSeedHashed !== 'string') return false;
  const commitment = createHash('sha256').update(key).digest('hex');
  return commitment === serverSeedHashed.toLowerCase();
}

// §2 Steps 1-5 in one call: one shuffle, deal a[0..4], pool a[5..9], then the draw.
export function recomputeRound(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  heldCards: readonly string[],
): { initialHand: string[]; replacementPool: string[]; finalHand: string[] } {
  const deck = computeShuffledDeck(serverSeed, clientSeed, nonce);
  const initialHand = deck.slice(0, HAND_SIZE);
  const replacementPool = deck.slice(HAND_SIZE, 2 * HAND_SIZE);
  const finalHand = computeFinalHand(initialHand, heldCards, replacementPool);
  return { initialHand, replacementPool, finalHand };
}
