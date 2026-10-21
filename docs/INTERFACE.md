# Module interface the audit package expects (written by the auditor, not from the casino)

Write `rng.ts` (TypeScript, strict, Node `crypto` only, no dependencies) exporting exactly these names.
Semantics come from ALGORITHM.md; this file only fixes names, types and the package's own conventions.
Cards are strings like "2D", "10S", "AH" exactly as the spec writes them.

```ts
export const ALL_CARDS: readonly string[];   // the unshuffled deck, in the spec's order
export const DECK_SIZE: number;              // 52
export const HAND_SIZE: number;              // 5
export const MAX_UINT32: number;             // largest 32-bit unsigned value

// Optional counter: passing one changes nothing computed; it counts the 4-byte chunks read and
// the swaps made, so rejected chunks = chunksRead - swaps.
export interface RejectionCensus { chunksRead: number; swaps: number }
// Rejection limit for a draw over `range` outcomes: values >= this are rejected.
export function maxFairFor(range: number): number;

// Full shuffled deck (52 cards) from the HMAC key bytes already decoded from the server seed.
export function computeShuffledDeckFromBuffer(keyBuffer: Buffer, clientSeed: string, nonce: number, census?: RejectionCensus): string[];
// Same, taking the server seed as the casino publishes it.
export function computeShuffledDeck(serverSeed: string, clientSeed: string, nonce: number, census?: RejectionCensus): string[];
// The 5 cards dealt first.
export function dealInitialHand(serverSeed: string, clientSeed: string, nonce: number): string[];
// The 5 replacement cards, in the order they are used.
export function getReplacementPool(serverSeed: string, clientSeed: string, nonce: number): string[];
// Final hand: held cards stay in their positions; the others are filled from the pool per the spec.
// heldCards = the card strings the player kept.
export function computeFinalHand(initialCards: readonly string[], heldCards: readonly string[], replacementPool: readonly string[]): string[];
// Commitment check.
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean;
// Convenience: the whole round.
export function recomputeRound(serverSeed: string, clientSeed: string, nonce: number, heldCards: readonly string[]):
  { initialHand: string[]; replacementPool: string[]; finalHand: string[] };
```
Payout/hand ranking is NOT part of this module (the package has its own evaluator); implement only the above.
