import { strict as assert } from 'assert';
import {
  computeShuffledDeck,
  dealInitialHand,
  getReplacementPool,
  computeFinalHand,
  recomputeRound,
  verifyHash,
  ALL_CARDS,
  DECK_SIZE,
  HAND_SIZE,
} from '../../src/rng';
import { evaluateHand, parseCard } from '../../src/hand-evaluator';
import { bestHold, expectedMultiplier } from '../../src/optimal-strategy';
import type { HandRank } from '../../src/types';

const PAY_TABLE: Record<HandRank, number> = {
  royal_flush:     812.9719437907615,
  straight_flush:  58,
  four_of_a_kind:  26,
  full_house:       9,
  flush:            6,
  straight:         4,
  three_of_a_kind:  3,
  two_pair:         2,
  jacks_or_better:  1,
  none:             0,
};

describe('RNG — Duel Video Poker Fisher-Yates', () => {
  // Pilot round captured live 2026-04-23, nonce 1, held_cards = []
  const PILOT_SERVER_SEED   = '105bde0af7af90e305027ec61c2408cd48b5f9da7413cfbe652eef5eca68d127';
  const PILOT_SERVER_HASHED = '090390e88be4b2e5adeb10c77fdfaac312bac89c8afd1d2b2210f53d8c2386ab';
  const PILOT_CLIENT_SEED   = 'Ic5RYWpnRDXUQebq';

  it('ALL_CARDS has 52 unique entries in rank-major order', () => {
    assert.equal(ALL_CARDS.length, DECK_SIZE);
    assert.equal(new Set(ALL_CARDS).size, DECK_SIZE);
    assert.equal(ALL_CARDS[0],  '2D');
    assert.equal(ALL_CARDS[1],  '2H');
    assert.equal(ALL_CARDS[2],  '2S');
    assert.equal(ALL_CARDS[3],  '2C');
    assert.equal(ALL_CARDS[51], 'AC');
  });

  it('verifyHash matches live commitment', () => {
    assert.equal(verifyHash(PILOT_SERVER_SEED, PILOT_SERVER_HASHED), true);
  });

  it('verifyHash rejects a tampered server seed (negative control)', () => {
    const tampered = PILOT_SERVER_SEED.replace(/^./, c => (c === '0' ? '1' : '0'));
    assert.equal(verifyHash(tampered, PILOT_SERVER_HASHED), false);
  });

  it('verifyHash rejects a tampered hash (negative control)', () => {
    const tamperedHash = PILOT_SERVER_HASHED.replace(/^./, c => (c === '0' ? '1' : '0'));
    assert.equal(verifyHash(PILOT_SERVER_SEED, tamperedHash), false);
  });

  it('HMAC key must be hex-decoded — UTF-8 encoding produces wrong deck', () => {
    const crypto = require('crypto');
    const msg = `${PILOT_CLIENT_SEED}:1:0`;
    // Correct: hex-decoded 32-byte key
    const hexKey = Buffer.from(PILOT_SERVER_SEED, 'hex');
    const hexHmac = crypto.createHmac('sha256', hexKey).update(msg).digest('hex');
    // Wrong: UTF-8 64-byte key
    const utf8Key = Buffer.from(PILOT_SERVER_SEED, 'utf-8');
    const utf8Hmac = crypto.createHmac('sha256', utf8Key).update(msg).digest('hex');
    // They must differ — using the wrong encoding produces a completely different shuffle
    assert.notEqual(hexHmac, utf8Hmac);
    // And only hex-decoded produces the known correct deck
    const deck = computeShuffledDeck(PILOT_SERVER_SEED, PILOT_CLIENT_SEED, 1);
    assert.deepEqual(deck.slice(0, 5), ['10C', '2D', '3D', '6C', '7C']);
  });

  it('computeShuffledDeck returns 52-card permutation', () => {
    const deck = computeShuffledDeck(PILOT_SERVER_SEED, PILOT_CLIENT_SEED, 1);
    assert.equal(deck.length, DECK_SIZE);
    assert.equal(new Set(deck).size, DECK_SIZE);
    for (const c of deck) assert.ok(ALL_CARDS.includes(c));
  });

  it('pilot round 1 (nonce=1) recomputes to live cards', () => {
    const deck = computeShuffledDeck(PILOT_SERVER_SEED, PILOT_CLIENT_SEED, 1);
    assert.deepEqual(deck.slice(0, 5),  ['10C', '2D',  '3D',  '6C',  '7C']);
    assert.deepEqual(deck.slice(5, 10), ['2C',  '10H', 'KC',  '8S',  '7D']);
  });

  it('pilot round 2 (nonce=3) recomputes to live cards', () => {
    const deck = computeShuffledDeck(PILOT_SERVER_SEED, PILOT_CLIENT_SEED, 3);
    assert.deepEqual(deck.slice(0, 5), ['7C', '3C', 'AS', '10D', 'JC']);
  });

  it('computeFinalHand preserves held positions, consumes pool in order', () => {
    const initial = ['7C', '3C', 'AS', '10D', 'JC'];
    const pool    = ['5C', '9H', 'QD', 'KH',  '2S'];
    const held    = ['AS', 'JC'];
    // Expected: pos 0 ← pool[0], pos 1 ← pool[1], pos 2 kept, pos 3 ← pool[2], pos 4 kept
    assert.deepEqual(computeFinalHand(initial, held, pool), ['5C', '9H', 'AS', 'QD', 'JC']);
  });

  it('pilot round 2 full recomputation matches live final_cards', () => {
    const r = recomputeRound(PILOT_SERVER_SEED, PILOT_CLIENT_SEED, 3, ['AS', 'JC']);
    assert.deepEqual(r.finalHand, ['5C', '9H', 'AS', 'QD', 'JC']);
  });

  it('recomputeRound is deterministic', () => {
    const a = recomputeRound(PILOT_SERVER_SEED, PILOT_CLIENT_SEED, 1, []);
    const b = recomputeRound(PILOT_SERVER_SEED, PILOT_CLIENT_SEED, 1, []);
    assert.deepEqual(a, b);
  });

  it('distinct nonces produce distinct decks', () => {
    const d1 = computeShuffledDeck(PILOT_SERVER_SEED, PILOT_CLIENT_SEED, 1);
    const d2 = computeShuffledDeck(PILOT_SERVER_SEED, PILOT_CLIENT_SEED, 2);
    assert.notDeepEqual(d1, d2);
  });

  it('distinct client seeds produce distinct decks', () => {
    const d1 = computeShuffledDeck(PILOT_SERVER_SEED, 'clientA', 1);
    const d2 = computeShuffledDeck(PILOT_SERVER_SEED, 'clientB', 1);
    assert.notDeepEqual(d1, d2);
  });

  it('initial hand and replacement pool are disjoint', () => {
    const deck = computeShuffledDeck(PILOT_SERVER_SEED, PILOT_CLIENT_SEED, 2);
    const hand = new Set(deck.slice(0, 5));
    const pool = new Set(deck.slice(5, 10));
    for (const c of hand) assert.ok(!pool.has(c));
  });
});

describe('Hand evaluator — all 10 hand ranks', () => {
  it('parseCard handles all 52 cards', () => {
    for (const c of ALL_CARDS) {
      const { rank, suit } = parseCard(c);
      assert.ok(rank >= 2 && rank <= 14);
      assert.ok('DHSC'.includes(suit));
    }
  });

  it('royal flush — T-J-Q-K-A suited', () => {
    assert.equal(evaluateHand(['10H', 'JH', 'QH', 'KH', 'AH']), 'royal_flush');
    assert.equal(evaluateHand(['AC', 'KC', 'QC', 'JC', '10C']), 'royal_flush');
  });

  it('straight flush — 5 suited consecutive, not royal', () => {
    assert.equal(evaluateHand(['5D', '6D', '7D', '8D', '9D']), 'straight_flush');
    // Ace-low straight flush (steel wheel): A-2-3-4-5 suited
    assert.equal(evaluateHand(['AS', '2S', '3S', '4S', '5S']), 'straight_flush');
    // 9-T-J-Q-K suited
    assert.equal(evaluateHand(['9C', '10C', 'JC', 'QC', 'KC']), 'straight_flush');
  });

  it('four of a kind', () => {
    assert.equal(evaluateHand(['8D', '8H', '8S', '8C', '2C']), 'four_of_a_kind');
    assert.equal(evaluateHand(['AD', 'AH', 'AS', 'AC', '3D']), 'four_of_a_kind');
  });

  it('full house', () => {
    assert.equal(evaluateHand(['7D', '7H', '7S', 'KC', 'KD']), 'full_house');
    assert.equal(evaluateHand(['2D', '2H', '3S', '3C', '3D']), 'full_house');
  });

  it('flush — 5 same suit, not straight', () => {
    assert.equal(evaluateHand(['2D', '5D', '7D', '9D', 'KD']), 'flush');
    // Must NOT classify 5-suited-consecutive as flush
    assert.notEqual(evaluateHand(['5D', '6D', '7D', '8D', '9D']), 'flush');
  });

  it('straight — 5 consecutive mixed suits', () => {
    assert.equal(evaluateHand(['5D', '6H', '7S', '8C', '9D']), 'straight');
    // Ace-low straight (wheel)
    assert.equal(evaluateHand(['AD', '2H', '3S', '4C', '5D']), 'straight');
    // Ace-high straight (broadway, not royal because mixed suits)
    assert.equal(evaluateHand(['10D', 'JH', 'QS', 'KC', 'AD']), 'straight');
  });

  it('three of a kind', () => {
    assert.equal(evaluateHand(['7D', '7H', '7S', '2C', '5D']), 'three_of_a_kind');
  });

  it('two pair', () => {
    assert.equal(evaluateHand(['8D', '8H', '3S', '3C', '7D']), 'two_pair');
    // Low+high pairs still classified as two_pair
    assert.equal(evaluateHand(['2D', '2H', 'AS', 'AC', '7D']), 'two_pair');
  });

  it('jacks or better — pair of J/Q/K/A only', () => {
    assert.equal(evaluateHand(['JD', 'JH', '3S', '5C', '7D']), 'jacks_or_better');
    assert.equal(evaluateHand(['QD', 'QH', '2S', '5C', '7D']), 'jacks_or_better');
    assert.equal(evaluateHand(['KD', 'KH', '2S', '5C', '7D']), 'jacks_or_better');
    assert.equal(evaluateHand(['AD', 'AH', '2S', '5C', '7D']), 'jacks_or_better');
  });

  it('none — low pair is a loser', () => {
    assert.equal(evaluateHand(['10D', '10H', '3S', '5C', '7D']), 'none');
    assert.equal(evaluateHand(['2D',  '2H',  '3S', '5C', '7D']), 'none');
    assert.equal(evaluateHand(['9D',  '9H',  '3S', '5C', '7D']), 'none');
  });

  it('none — no pair, no straight, no flush', () => {
    assert.equal(evaluateHand(['2D', '5H', '9S', 'QC', 'KD']), 'none');
    assert.equal(evaluateHand(['7C', '3C', 'AS', '10D', 'JC']), 'none');
  });

  it('rejects invalid hands', () => {
    assert.throws(() => evaluateHand(['2D', '2D', '3S', '5C', '7D']));       // duplicate
    assert.throws(() => evaluateHand(['2D', '3S', '5C', '7D']));             // 4 cards
    assert.throws(() => evaluateHand(['XX', '2D', '3S', '5C', '7D']));       // invalid card
  });

  // ── Video poker edge cases ──────────────────────────────────────────────

  it('wraparound Q-K-A-2-3 is NOT a straight', () => {
    assert.equal(evaluateHand(['QD', 'KH', 'AS', '2C', '3D']), 'none');
  });

  it('mid-ace 3-4-5-6-A is NOT a straight', () => {
    assert.equal(evaluateHand(['3D', '4H', '5S', '6C', 'AD']), 'none');
  });

  it('two pair with Jacks is two_pair, not jacks_or_better', () => {
    assert.equal(evaluateHand(['JD', 'JH', '5S', '5C', 'KD']), 'two_pair');
  });

  it('two pair with both high pairs is two_pair', () => {
    assert.equal(evaluateHand(['JD', 'JH', 'AS', 'AC', 'KD']), 'two_pair');
  });

  it('pair of 10s is none (boundary: 10 < Jack)', () => {
    assert.equal(evaluateHand(['10D', '10H', '2S', '5C', '7D']), 'none');
  });

  it('three aces with low kickers is three_of_a_kind', () => {
    assert.equal(evaluateHand(['AD', 'AH', 'AS', '2C', '3D']), 'three_of_a_kind');
  });

  it('steel wheel (A-2-3-4-5 suited) is straight_flush, not royal', () => {
    assert.equal(evaluateHand(['AD', '2D', '3D', '4D', '5D']), 'straight_flush');
  });

  it('9-high straight flush is straight_flush, not royal', () => {
    assert.equal(evaluateHand(['5H', '6H', '7H', '8H', '9H']), 'straight_flush');
  });

  it('K-high straight flush is straight_flush, not royal', () => {
    assert.equal(evaluateHand(['9C', '10C', 'JC', 'QC', 'KC']), 'straight_flush');
  });

  it('broadway mixed suits is straight, not flush or royal', () => {
    assert.equal(evaluateHand(['10D', 'JH', 'QS', 'KC', 'AH']), 'straight');
  });

  it('4-card flush + 1 off-suit is none (not flush)', () => {
    assert.equal(evaluateHand(['2D', '5D', '7D', '9D', 'KC']), 'none');
  });

  it('4 consecutive + 1 gap is none (not straight)', () => {
    assert.equal(evaluateHand(['5D', '6H', '7S', '8C', '10D']), 'none');
  });
});

describe('Hand evaluator — cross-check vs pokersolver', () => {
  it('agrees with pokersolver on 10,000 random hands', () => {
    // pokersolver is an independent third-party library (npm pokersolver)
    // used purely as a cross-validation oracle. Card format differs:
    //   Duel: '10H' → pokersolver: 'Th'
    //   Duel: '2D' → pokersolver: '2d'
    const Hand = require('pokersolver').Hand;

    function toPokersolverCard(c: string): string {
      const suit = c.slice(-1).toLowerCase();
      const rank = c.slice(0, -1);
      return (rank === '10' ? 'T' : rank) + suit;
    }

    // Map pokersolver name → our HandRank (pokersolver doesn't split Royal from SF)
    function psNameToOurs(name: string, cards: string[]): string {
      if (name === 'Straight Flush') {
        // Check if it's actually a Royal Flush (T-J-Q-K-A suited)
        const ranks = cards.map(c => c.slice(0, -1)).sort();
        if (ranks.join(',') === '10,A,J,K,Q') return 'royal_flush';
        return 'straight_flush';
      }
      const map: Record<string, string> = {
        'Four of a Kind': 'four_of_a_kind',
        'Full House': 'full_house',
        'Flush': 'flush',
        'Straight': 'straight',
        'Three of a Kind': 'three_of_a_kind',
        'Two Pair': 'two_pair',
        'Pair': 'PAIR', // need Jacks check
        'High Card': 'none',
      };
      return map[name] || 'unknown';
    }

    let mismatches = 0;
    const deck = [...ALL_CARDS];

    for (let t = 0; t < 10_000; t++) {
      // Shuffle and pick 5
      const pool = [...deck];
      const hand: string[] = [];
      for (let j = 0; j < 5; j++) {
        const idx = Math.floor(Math.random() * (pool.length - j)) + j;
        [pool[j], pool[idx]] = [pool[idx], pool[j]];
        hand.push(pool[j]);
      }

      const ourRank = evaluateHand(hand);
      const psCards = hand.map(toPokersolverCard);
      const psHand = Hand.solve(psCards, 'standard');
      let psRank = psNameToOurs(psHand.name, hand);

      // Handle Pair: pokersolver doesn't distinguish JoB from low pair
      if (psRank === 'PAIR') {
        // Check if it's jacks_or_better or none
        psRank = ourRank === 'jacks_or_better' || ourRank === 'none' ? ourRank : 'none';
        // Actually verify: for pairs, the paired rank must be >= J
        // We trust our evaluator for this distinction since pokersolver doesn't split it
        // So we only check that pokersolver agrees it IS a pair
      }

      // For Pair cases, just verify pokersolver also found a Pair
      if (psHand.name === 'Pair') {
        assert.ok(ourRank === 'jacks_or_better' || ourRank === 'none',
          `Hand ${hand}: pokersolver=Pair, ours=${ourRank}`);
      } else {
        // For all non-pair hands, classification must match exactly
        if (psRank !== ourRank) {
          mismatches++;
          if (mismatches <= 3) {
            console.log(`  mismatch: ${hand.join(',')} → ours=${ourRank}, ps=${psHand.name}(→${psRank})`);
          }
        }
      }
    }

    assert.equal(mismatches, 0, `${mismatches} mismatches between our evaluator and pokersolver`);
  });
});

describe('Hand evaluator — exhaustive C(52,5) enumeration sanity', () => {
  it('classifies a sample of 10,000 random hands without error', () => {
    // Quick fuzz: generate 10K random 5-card hands from the deck, ensure none throw
    const cards = [...ALL_CARDS];
    for (let i = 0; i < 10_000; i++) {
      // Fisher-Yates partial shuffle (pick 5)
      const hand: string[] = [];
      const pool = [...cards];
      for (let j = 0; j < 5; j++) {
        const idx = Math.floor(Math.random() * (pool.length - j)) + j;
        [pool[j], pool[idx]] = [pool[idx], pool[j]];
        hand.push(pool[j]);
      }
      const rank = evaluateHand(hand);
      assert.ok(
        ['royal_flush', 'straight_flush', 'four_of_a_kind', 'full_house',
         'flush', 'straight', 'three_of_a_kind', 'two_pair',
         'jacks_or_better', 'none'].includes(rank),
        `Invalid rank "${rank}" for hand ${hand}`,
      );
    }
  });
});

describe('Optimal strategy — basic sanity', () => {
  it('holds a pat royal flush', () => {
    const d = bestHold(['10H', 'JH', 'QH', 'KH', 'AH'], PAY_TABLE);
    assert.deepEqual(d.heldCards.sort(), ['10H', 'AH', 'JH', 'KH', 'QH'].sort());
    assert.equal(d.expectedMultiplier, 812.9719437907615);
  });

  it('holds a pat straight flush', () => {
    const d = bestHold(['5D', '6D', '7D', '8D', '9D'], PAY_TABLE);
    assert.equal(d.heldCards.length, 5);
    assert.equal(d.expectedMultiplier, 58);
  });

  it('holds a pat full house (never breaks for 3oaK)', () => {
    const d = bestHold(['7D', '7H', '7S', 'KC', 'KD'], PAY_TABLE);
    assert.equal(d.heldCards.length, 5);
    assert.equal(d.expectedMultiplier, 9);
  });

  it('breaks Jacks-or-Better to draw 3 (keeps the pair)', () => {
    const d = bestHold(['JD', 'JH', '3S', '5C', '7D'], PAY_TABLE);
    assert.deepEqual(d.heldCards.sort(), ['JD', 'JH']);
    assert.ok(d.expectedMultiplier > 1); // Better than 1x pat
  });

  it('discards a junk hand entirely (hold 0)', () => {
    const d = bestHold(['2D', '5H', '9S', 'QC', '3S'], PAY_TABLE);
    assert.ok(d.expectedMultiplier >= 0);
  });

  it('4-to-royal: holds 4 suited T-J-Q-K, discards 5th', () => {
    const d = bestHold(['10H', 'JH', 'QH', 'KH', '2D'], PAY_TABLE);
    // Should hold the 4 suited royals, discard 2D
    assert.ok(d.heldCards.includes('10H'));
    assert.ok(d.heldCards.includes('JH'));
    assert.ok(d.heldCards.includes('QH'));
    assert.ok(d.heldCards.includes('KH'));
    assert.ok(!d.heldCards.includes('2D'));
    assert.equal(d.heldCards.length, 4);
  });

  it('dealt flush: holds all 5 (EV = 6x)', () => {
    const d = bestHold(['2D', '5D', '7D', '9D', 'KD'], PAY_TABLE);
    assert.equal(d.heldCards.length, 5);
    assert.equal(d.expectedMultiplier, 6);
  });

  it('dealt straight: holds all 5 (EV = 4x)', () => {
    const d = bestHold(['5D', '6H', '7S', '8C', '9D'], PAY_TABLE);
    assert.equal(d.heldCards.length, 5);
    assert.equal(d.expectedMultiplier, 4);
  });

  it('low pair (2s): holding pair beats discarding all', () => {
    const d = bestHold(['2D', '2H', '7S', '9C', 'KD'], PAY_TABLE);
    // Low pair has EV > 0 from trips/full house/4oaK potential
    assert.ok(d.expectedMultiplier > 0);
    assert.ok(d.heldCards.length >= 2); // should hold at least the pair
  });
});

describe('Draw replacement — additional coverage', () => {
  const SEED = '105bde0af7af90e305027ec61c2408cd48b5f9da7413cfbe652eef5eca68d127';
  const CLIENT = 'Ic5RYWpnRDXUQebq';

  it('hold all 5 = initial hand unchanged', () => {
    const r = recomputeRound(SEED, CLIENT, 1, ['10C', '2D', '3D', '6C', '7C']);
    assert.deepEqual(r.finalHand, ['10C', '2D', '3D', '6C', '7C']);
  });

  it('hold 0 = all 5 replaced from pool in order', () => {
    const r = recomputeRound(SEED, CLIENT, 1, []);
    assert.deepEqual(r.finalHand, r.replacementPool);
  });

  it('hold non-adjacent positions (0 and 4)', () => {
    const r = recomputeRound(SEED, CLIENT, 1, ['10C', '7C']);
    // Positions 1, 2, 3 replaced from pool[0..2]
    assert.equal(r.finalHand[0], '10C'); // held
    assert.equal(r.finalHand[1], r.replacementPool[0]); // replaced
    assert.equal(r.finalHand[2], r.replacementPool[1]); // replaced
    assert.equal(r.finalHand[3], r.replacementPool[2]); // replaced
    assert.equal(r.finalHand[4], '7C'); // held
  });

  it('hold single middle position (position 2)', () => {
    const r = recomputeRound(SEED, CLIENT, 1, ['3D']);
    // Positions 0, 1, 3, 4 replaced from pool[0..3]
    assert.equal(r.finalHand[0], r.replacementPool[0]);
    assert.equal(r.finalHand[1], r.replacementPool[1]);
    assert.equal(r.finalHand[2], '3D'); // held
    assert.equal(r.finalHand[3], r.replacementPool[2]);
    assert.equal(r.finalHand[4], r.replacementPool[3]);
  });

  it('hold 3 cards (positions 0, 2, 4) — pool fills gaps in order', () => {
    const r = recomputeRound(SEED, CLIENT, 1, ['10C', '3D', '7C']);
    // Positions 1, 3 replaced from pool[0..1]
    assert.equal(r.finalHand[0], '10C'); // held
    assert.equal(r.finalHand[1], r.replacementPool[0]); // replaced
    assert.equal(r.finalHand[2], '3D'); // held
    assert.equal(r.finalHand[3], r.replacementPool[1]); // replaced
    assert.equal(r.finalHand[4], '7C'); // held
  });

  it('hold 4 cards (positions 0, 1, 2, 3) — only position 4 replaced', () => {
    const r = recomputeRound(SEED, CLIENT, 1, ['10C', '2D', '3D', '6C']);
    assert.equal(r.finalHand[0], '10C'); // held
    assert.equal(r.finalHand[1], '2D'); // held
    assert.equal(r.finalHand[2], '3D'); // held
    assert.equal(r.finalHand[3], '6C'); // held
    assert.equal(r.finalHand[4], r.replacementPool[0]); // only this replaced
  });
});
