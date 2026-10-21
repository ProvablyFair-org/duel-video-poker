/**
 * Spec self-test — docs/ALGORITHM.md §5 vectors and properties, run against src/rng.ts.
 *
 * Written by the clean-room implementer together with src/rng.ts, from docs/ALGORITHM.md and the module
 * interface alone (never from Duel's code). Integrated 20 Oct 2026: the checks are unchanged; only the
 * import path, the mocha wrapper and the reporting (failures collected instead of printed) were adapted.
 */
import { createHash, createHmac, randomBytes } from 'crypto';
import {
  ALL_CARDS, DECK_SIZE, HAND_SIZE, MAX_UINT32, RejectionCensus, maxFairFor,
  computeShuffledDeckFromBuffer, computeShuffledDeck, dealInitialHand, getReplacementPool,
  computeFinalHand, verifyHash, recomputeRound,
} from '../../src/rng';
import * as assert from 'assert';

const EXPECTED_CHECKS = 80;
const eq = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const words = (s: string): string[] => s.trim().split(/\s+/).filter((w) => w !== '' && w !== '|');
const throws = (f: () => unknown): boolean => { try { f(); return false; } catch { return true; } };

// Recover the 51 swap targets j (i = 51..1) from a shuffled deck by replaying the
// backward Fisher-Yates: at step i, a[i] is final, so j is where that card currently sits.
function recoverJ(deck: readonly string[]): number[] {
  const a = ALL_CARDS.slice();
  const js: number[] = [];
  for (let i = DECK_SIZE - 1; i >= 1; i--) {
    const j = a.indexOf(deck[i] as string);
    js.push(j);
    const tmp = a[i] as string; a[i] = a[j] as string; a[j] = tmp;
  }
  return js;
}

interface Vector {
  id: string; serverSeed: string; commitment?: string; clientSeed: string; nonce: number;
  hmac0: string; u32: number; j51?: number; j?: string; a10: string;
  initial?: string; held?: string; final?: string;
}

const VECTORS: Vector[] = [
  {
    id: 'V1 hand 589162',
    serverSeed: '2424d436197860c90bad4022573f14eab6c9da3dcc2d50e57ad7d52357f0fdc9',
    commitment: '107cca7f92491e65e438a779d79dd253a16ccfef10d5ce5d31d2bcbb3ff22f7b',
    clientSeed: 'cpc4ihmPtvpHpapv', nonce: 0,
    hmac0: '4ed6dc5abf2a0d7f4c905c4d32f34c9c55d7e62c4c33db49eb1e816300541c26', u32: 1322703962, j51: 34,
    j: '34 30 43 28 35 28 15 20 30 18 1 23 15 34 37 35 31 9 6 21 2 0 3 19 12 14 24 3 13 4 14 6 17 1 16 1 4 12 4 7 2 5 4 6 0 1 5 2 0 1 1',
    a10: '8H JS 4D 10D 4C | 4S KS AH KD QD',
    initial: '8H JS 4D 10D 4C', held: 'JS 4D 10D', final: '4S JS 4D 10D KS',
  },
  {
    id: 'V2 hand 593949',
    serverSeed: 'f7c670b05ebea748011cfd9df0b4ebc82fa3e296f687aeb924abbd5c0fd60dd2',
    commitment: '449a8c95beaebe1e188594f95944df260f578d8b84743c27b5cc773524566216',
    clientSeed: 'pfauditmod66jae', nonce: 28,
    hmac0: '9f8c7a807bbb3f0855fead48a77634a31d0959a9cec22ab77af7db317e57f8ff', u32: 2676783744, j51: 24,
    j: '24 29 38 32 28 2 31 40 22 39 17 37 10 1 33 36 30 32 32 31 10 18 21 26 10 13 10 1 10 16 4 14 9 4 5 8 1 0 6 12 5 0 4 0 2 6 5 1 0 2 0',
    a10: '6C 2C 3C QC 5C | 4C KC KS 7C 10C',
    initial: '6C 2C 3C QC 5C', held: '6C 2C 3C 5C', final: '6C 2C 3C 4C 5C',
  },
  {
    id: 'V3 hand 591339',
    serverSeed: 'ecfa3d7aa4433e9d7dfd87a208e213c70284c2b978fba10fb2cb7554b19e5849',
    commitment: 'a4764f4c6eb8f4908ba142f155ce43e412f9dc3a303eaaf155af01966e270a9d',
    clientSeed: 'N7yI44jUR2NcHQHr', nonce: 13,
    hmac0: 'a4d5829396b3477970f925ebdbeb8e643b9f2ba91b4f0572cef31f8b4531e04f', u32: 2765456019, j51: 27,
    j: '27 0 7 14 7 44 22 4 21 28 22 16 38 11 17 6 24 24 31 5 13 14 11 23 4 4 13 18 0 17 7 14 18 9 10 11 8 9 3 12 8 5 3 4 6 3 1 3 2 1 0',
    a10: 'QD QS QH 2S QC | 2H 7D JD 8S 8H',
    initial: 'QD QS QH 2S QC', held: 'QD QS QH QC', final: 'QD QS QH 2H QC',
  },
  {
    id: 'V4 hand 593775',
    serverSeed: 'd2f479c131d62535e68de957ce53d0610337a310e965111a1ff434bd1c091e89',
    commitment: 'c6c491699ffbdf54564c9284d38d54025b3e57f3de018c22d72cc45adafeac0a',
    clientSeed: 'Msv09D5aCfx4wZnd', nonce: 14,
    hmac0: '5da92f85692775445d04753b6ed6bd6b32f7e0a48cac0b0e81f2c98210ea0add', u32: 1571368837, j51: 25,
    j: '25 14 47 12 26 33 25 5 37 39 16 35 34 19 26 26 4 3 19 25 8 18 5 17 3 25 7 14 8 16 7 12 10 6 6 6 5 13 11 11 8 5 8 3 4 6 4 1 2 2 0',
    a10: 'KS 2D 4H 2S 2H | 7H 7S QD 8C 7D',
    initial: 'KS 2D 4H 2S 2H', held: 'KS 2D 2S', final: 'KS 2D 7H 2S 7S',
  },
  {
    id: 'V5 hand 593883',
    serverSeed: 'edeaeeea31ffaeb8c647f89d5b3678cd3efba3d1cbfcb1cb852155ddb95c3d58',
    commitment: '4b6beb7d9861be4d5f36b37b41690f71399256d5f218c100939670c7a4961165',
    clientSeed: 'pfauditmod66jae', nonce: 12,
    hmac0: '1579c265bf89d56d614e04e7f76f2b751bfb2f131867718bcb66e3dc249bbd70', u32: 360301157, j51: 21,
    j: '21 41 41 13 33 34 35 26 0 22 36 15 34 12 21 17 9 24 12 31 14 14 2 13 13 21 17 3 16 0 2 1 16 11 6 2 4 9 6 2 9 9 9 4 2 0 0 1 2 2 0',
    a10: '4D 3H JC 3C 7D | 8C QS KC QD 4S',
    initial: '4D 3H JC 3C 7D', held: '', final: '8C QS KC QD 4S',
  },
  {
    id: 'V6 Duel Verify page',
    serverSeed: 'dcef593aa600985411514f97945ef2dd63caeea7791a2f66e3a366aa253dc383',
    clientSeed: 'OIWrfjgI0qtip9f2', nonce: 2,
    hmac0: '18ce2c5edcac268d59be1bdfae075746fa1f1c4464dde405d621cc1bdadcb0e6', u32: 416164958,
    a10: '4S AH 2H 3C 5D | QH QD 7D 4D 10S',
  },
];

function runSelftest(): { pass: number; total: number; failed: string[] } {
  let pass = 0;
  let total = 0;
  const failed: string[] = [];
  function check(name: string, ok: boolean, detail = ''): void {
    total += 1;
    if (ok) pass += 1;
    else failed.push(`${name}${detail ? '  -- ' + detail : ''}`);
  }

  // ---- worked vectors (§5) ----
  for (const v of VECTORS) {
    if (v.commitment) {
      check(`${v.id}: verifyHash(seed, commitment) true`, verifyHash(v.serverSeed, v.commitment));
    }
    // HMAC k=0: message format and key form of §2 Step 2, checked with Node crypto directly.
    const d0 = createHmac('sha256', Buffer.from(v.serverSeed, 'hex')).update(`${v.clientSeed}:${v.nonce}:0`, 'utf8').digest();
    check(`${v.id}: HMAC k=0 digest`, d0.toString('hex') === v.hmac0, d0.toString('hex'));
    check(`${v.id}: u32 of HMAC k=0`, d0.readUInt32BE(0) === v.u32, String(d0.readUInt32BE(0)));

    const census: RejectionCensus = { chunksRead: 0, swaps: 0 };
    const deck = computeShuffledDeck(v.serverSeed, v.clientSeed, v.nonce, census);
    const js = recoverJ(deck);
    if (v.j51 !== undefined) {
      check(`${v.id}: j(i=51) = u32 mod 52 = ${v.j51}`, v.u32 % 52 === v.j51 && js[0] === v.j51, `got ${js[0]}`);
    }
    if (v.j) {
      const want = v.j.split(' ').map(Number);
      check(`${v.id}: all 51 swap targets j`, want.length === 51 && eq(js, want), js.join(' '));
    }
    check(`${v.id}: a[0..9]`, eq(deck.slice(0, 10), words(v.a10)), deck.slice(0, 10).join(' '));
    check(`${v.id}: no rejection, census 51/51`, census.chunksRead === 51 && census.swaps === 51,
      JSON.stringify(census));

    if (v.initial !== undefined && v.final !== undefined && v.held !== undefined) {
      const held = words(v.held);
      check(`${v.id}: dealInitialHand`, eq(dealInitialHand(v.serverSeed, v.clientSeed, v.nonce), words(v.initial)));
      check(`${v.id}: getReplacementPool`,
        eq(getReplacementPool(v.serverSeed, v.clientSeed, v.nonce), words(v.a10).slice(5)));
      const r = recomputeRound(v.serverSeed, v.clientSeed, v.nonce, held);
      check(`${v.id}: recomputeRound final hand`, eq(r.finalHand, words(v.final)), r.finalHand.join(' '));
      check(`${v.id}: computeFinalHand from parts`,
        eq(computeFinalHand(words(v.initial), held, words(v.a10).slice(5)), words(v.final)));
    }
  }

  // ---- properties ----
  check('ALL_CARDS: 52 distinct, rank-major 2D 2H 2S 2C ... AD AH AS AC',
    ALL_CARDS.length === 52 && new Set(ALL_CARDS).size === 52 &&
    eq(ALL_CARDS.slice(0, 4), ['2D', '2H', '2S', '2C']) && eq(ALL_CARDS.slice(48), ['AD', 'AH', 'AS', 'AC']) &&
    ALL_CARDS[32] === '10D');
  check('constants DECK_SIZE 52, HAND_SIZE 5, MAX_UINT32 2^32-1',
    DECK_SIZE === 52 && HAND_SIZE === 5 && MAX_UINT32 === 4294967295);
  check('maxFairFor(52) = 4294967248, maxFairFor(2) = 2^32',
    maxFairFor(52) === 4294967248 && maxFairFor(2) === 4294967296);
  {
    let ok = true;
    for (let n = 2; n <= 52; n++) {
      const L = maxFairFor(n);
      if (L % n !== 0 || L > 4294967296 || 4294967296 - L >= n) ok = false;
    }
    check('maxFairFor(N), N=2..52: multiple of N, 2^32 - N < LIMIT <= 2^32', ok);
  }
  {
    // bias report: expected rejections per round = sum over N=2..52 of (2^32 - LIMIT)/2^32, ~1.383e-7 (§2 Step 2)
    let p = 0;
    for (let n = 2; n <= 52; n++) p += (4294967296 - maxFairFor(n)) / 4294967296;
    check(`expected rejections per round ${p.toExponential(3)} matches spec 1.383e-7`, Math.abs(p - 1.383e-7) < 0.001e-7);
  }
  {
    // random rounds: permutation of the deck, census consistent, buffer path equals string path
    const ROUNDS = 2000;
    let perm = true, census = true, buf = true, hands = true;
    let rejected = 0;
    for (let r = 0; r < ROUNDS; r++) {
      const seed = randomBytes(32).toString('hex');
      const client = randomBytes(8).toString('base64url');
      const nonce = r;
      const c: RejectionCensus = { chunksRead: 0, swaps: 0 };
      const deck = computeShuffledDeck(seed, client, nonce, c);
      if (deck.length !== 52 || new Set(deck).size !== 52 || !deck.every((x) => ALL_CARDS.includes(x))) perm = false;
      if (c.swaps !== 51 || c.chunksRead < 51) census = false;
      rejected += c.chunksRead - c.swaps;
      if (r < 200 && !eq(computeShuffledDeckFromBuffer(Buffer.from(seed, 'hex'), client, nonce), deck)) buf = false;
      if (r < 200) {
        const rr = recomputeRound(seed, client, nonce, []);
        if (!eq(rr.initialHand, deck.slice(0, 5)) || !eq(rr.replacementPool, deck.slice(5, 10)) ||
            !eq(rr.finalHand, deck.slice(5, 10))) hands = false;
      }
    }
    check(`${ROUNDS} random rounds: each deck is a permutation of ALL_CARDS`, perm);
    check(`${ROUNDS} random rounds: census swaps = 51, chunksRead >= 51`, census);
    check(`${ROUNDS} random rounds: rejected chunks = chunksRead - swaps = ${rejected} (>= 0)`, rejected >= 0);
    check('computeShuffledDeckFromBuffer equals computeShuffledDeck (200 rounds)', buf);
    check('recomputeRound: hand = a[0..4], pool = a[5..9], hold none -> pool (200 rounds)', hands);
  }
  {
    // passing a census changes nothing computed (INTERFACE.md)
    const v = VECTORS[0] as Vector;
    check('census does not change the deck',
      eq(computeShuffledDeck(v.serverSeed, v.clientSeed, v.nonce), computeShuffledDeck(v.serverSeed, v.clientSeed, v.nonce, { chunksRead: 0, swaps: 0 })));
  }
  {
    const v = VECTORS[0] as Vector;
    const init = words(v.initial as string);
    const pool = words(v.a10).slice(5);
    check('computeFinalHand: hold all 5 -> initial hand', eq(computeFinalHand(init, init, pool), init));
    check('computeFinalHand: hold order irrelevant',
      eq(computeFinalHand(init, ['10D', 'JS', '4D'], pool), words(v.final as string)));
    check('computeFinalHand: held card not in hand throws', throws(() => computeFinalHand(init, ['AS'], pool)));
  }
  {
    const v = VECTORS[0] as Vector;
    const c = v.commitment as string;
    check('verifyHash: uppercase commitment accepted', verifyHash(v.serverSeed, c.toUpperCase()));
    check('verifyHash: wrong seed -> false', !verifyHash((VECTORS[1] as Vector).serverSeed, c));
    check('verifyHash: one flipped hash char -> false', !verifyHash(v.serverSeed, (c[0] === '0' ? '1' : '0') + c.slice(1)));
    check('verifyHash: SHA-256 of ASCII seed is NOT the commitment (§1.2)', !verifyHash(v.serverSeed,
      createHash('sha256').update(v.serverSeed, 'utf8').digest('hex')));
    check('verifyHash: malformed seed -> false', !verifyHash('xyz', c));
    check('computeShuffledDeck: malformed seed throws', throws(() => computeShuffledDeck('abc', 'x', 0)));
    check('computeShuffledDeck: negative / fractional nonce throws',
      throws(() => computeShuffledDeck(v.serverSeed, 'x', -1)) && throws(() => computeShuffledDeck(v.serverSeed, 'x', 1.5)));
  }

  return { pass, total, failed };
}

describe('Spec self-test — src/rng.ts against docs/ALGORITHM.md (clean-room rebuild)', function () {
  this.timeout(300_000);
  it(`all ${EXPECTED_CHECKS} spec vector and property checks pass`, () => {
    const r = runSelftest();
    assert.deepStrictEqual(r.failed, []);
    assert.strictEqual(r.total, EXPECTED_CHECKS);
    assert.strictEqual(r.pass, EXPECTED_CHECKS);
  });
});
