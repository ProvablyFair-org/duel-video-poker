# Duel Video Poker — Consolidated Audit Overview

**Audit ID:** PF-2026-DL08 · **Auditor:** ProvablyFair.org · **Release:** `v1.2.0` · **Framework:** 1.1

Audit date: April 2026. Dataset of record: capture on **24 April 2026**, from `2026-04-24T14:46:58.730Z` to `2026-04-24T20:28:08.944Z`. Original publication: 4 June 2026. Game variant: Jacks or Better, 9/6 pay table, on [Duel.com](https://duel.com). Runtime of record: Node 22.x (`package.json` `engines`, `.nvmrc`). Audit report: https://audit.provablyfair.org/casino/duel/games/video-poker/overview. This overview consolidates the package documentation; the machine-readable release identity is in [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json), which is v1.2.0's; v1.1.0's signed release identity is in the `RELEASE-MANIFEST.json` at the `v1.1.0` tag.

## Conclusion and scope

**PROVABLY FAIR — Full Pass:** 27 of 28 verification steps pass, with 0 hard fails; the 28th, Step 4, is a capture-origin flag: two nonces the capture missed on a retried request. The initial deal at each is derivable from the revealed seed; the full rounds were not captured. Disclosed, verdict-neutral.

The game uses a standard commit-reveal scheme with HMAC-SHA256 to produce a deterministic 52-card deck shuffle for each round. The dealt hand, replacement pool and final hand are all determined at deal time and can be recomputed by anyone from the revealed server seed, client seed and nonce. All 5,400 captured bets across 5 phases (A–E) were recomputed with 0 mismatches by this package's RNG code, which was rebuilt from a written specification ([docs/ALGORITHM.md](docs/ALGORITHM.md)) by an implementer who never opened Duel's code; Step 5 also runs Duel's published Verify-tab code (E19) unedited on every hand as a second check, not as the source, and all 110 revealed server seeds hash to the commitments their bets were served under. That hash match is a consistency check; that each commitment was shown before its bets rests on the capture's rotation records, with capture integrity assumed ([Limitations and trust](#limitations-and-trust), premise P5). No evidence of seed manipulation, outcome tampering or cherry-picking was found.

The theoretical deal-only RTP of 33.7238% is confirmed by independent combinatorial enumeration (C(52,5) = 2,598,960 hands) and validated by 10,000,000 simulated rounds (Fisher's combined p = 0.7982). Under optimal play, the game's RTP is exactly **99.9000%** for bets up to $1,182.85 (tier 0); 99.39% at the top tier (see [Bet-size scaling](#bet-size-scaling)). The 99.9000% is independently computed by exhaustive enumeration of all dealt hands and cross-validated against the published 9/6 Jacks or Better RTP of 99.5439%. The optimal-play figure is conditional on the exact pinned `videoPokerConfig.json`. Pass 2 (110 casino seeds × 100,000 nonces) detected no cherry-pick bias.

**Scope:** the game on Duel.com as played from a single funded test account. The audit verifies the cryptographic integrity of the commit-reveal scheme, the deterministic HMAC-SHA256 Fisher–Yates shuffle, hand classification and payout calculation, the statistical fairness of the deal-only hand-rank distribution, and casino seed-selection integrity. Single-account testing cannot rule out differential treatment across accounts, and all test bets ($0.01 and $10) fall in tier 0 of the 52-tier bet-size scale in the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET; E20); higher tiers are covered from that configuration, not live bets ([Bet-size scaling](#bet-size-scaling)). The commit-reveal model does not use an external randomness beacon.

| Risk area | Assessment | Basis |
|-----------|-----------|-------|
| RNG integrity | No risk detected | 5,400/5,400 decks recomputed, 10M simulation PASS |
| Seed manipulation | No risk detected | 110/110 revealed seeds hash to their commitments and the commitment chain is consistent (consistency checks); pre-bet timing from the capture's rotation records, capture integrity assumed (P5) |
| Outcome tampering | No risk detected | Decks, hands and payouts match recomputation (RNG code rebuilt from the written specification docs/ALGORITHM.md, Duel's Verify-tab code E19 run as a second check; hand evaluator built separately, cross-validated with pokersolver) |
| Cherry-pick seeds | No risk detected | Pass 2: captured-window rank-sum Z −0.018 vs −3.090 (exact permutation null) |
| Payout accuracy | No risk detected | 5,400/5,400 payouts correct |
| Hand misclassification | No risk detected | 5,400/5,400 classifications match; cross-validated with pokersolver |
| Bet-size influence | Shuffle: no stake influence. Pay table: scales with stake from $1,182.86 (the duel.com config as fetched 2026-10-05 in a logged-in session, read-only GET; E20), disclosed | Shuffle: 100 Phase C bets at $10 recompute identically. Pay table: [Bet-size scaling](#bet-size-scaling) |

## Contents

- [Dataset and capture](#dataset-and-capture)
- [Game and algorithm](#game-and-algorithm)
- [Payouts and RTP](#payouts-and-rtp)
- [Verification results](#verification-results)
- [Reproduce the audit](#reproduce-the-audit)
- [Verify a bet](#verify-a-bet)
- [Evidence](#evidence)
- [Limitations and trust](#limitations-and-trust)
- [Terms](#terms)
- [Release history](#release-history)

## Dataset and capture

5,400 hands were played on Duel.com from a single funded test account. Each bet record contains the deal request/response, the draw request/response and seed data. The capture method is preserved as a non-runnable reference record, [capture/capture.reference.js](capture/capture.reference.js); it accounts for 110 of the 115 seed records, not the 5 phase-end rotations (see **Seed entries** below). Two capture files ship, both non-runnable reference records: [capture/capture.reference.js](capture/capture.reference.js) and [capture/fill-gaps.reference.js](capture/fill-gaps.reference.js). The runnable capture tools, `capture/capture.js` and `capture/fill-gaps.js`, are kept in the private workshop and not published: `capture/capture.js` places bets on duel.com, and the release withholds every runnable file under `capture/`.

| Phase | Bets | Stake | Purpose | Client seeds |
|-------|------|-------|---------|-------------|
| A | 3,000 | $0.01 | Random holds — baseline dataset | 61 |
| B | 1,000 | $0.01 | Targeted holds — hunt specific hand types | 20 |
| C | 100 | $10.00 | Stake independence — verify bet amount does not affect shuffle | 2 |
| D | 500 | $0.01 | Custom auditor client seed (`pfauditmod66jae`) | 1 (auditor-chosen) |
| E | 800 | $0.01 | Systematic hold patterns — 8 capture patterns across 4 distinct hold counts × 100 hands each | 16 |

Total wagered: $1,053.00 (A: $30.00 · B: $10.00 · C: $1,000.00 · D: $5.00 · E: $8.00). Phase C ($10/hand) accounts for 95% of total wagered. The client seeds for phases A, B, C and E came from the capture script's `Math.random()` generator (DL-2); Phase D used one predictable seed (DL-3).

**Seed entries:** 115. 110 entries have bets and are hash-verified via the commit-reveal chain, covering all 5,400 bets; seeds[0] carries the first epoch's 50 bets. The capture reads each rotation's revealed seed from the last captured bet's transaction, so seeds[0]'s own `serverSeed` field is null: no captured bet preceded it. The capture rotated once more at the end of each phase: those 5 records (seeds 61, 82, 85, 97 and 114) carry 0 bets, and the seeds they commit are never revealed in the capture (no bet was placed on them). The next phase's opening rotation reads the same last bet, so 4 reveals repeat. Step 3 reports the same split. The capture script does not contain that phase-end rotation: its reference record `capture/capture.reference.js` ends each phase without rotating and sends the auditor's Phase D client seed on every Phase D rotation, while record 97 carries client seed `G4PfiIOyy6POq4F2`; records 61, 82, 85, 97 and 114 therefore come from a rotation the script does not perform, and it accounts for the other 110 records (the runnable `capture/capture.js` differs from the reference record only in its header, its wrapper line and its console API; compared in the private workshop, not checkable from this package) (each phase's opening rotation and a rotation each time the seed's nonce reached 50). All 115 records are rotation snapshots, one at every rotation (each epoch boundary, phase boundaries included): the capture recorded the active `serverSeedHashed` and the `nextServerSeedHash` from the rotation response, with a timestamp, and placed no bet until that rotation had returned (`capture/capture.reference.js` `doRotation`, then the main loop). These snapshots are the capture's pre-bet observations of each epoch's commitment. The deal and draw responses as recorded in the dataset carry no seed field (the capture kept selected response fields); each bet's `seed` block is the active seed state the capture read from `GET /api/v2/client-seed` after the round, and Step 3 checks that every bet recorded after a snapshot, up to the next one, carries the hash that snapshot recorded.

**Gap-filler script.** [capture/fill-gaps.reference.js](capture/fill-gaps.reference.js), the non-runnable reference copy of `capture/fill-gaps.js` (kept in the private workshop; compared there, the two are the same code apart from the header comment and the last lines, where the reference copy does not call the function), is a browser-console script written after the capture to recover the two rounds Step 4 finds missing. Its constants are the transaction IDs of the captured bets on either side of each gap: 556786892 and 556787618 (epoch `feec4f63`, Phase A, nonces 22 and 24) and 556931710 and 556932773 (epoch `6076267c`, Phase D, nonces 14 and 16). It pages `GET /api/v2/user/transactions`, fetches any transaction between those IDs and prints what it finds as JSON in the browser console, to be pasted by hand; it writes no file. **Was it ever run?** There is no record that it was, and nothing it could have produced is in the dataset: no captured bet has a transaction ID between either pair, Step 4 still finds both gaps, Step 27 counts 0 reconstructed hands, and the dataset is the same git blob (`d55ab5db…`) in every commit that holds it, from the first (2026-05-20 in the private workshop, 2026-05-21 in the public repository) to this release. No file in the auditor's working folders holds its output (searched 2026-10-19 for its output fields and for any transaction ID inside either gap). Whether it was ever pasted into a console cannot be established: it leaves no trace, and the git history starts on 2026-05-20, after the 24 April capture. It plays no part in the audit; the two rounds stay missing (DL-1).

| Input | Identity |
|---|---|
| [data/video-poker-dataset-5400bets.json](data/video-poker-dataset-5400bets.json) | SHA-256 `363fd4d4c072a1180ca2e7ab61d0c8dcc6f3300f315449af0d7101dd45dd0654` (pinned in `src/loader.ts`, checked at startup and by Step 14) |
| [videoPokerConfig.json](videoPokerConfig.json) | SHA-256 `9daedc8fc7a53e328d50b5e8019c177b32d5bf7992494a7da18136f524a70542` |

The bet total (A 3,000 · B 1,000 · C 100 · D 500 · E 800) is pinned as code in `src/loader.ts`. The pay table is operator-supplied, captured from `GET /api/v2/video-poker/config` (2026-04-23). Its hash is pinned in `src/loader.ts` beside the dataset, checked by the pre-flight and re-asserted by Step 14, and also recorded inside `outputs/optimal-play-rtp.json` as `duel.payTableHash` and re-checked by Step 26.

## Game and algorithm

Duel.com offers a single variant of Video Poker: Jacks or Better, standard 5-card draw poker. **The entire outcome is determined at deal time.** The 52-card deck is shuffled once, and the replacement pool is fixed before the player makes any hold decision.

1. **Deal.** The player places a bet. The server shuffles a 52-card deck using the committed HMAC-SHA256 key. The first 5 cards (positions 0–4) are the initial hand. The next 5 cards (positions 5–9), the **replacement pool**, are already determined; the player does not see them.
2. **Draw.** The player chooses which cards to hold, from all 5 (standing pat) to none. This is the only player decision. Discarded positions are filled from the pool in **left-to-right order**: the first discarded position gets pool card 0, the second pool card 1, and so on. Held cards remain at their original positions; if the player holds positions 0 and 3, positions 1, 2 and 4 receive pool cards 0, 1 and 2.

This mirrors a physical deck, where the cards that would replace discards already sit in a fixed order. The server cannot see what the player holds and then choose unfavourable replacement cards; the same (serverSeed, clientSeed, nonce) triple always produces the same deck; and the hold decision is genuine strategy.

### Hand rankings

Only pairs of Jacks or higher pay; pairs of 2 through 10 are losses.

| Rank | Hand | Description | Multiplier (tier 0) | Example |
|------|------|-------------|-----------|---------|
| 1 | Royal Flush | 10-J-Q-K-A, all same suit | 812.9719437907615x | 10H JH QH KH AH |
| 2 | Straight Flush | 5 consecutive ranks, same suit (not royal) | 58x | 5D 6D 7D 8D 9D |
| 3 | Four of a Kind | 4 cards of same rank | 26x | 8D 8H 8S 8C 2C |
| 4 | Full House | 3 of a kind + a pair | 9x | 7D 7H 7S KC KD |
| 5 | Flush | 5 cards same suit, not consecutive | 6x | 2D 5D 7D 9D KD |
| 6 | Straight | 5 consecutive ranks, mixed suits | 4x | 5D 6H 7S 8C 9D |
| 7 | Three of a Kind | 3 cards of same rank | 3x | 7D 7H 7S 2C 5D |
| 8 | Two Pair | 2 separate pairs | 2x | 8D 8H 3S 3C 7D |
| 9 | Jacks or Better | Pair of J, Q, K, or A | 1x | JD JH 3S 5C 7D |
| 10 | None (loss) | Anything below Jacks or Better | 0x | 10D 10H 3S 5C 7D |

These are the tier-0 multipliers of `videoPokerConfig.json`. They apply only to stakes from 0 up to tier 0's stored `max_bet` of 1182.855407010385761 (in whole cents, up to $1,182.85), which covers every captured bet. From $1,182.86 every line is scaled: the multiplier is the one in the stake's tier in E20, looked up as in [Verify a bet](#verify-a-bet) step 4 (see [Bet-size scaling](#bet-size-scaling)).

Boundary cases: a pair of 10s (or 9s) is a loss (0x), one rank below the threshold; a pair of Jacks, Kings or Aces pays 1x. Two pair with Jacks (JJ + 55) is two pair (2x), not jacks_or_better (1x): the higher-ranked hand takes precedence. Ace-low A-2-3-4-5 is a straight (4x), as is broadway 10-J-Q-K-A; wraparound Q-K-A-2-3 and 3-4-5-6-A are none (0x). A-2-3-4-5 suited is a straight flush (58x), as is 9-10-J-Q-K suited; only 10-J-Q-K-A suited is royal.

### Shuffle algorithm

HMAC-SHA256-driven Fisher–Yates shuffle of the 52-card deck with rejection sampling (bias-free indices, `maxFair` ceiling). After the initial 5-card deal, the player chooses a hold pattern (one of 32 subsets); the unheld cards are replaced by consuming the next positions from the same shuffled deck. The written specification is [docs/ALGORITHM.md](docs/ALGORITHM.md) (§2); `src/rng.ts` was rebuilt from it alone.

```
key       = hexDecode(serverSeed)
k         = 0                                     // counter
deck      = [card_0, card_1, ..., card_51]
for i in 51..1:
    range   = i + 1
    maxFair = floor(2^32 / range) * range         // rejection ceiling — removes modulo bias
    repeat:
        message = clientSeed + ":" + nonce + ":" + k
        value   = first 4 bytes of HMAC-SHA256(key, message), big-endian UInt32
        k      += 1
    until value < maxFair                         // a rejected value moves to the next counter
    j = value % range
    swap deck[j], deck[i]
dealt   = deck[0..4]
pool    = deck[5..9]                              // up to 5 replacement cards
final   = combine(dealt, held, pool)              // unheld positions consume pool L→R
payout  = bet × payoutTable[evaluateHand(final)]
```

**Why 51 HMAC calls per shuffle.** The backward sweep places one card at a time, from index 51 down to 1 (counter 0 … 50 when no value is rejected, as in every captured hand); the last step, range 2, is a coin flip. Each swap requires an independent random number, and a different counter gives a different message and hash, so the result is a uniformly random permutation. This is why the simulation is ~50x slower per round than single-HMAC games like Dice or Crash. A single 32-byte hash provides 256 bits, while 52! ≈ 2^226 permutations exist; the per-swap Fisher–Yates approach is the standard implementation for card/draw games.

**Key encoding.** The server seed is a 64-character hex string; the HMAC key is the **32-byte decoded value** (`Buffer.from(serverSeed, 'hex')`), not the 64-byte UTF-8 string. Step 5 recomputes all 5,400 bets with the hex-decoded key (0 mismatches); it does not try the UTF-8 form. Only a unit test (`tests/videoPoker/VideoPokerTests.ts`, "HMAC key must be hex-decoded") checks the UTF-8 form: on the pilot round's first HMAC message it gives a different HMAC from the hex-decoded key, and the hex-decoded key gives the pilot round's known deal.

**Rejection sampling.** Naive `value % range` is biased whenever `range` does not divide 2^32. Values ≥ `maxFair = floor(2^32 / range) × range` are rejected; the accepted values are evenly divisible by `range`, so `value % range` is uniform. The rejection zone is `2^32 mod range` values, largest at range 52: 48/2^32 ≈ 0.000001% of the value space. A rejected value moves the counter on, so `src/rng.ts` never runs out of values. Duel's Verify-tab code (E19, the second check below) handles a rejection differently: it reads up to 8 four-byte chunks of the same hash and throws if all 8 are rejected, at most (48/2^32)^8 ≈ 2.4 × 10⁻⁶⁴ per swap (range 52; every other range is lower), and its ceiling `0xFFFFFFFF - (0xFFFFFFFF % range)` also rejects the top `range` values when `range` is a power of two. The two agree whenever neither rejects. Neither ceiling rejected any of the 275,400 draws in the 5,400 captured hands, so the capture cannot tell the two continuations apart; [docs/ALGORITHM.md](docs/ALGORITHM.md) records this as open point O1. Off the capture they do differ: on revealed seed `d4cfa432…` with its captured client seed `UyP5jElKLpbeBopy` at nonce 20996, and on seed `a4764f4c…` with `N7yI44jUR2NcHQHr` at nonce 65303 (both found on 20 October 2026 among the Pass 2 simulation nonces, neither among the captured hands), a draw is rejected and `src/rng.ts` and Duel's Verify-tab code give different decks. Which rule Duel's server follows on a rejected draw is not established. The comments in the vendored site verifier (`verifier-parity/games/video-poker/derive.js`) still say ≈ 10^-75; that file is a byte-exact pinned copy and is not edited. Step 22 prints the exact bound: for every range 2…52 the ceiling is a whole number of ranges (bias exactly 0), and the rejection census over the capture is 275,400 swaps / 0 rejected chunks.

**Card encoding.** The unshuffled deck is the 52 cards in rank-major order, `['2D','2H','2S','2C','3D', …, 'AD','AH','AS','AC']` (`src/rng.ts` `ALL_CARDS`). Rank = floor(index / 4) + 2; suit = index % 4 (0 = Diamonds, 1 = Hearts, 2 = Spades, 3 = Clubs). The shuffle permutes this fixed starting arrangement.

**Worked shuffle.** Pilot round captured live, nonce 1: server seed `105bde0af7af90e305027ec61c2408cd48b5f9da7413cfbe652eef5eca68d127`, client seed `Ic5RYWpnRDXUQebq`. The first HMAC message is `Ic5RYWpnRDXUQebq:1:0` (cursor 0, i = 51, `value % 52` gives the swap index). After all 51 iterations, `deck[0..4] = ['10C', '2D', '3D', '6C', '7C']` (dealt hand) and `deck[5..9] = ['2C', '10H', 'KC', '8S', '7D']` (replacement pool). Recomputation with `src/rng.ts` produces the identical deck. Canonical code: `src/rng.ts` `computeShuffledDeckFromBuffer()` and `verifyHash()`.

**Where the RNG code comes from.** Since 20 October 2026 (v1.2.0) `src/rng.ts` is rebuilt from the written specification [docs/ALGORITHM.md](docs/ALGORITHM.md), which was written from Duel's public pages, the standard provably-fair construction and the 5,400 captured hands, without opening Duel's code (its §8 lists every file read). The implementer read only that specification and a module-interface file and never opened Duel's code. `tests/videoPoker/RngSpecTests.ts` runs the specification's own vectors and properties against it (80/80). Duel's own Verify-tab code for Video Poker (E19, captured 2026-04-23) is not the source: it is pinned with its runner in `src/operator-verifier.ts` and executed unedited as a second check, by Step 5 on all 5,400 hands (its deck[0..9] equals `src/rng.ts` on 5,400/5,400) and by the unit tests on the pilot rounds. Through v1.1.0 `src/rng.ts` was a port of that code and cited 13 of its lines; the port and the citation table were removed. Agreement with that code does not establish that the live panel is unchanged since its capture (DL-8).

### Seed lifecycle and API

Before each epoch the server commits to a hashed server seed; the player provides or accepts a client seed; each round uses `HMAC-SHA256(hex_bytes(serverSeed), clientSeed:nonce:cursor)`; Duel reveals the server seed only when the player rotates seeds, and every deck of that epoch can then be recomputed. This capture rotated once a seed's nonce reached 50 (`BETS_PER_EPOCH = 50` in `capture/capture.reference.js`): that 50-round epoch is the capture's rotation schedule, not Duel's. The `nextServerSeedHash` field shows the commitment for the next epoch; on rotation the server promotes it to the new active `serverSeedHashed`.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v2/video-poker` | POST | Deal a new hand (5 cards): `{ amount, currency, security_token }` → `hand_id`, `initial_cards`, `transaction_id`, `effective_edge` |
| `/api/v2/video-poker/{handId}/draw` | POST | Submit held cards: `{ held_cards }` → `final_cards`, `combination`, `multiplier`, `amount_won` |
| `/api/v2/client-seed` | GET | Retrieve active seed state (hashed server seed, client seed, nonce) |
| `/api/v2/client-seed/rotate` | POST | Rotate to a new seed pair, revealing the previous server seed |
| `/api/v2/user/transactions/{txId}` | GET | Retrieve transaction details including revealed server seed |
| `/api/v2/user/security/token` | POST | Refresh security token (expires ~10 min) |
| `/api/v2/video-poker/config` | GET | Retrieve pay table and game configuration |

The entire deck shuffle is determined at deal time; the draw phase only selects which predetermined cards replace discarded positions. Endpoint mapping is recorded in `capture/capture.reference.js`; the seed lifecycle in `src/rng.ts` and `src/loader.ts`; the two-phase round structure in `tests/videoPoker/VideoPokerTests.ts`.

### Draw replacement and hold patterns

```
For each position 0..4 in the dealt hand:
  if the card at this position is in held_cards:
    keep it (final_hand[pos] = initial_hand[pos])
  else:
    take the next card from the pool (final_hand[pos] = pool[poolIndex++])
```

For any dealt hand the player has 2^5 = 32 hold decisions: hold 0 (1 pattern, 5 pool cards used), hold 1 (5, 4), hold 2 (10, 3), hold 3 (10, 2), hold 4 (5, 1), hold 5 (1, 0). Step 21 verified the replacement logic for all 5,400 bets with 0 mismatches (`src/rng.ts` `computeFinalHand()`). Phase E stress-tested it with 8 capture patterns across 4 distinct hold counts, 100 bets each:

| Block | Pattern | Cards held | Pool cards used | What it proves |
|-------|---------|-----------|----------------|---------------|
| 0–99 | Hold none | 0 | 5 | final hand = pool[0..4]; initial hand completely replaced |
| 100–199 | Hold position 0 | 1 | 4 | pos 0 stays; pos 1,2,3,4 get pool[0..3] |
| 200–299 | Hold position 1 | 1 | 4 | pos 1 stays; pos 0,2,3,4 get pool[0..3] |
| 300–399 | Hold position 2 | 1 | 4 | pos 2 stays; pos 0,1,3,4 get pool[0..3] |
| 400–499 | Hold position 3 | 1 | 4 | pos 3 stays; pos 0,1,2,4 get pool[0..3] |
| 500–599 | Hold position 4 | 1 | 4 | pos 4 stays; pos 0,1,2,3 get pool[0..3] |
| 600–699 | Hold positions 0+2 | 2 | 3 | non-adjacent holds; pos 1,3,4 get pool[0..2] |
| 700–799 | Hold all 5 | 5 | 0 | standing pat; final hand = initial hand exactly |

Hold none catches a server that ignores the pool; the single positions catch an off-by-one at any position; the non-adjacent pattern checks pool order across gaps; hold all checks that standing pat returns the exact dealt hand. Step 25: all 800 Phase E bets verified with 0 mismatches.

### Hand evaluator

The independent hand evaluator (`src/hand-evaluator.ts`) was built from scratch without reference to the platform's code and cross-validated against the third-party `pokersolver` npm library on 10,000 random hands with 0 mismatches. Step 19 verified `evaluateHand(final_cards)` matches the server's `combination` for all 5,400 bets.

| Edge case | Our classification | pokersolver agrees | Server agrees |
|-----------|-------------------|-------------------|---------------|
| A-2-3-4-5 mixed suits | straight | Yes | Yes (all instances) |
| A-2-3-4-5 same suit (steel wheel) | straight_flush | Yes | Yes |
| Q-K-A-2-3 wraparound | none | Yes | Yes |
| 10-J-Q-K-A same suit | royal_flush | Yes | Yes |
| 9-10-J-Q-K same suit | straight_flush | Yes | Yes |
| Pair of 10s | none (below Jacks) | N/A (pokersolver doesn't split) | Yes |
| JJ + 55 (two pair with Jacks) | two_pair | Yes | Yes |
| AAA + 2 + 3 | three_of_a_kind | Yes | Yes |

The optimal strategy engine in `src/optimal-strategy.ts` is used in 9 unit tests to verify known strategy results (always hold a pat royal flush, break a pair to draw for a 4-to-royal). It is not used in the simulation, which is deal-only.

## Payouts and RTP

### Settlement and pay table

For each of the 5,400 bets: if `combination` is `none`, `multiplier` = 0 and `amount_won` = 0; otherwise `amount_won` = `amount_coins` × `multiplier`. `amount_coins` is the wager as the deal request states it (e.g. `"0.01"`), and `amount_won` is credited on the same grid. The comparison is exact: each money string is parsed to an integer count of 1e-18 units (BigInt, no floating point) and a win must satisfy `amount_won × 10^18 = amount_coins × multiplier` with no tolerance, so a served payout nudged by a single 1e-18 unit fails. (Until 2026-09-26 this was a relative tolerance of 1e-12 on parsed doubles.) Step 7: 1,196 wins validated, 4,204 losses validated as paying 0, 0 unparseable money fields. Step 8: on all 5,400 bets the served multiplier equals the `videoPokerConfig.json` value for its combination exactly (multipliers in the [hand rankings](#hand-rankings) table). Multiplier lookup: `tests/steps/payouts.ts`.

Live play finished on 9 of the 10 pay-table ranks; no royal_flush occurred in 5,400 hands, so that cell's multiplier is confirmed by the pinned config and the optimal-play computation, not by a live payout (DL-4). Step 11 records this in `outputs/payout-coverage.json` and asserts the paytable is non-increasing from royal flush to no-win.

The Royal Flush multiplier (812.9719437907615x) is slightly above the standard 800x of traditional 9/6 Jacks or Better machines. Duel's three modified multipliers (Royal 812.97x, SF 58x, 4K 26x vs standard 800x, 50x, 25x) lift optimal-play RTP from 99.5439% (standard 9/6) to exactly 99.9000% at tier 0, and shift the optimal strategy for some borderline hands.

**Zero Edge.** Duel.com labels this game "Zero Edge." At tier 0 the 0.1% house edge under optimal play is implemented by the pay table itself. `effective_edge` is the per-bet edge Duel reports, in percent. Every captured deal and draw shows 0.1, the tier-0 edge, which equals the pay table's own 0.1%; Step 10 verified all 10,800 `effective_edge` values (deal + draw) equal 0.1 exactly. The capture holds no rakeback records, so whether Duel returns edge as rakeback is outside this audit. That the field is the bet's tier edge and not an adjustment to the credited payout is premise P3 (ASSUMED).

**RTP claim.** Since 14 October 2026 (Methodology v1.1, decision D4) `outputs/rtp-claim-table.json` holds the tier-0 optimal-play RTP, the exact binary value of the pinned solve in `outputs/optimal-play-rtp.json` (0.9990000000028132, 99.900000%), against a flat 99.9% claim from the game settings, one of the RTP-CLAIM rule's six places (game page, fairness page, help page, bet panel, rules, game settings): house_edge `"0.001"` on scaling_edge tier id 1 of E20, the tier whose multipliers are the audited pay table. The rule (RTP-CLAIM 1.2.0) is switched on (decision D3): the outcome is scored on Step 26, the step carrying VP-19, and a house-side miss would make the verdict RTP FIGURE OVERSTATED (exit 5), never NOT PROVABLY FAIR, because the draws themselves pass. Outcome: pass, inside the 0.1 pp band. Tiers 1–51 are not tabled: this package has no optimal-play solve for their pay tables (DL-9). The "Zero Edge" label above is a zero-edge line, noted, not tested (D3).

### Bet-size scaling

The duel.com video-poker config as fetched 2026-10-05 in a logged-in session (read-only `GET /api/v2/video-poker/config`; E20) prices Video Poker in 52 bet tiers (`scaling_edge` entries `id` 1 to 52; tier 0 here is `id` 1). Tier 0 is the pay table audited here: 0.1% house edge for stakes from the stored `min_bet` of 0 up to the stored `max_bet` of 1182.855407010385761 (in whole cents, up to $1,182.85). The tiers are contiguous: each tier's `max_bet` is the next tier's `min_bet`, and E20 has no field saying which of the two tiers a stake exactly on that shared value takes. Each tier above adds 0.01% of edge, up to 0.61% on the last tier (stored `min_bet` 6159.020352732545689 to `max_bet` 6189.485121034804251, about $6,159.02 to $6,189.49). The scaled tiers narrow as the edge rises: tier 1 is $114.41 wide and tier 50 is $86.31; tier 51, the last, is $30.46. A Royal Flush at the last tier's 808.82163657x, staked at exactly its `max_bet` of 6189.485121034804251, returns a profit of $5,000,000.00 to the cent, and the configuration defines no tier above it. That Duel's game interface blocks larger bets was read from its front-end code on 2026-09-05; that code is not pinned in this package, and no larger bet was attempted.

Each tier multiplies every pay-table line by the same factor, (1 − tier edge) / 0.999, Jacks or Better included: all 520 multipliers in E20 (52 tiers × 10 ranks) equal the `videoPokerConfig.json` multiplier times that factor, rounded to 8 decimals. Each tier's `multipliers` is an unlabelled list of ten values from the lowest rank to the highest: none, Jacks or Better, Two Pair, Three of a Kind, Straight, Flush, Full House, Four of a Kind, Straight Flush, Royal Flush (the order under which all 520 match). From $1,182.86 a pair of Jacks or better pays slightly less than the stake: 0.9998999x at the first scaled tier, 0.99489489x at the top. E20's top-level `multipliers` equal `videoPokerConfig.json` exactly; its tier-0 entry carries the same ten values with the Royal Flush rounded to 8 decimals (812.97194379).

Scaling every payout by one factor does not change which hold is best for any hand, so the optimal-play RTP of each tier is the Step 26 figure times that factor. The Step 26 figure in E08 is 0.9990000000028132 (99.9000% at four decimals), so that product is 100% minus the tier's edge to within 0.000001 percentage points (largest gap 2.8 × 10⁻¹⁰ pp, at tier 0): 99.9000% at tier 0, 99.39% at the top tier. The 8-decimal rounding of the stored multipliers moves a tier's RTP by less than 0.000001 percentage points as well (each stored value is within 5 × 10⁻⁹ of the unrounded product). The enumeration in Step 26 therefore covers every tier.

All 5,400 captured bets ($0.01 and $10) were priced at tier 0: each was served the tier-0 multiplier for its hand (Step 8) and shows `effective_edge` 0.1 (Step 10). Tiers 1 to 51 are established from E20 and the enumeration, not from live bets (DL-9). E06, the configuration as captured on 2026-04-23, carries no tier list, so this package does not establish whether the higher tiers or the $5,000,000 limit were in force during the 24 April 2026 capture.

**Phase C stake independence.** 100 Phase C bets at $10/hand (vs $0.01 elsewhere) produce identical decks to $0.01 bets with the same seed triple, recompute to their final hand and rank, and are paid exactly by the same paytable cell; 18 of them are paying hands (Step 9, DL-5). The bet amount is not an HMAC input.

### Deal-only RTP and anti-circularity

Video Poker has two RTP concepts. **Deal-only RTP (33.72%)** is the expected return of the 5 dealt cards (`deck[0..4]`) scored as dealt, with no draw; it depends only on the RNG and the pay table, and it is what the simulation tests. **Optimal-play RTP (99.9000% at tier 0)** is the expected return under perfect strategy. The theoretical deal-only figure comes from independent combinatorial counts, not from any casino-supplied data:

| Hand | Multiplier | C(52,5) count | Deal probability | RTP contribution |
|------|-----------|---------------|-----------------|-----------------|
| Royal Flush | 812.9719437907615x | 4 | 0.000154% | 0.1251% |
| Straight Flush | 58x | 36 | 0.001385% | 0.0803% |
| Four of a Kind | 26x | 624 | 0.024010% | 0.6242% |
| Full House | 9x | 3,744 | 0.144058% | 1.2965% |
| Flush | 6x | 5,108 | 0.196540% | 1.1792% |
| Straight | 4x | 10,200 | 0.392465% | 1.5699% |
| Three of a Kind | 3x | 54,912 | 2.112845% | 6.3385% |
| Two Pair | 2x | 123,552 | 4.753902% | 9.5078% |
| Jacks or Better | 1x | 337,920 | 13.002124% | 13.0021% |
| None (loss) | 0x | 2,062,860 | 79.372518% | 0% |
| **Total** | | **2,598,960** | **100%** | **33.7238%** |

Step 16 enumerates all 2,598,960 five-card hands, classifies each with the independent evaluator, and requires every one of the 10 counts to equal the published count exactly; the deal-only RTP is then computed from the enumerated counts. A negative control (one hand moved between adjacent ranks, for each of the 10 ranks) is rejected 10/10. These probabilities apply to the initial deal only.

### Optimal-play RTP

The engine `src/compute-optimal-rtp.ts` uses the Wizard of Odds methodology with pre-aggregated inclusion-exclusion and no operator-supplied probability data:

1. **Score table:** evaluate all 2,598,960 five-card hands and store each hand's rank (0–9); the distribution is verified against the known counts. Time: ~0.1 seconds.
2. **Pre-aggregate:** for each k-card subset (k = 1, 2, 3, 4) of the deck, sum the multipliers of all 5-card hands containing it. Time: ~5 seconds.
3. **Per-hand optimal EV:** for each dealt hand evaluate all 32 hold patterns. Hold 0 starts from the multiplier sum over all 2,598,960 hands and holds 1–4 from the pre-aggregated sums; both use inclusion-exclusion corrections to subtract dealt-but-discarded cards from the draw pool, so the hold-0 EV depends on the dealt hand and is not the deal-only RTP; hold 5 is a single table lookup. The pattern with the highest EV is optimal. Time: ~40 seconds per pass.
4. **Aggregate:** average the per-hand optimal EVs over all 2,598,960 hands.

For a hold keeping cards K and discarding D, `EV(K) = (1/C(47, |D|)) × Σ mult[score[H]] for all 5-card H where K ⊂ H and H ∩ D = ∅`. Inclusion-exclusion computes this in O(2^|D|) additions instead of O(C(47,|D|)) lookups; for hold-1 (|D| = 4) it replaces 178,365 lookups with 16 additions. Direct enumeration would need C(47,5) = 1,533,939 draws for hold 0, 178,365 for hold 1, 16,215 for hold 2, 1,081 for hold 3, 47 for hold 4 and 1 for hold 5, approximately 2.6 million hand evaluations per dealt hand.

The engine identified **134,459 canonical classes** (same rank pattern and suit-relationship pattern) across all 2,598,960 dealt hands; every hand in a class has the same optimal hold and EV. Optimal hold count under Duel's pay table:

| Optimal hold | Hands | % of total |
|-------------|-------|-----------|
| Hold 0 (discard all) | 84,360 | 3.25% |
| Hold 1 | 403,968 | 15.54% |
| Hold 2 | 1,651,440 | 63.54% |
| Hold 3 | 148,392 | 5.71% |
| Hold 4 | 291,312 | 11.21% |
| Hold 5 (pat) | 19,488 | 0.75% |

| Metric | Standard 9/6 JoB | Duel.com |
|--------|-----------------|---------|
| Royal Flush | 800x | 812.9719437907615x |
| Straight Flush | 50x | 58x |
| Four of a Kind | 25x | 26x |
| Full House | 9x | 9x |
| Flush | 6x | 6x |
| All others | same as Duel | same as standard |
| **Computed RTP** | **99.543904%** | **99.900000%** (house edge **0.100000%**) |
| **Published RTP** | **99.5439%** — **PASS** (within ±0.0001% tolerance) | **99.9%**, Duel's game settings (house_edge `"0.001"` on tier 0, E20) — **PASS**, inside the 0.1 pp band (RTP-CLAIM, Step 26) |

The published 99.5439% comes from the Wizard of Odds (wizardofodds.com), Durango Bill, and the Ethier/Kim/Lee paper (arXiv:1602.04171, exact fraction 1,653,526,326,983 / 1,661,102,543,100); the engine reproduces it to 6 decimal places before being applied to Duel's pay table. The difference between the two tables reflects Duel's boosted royal_flush / straight_flush / four_of_a_kind multipliers. Computation time is about two minutes (60.6 s + 62.9 s for the two enumerations, measured 2026-09-26; wall-clock time is no longer written into the artifact). `npm test` reads the pinned `outputs/optimal-play-rtp.json` and asserts the headline figures against the published constants (Steps 26 and 28); `npm run compute-optimal-rtp` recomputes both RTP values from scratch.

### Captured returns

| Phase | Empirical post-draw RTP | Hold behaviour |
|-------|------|---------|
| A | 32.97% (n=3,000) | Random holds (each card independently 50% held), the closest to deal-only theoretical |
| B | 60.00% (n=1,000) | Targeted holds (hunting pairs, flushes): deliberate strategy inflates RTP |
| C | 27.00% (n=100) | $10/hand stake independence; high variance at small sample |
| D | 44.80% (n=500) | Custom auditor client seed |
| E | 40.13% (n=800) | Systematic patterns (mix of hold-0, hold-1, hold-all) |

The live-bet RTP ranges from 27% to 60% because it reflects player hold decisions and sample variance, not game fairness. These figures are informational; the authoritative optimal-play RTP is Step 26 and the deal-only steps (16–18) validate the deal distribution, not the RTP figure. Live hand ranks over the 5,400 hands: straight_flush 1, four_of_a_kind 2, full_house 15, flush 15, straight 27, three_of_a_kind 144, two_pair 294, jacks_or_better 698, none 4,204.

### Simulation

**Pass 1** is a single-config Fisher's-method test: 10 independent streams × 1,000,000 deal-only rounds (shuffle, take deck[0..4], classify, record rank), chi-squared on the 10-rank distribution per stream with tail pooling for low-count ranks, combined as **T = -2 Σ ln(p_i) ~ χ²(2K)**. The stream seed pairs are pinned in `src/simulate.ts` (`SIM_SEEDS`) and recorded in the artifact.

| Stream | χ² | df | p-value | Deal-only RTP |
|--------|-----|-----|---------|--------------|
| 0 | 2.79 | 8 | 0.9470 | 33.7783% |
| 1 | 10.13 | 8 | 0.2558 | 33.9553% |
| 2 | 8.05 | 8 | 0.4289 | 33.6137% |
| 3 | 5.61 | 8 | 0.6906 | 33.4908% |
| 4 | 6.63 | 8 | 0.5765 | 33.7638% |
| 5 | 7.68 | 8 | 0.4658 | 33.7676% |
| 6 | 9.21 | 8 | 0.3247 | 33.6854% |
| 7 | 8.56 | 8 | 0.3805 | 33.6398% |
| 8 | 7.39 | 8 | 0.4956 | 33.6640% |
| 9 | 6.70 | 8 | 0.5697 | 33.6400% |

No stream fails at α = 0.01. Fisher's T 14.61, df 20, p = 0.7982. Combined deal-only RTP 33.6999% against the theoretical 33.7238% (deviation −0.02%). Serial independence: lag-1 autocorrelation z = −0.74 (|z| < 3) and Wald–Wolfowitz runs p = 0.1000 (p ≥ 0.01), 0 failures; both are recomputed by the verifier from the 10 × 10 rank-transition census the artifact ships (its marginals reconcile exactly with the hand-rank counts). Dealt-card uniformity: how often each of the 52 cards reached each of the first 10 deck positions over the 10,000,000 deals is tested against the uniform 1/52 by chi-squared (df 51) at family level 0.01, Bonferroni 0.001 per position; all 10 positions pass, the smallest p is 0.0015 (the third dealt card, deck index 2; χ² 86.25).

**Pass 2** tests whether the casino selected its server seeds honestly. For each of the 110 revealed casino seeds, 100,000 rounds are simulated with the captured client seed and split into 2,000 disjoint windows of 50; window 0 (nonces 0–49) is the one used in live play, and its deal-only return is ranked among the 2,000. Decision rule (pre-registered, since 2026-09-26): under no cherry-picking window 0 is exchangeable with the other windows, so its rank is uniform (exact permutation null); the rank sums over the 110 seeds give Z, and cherry-picking is indicated at Z < −3.090 (one-sided α 0.001). The verifier re-derives every window from the shipped integer census and replays windows 0 and 1,999 of every seed from the revealed seed. The earlier screen (chi-squared on each seed's early window, flagged at p < 0.05) is still computed and reconciled but no longer decides.

| Metric | Value |
|--------|-------|
| Casino seeds tested | 110 |
| Nonces per seed | 100,000 |
| Total rounds | 11,000,000 |
| Captured-window rank-sum Z (decision rule) | −0.018 (critical −3.090) |
| Captured window below / above its seed's median | 50 / 60 |
| Detection power (≥ 50%) | ≥ 18.9% of seeds' captured windows in their worst decile |
| Seeds flagged (α=0.05) | 5 (~5.5 expected under H₀), binomial p 0.6485 |
| Aggregate χ²(9) | 6.2047, p 0.7193 |
| Aggregate RTP | 33.7329% |

No evidence of cherry-pick bias was found. The convergence chart [outputs/rtp-convergence.html](outputs/rtp-convergence.html) shows deal-only RTP approaching the theoretical value; at 10 million rounds the empirical RTP is within 0.02% of theoretical.

## Verification results

The audit evaluates the **5,400 hands captured on 24 April 2026 and the pinned pay table**. Its 28 scored steps report **27 PASS, one capture-origin FLAG and zero hard failures**: `PROVABLY FAIR — Full Pass`.

| # | Step | Result | Finding |
|---|------|--------|---------|
| 1 | Seed Hash Integrity | PASS | All 115 seed records walked directly: 110 revealed plaintexts hash to the preceding commitment, 4 phase-opening rotations (seeds 62, 83, 86, 98) reveal the previous phase's last bet-bearing seed instead, 1 unrevealed (retired pre-capture) |
| 2 | Commitment Linkage | PASS | All 114 nextServerSeedHash → next.serverSeedHashed links recomputed, plus the pre-capture anchor on the first epoch |
| 3 | Hash Consistency Within Epoch | PASS | Epochs keyed by the capture timeline, not by the bets' own hash: the bets of each of the 110 bet-bearing rotation records carry that record's committed serverSeedHashed and clientSeed; the other 5 records are end-of-phase rotations with no bets |
| 4 | Nonce Audit | FLAG (capture-origin, verdict-neutral) | 108/110 epochs clean, no duplicated nonce, and in all 110 epochs each nonce is above the one served before it in capture order (0 out of order); the 2 gaps match the capture plan exactly; 2 single-nonce capture-retry gaps — the initial deal for each is derivable from the revealed seed; the full missing rounds (hold, final hand, payout) are not verified |
| 5 | Outcome Recomputation | PASS | 5,400/5,400 decks + final hands recomputed with `src/rng.ts` (RNG code rebuilt from the written specification docs/ALGORITHM.md), and Duel's own Verify-tab file (E19) run unedited on all 5,400 as a second check, not the source (0 differ); the ProvablyFair.org docs-site player verifier (vendored, SHA-256 pinned in `src/site-verifier.ts`) run on all 5,400 bets with their recorded holds agrees on initial hand, final hand, hand rank and multiplier (0 differ) |
| 6 | Client Seed Influence | PASS | All 500 sampled bets produce a different deck under a wrong client seed — no exceptions permitted |
| 7 | Payout Math | PASS | amount_won = amount_coins × multiplier EXACTLY on the served decimal strings (integer 1e-18 units, no tolerance) — 1,196 wins validated, 4,204 losses pay 0 |
| 8 | Multiplier Provenance | PASS | the served multiplier equals the videoPokerConfig.json value for its combination exactly (no tolerance) on all 5,400 bets |
| 9 | Phase C Bet-Size Invariance | PASS | 100 $10/hand bets produce identical decks to $0.01 bets, recompute to their final hand and rank, and are paid exactly by the same paytable cell; 18 of them are paying hands |
| 10 | House Edge Audit | PASS | all 10,800 effective_edge values (deal + draw) equal 0.1 exactly |
| 11 | Config Completeness & Payout-Cell Coverage | PASS | Single config (Jacks or Better), all 10 hand ranks carry a multiplier; live play finished on 9 of them — royal_flush never occurred (see `outputs/payout-coverage.json`); the paytable is non-increasing from royal flush to no-win |
| 12 | Epoch Size | PASS | 110 epochs matching the pinned size histogram exactly: 106 of 50, 2 of 49, 2 of 1 |
| 13 | Population & Phase Labels | PASS | 5,400 bets / 115 seeds match the capture plan in `src/loader.ts`; `meta.phaseBetCounts` reconciled against it |
| 14 | Dataset Hash | PASS | the dataset and `videoPokerConfig.json` SHA-256 both match their pins in `src/loader.ts` (both also checked before any step runs) |
| 15 | Phase D Client Seed Variation | PASS | All 500 Phase D bets recomputed under one auditor-chosen client seed (`pfauditmod66jae`), not among the Phase A seeds (DL-3) |
| 16 | Anti-Circularity | PASS | All C(52,5) = 2,598,960 hands enumerated and classified by the independent evaluator; each of the 10 rank counts equals the published combinatorial count exactly. Deal-only RTP = 33.7238% from those counts; a negative control (one hand moved between adjacent ranks, for each of the 10 ranks) is rejected 10/10 |
| 17 | Simulation Pass 1 | PASS | 10M rounds, Fisher's p=0.7982, 0 serial fails |
| 18 | Pass 2 Cherry-Pick Detection | PASS | rank-sum Z −0.018 vs −3.090 (captured window among 2,000 per seed, exact permutation null); 5/110 chi-squared flags reconciled (binomial p=0.6485) |
| 19 | Hand Classification Accuracy | PASS | evaluateHand(final_cards) matches server combination for all 5,400 bets (count bound to the capture plan) |
| 20 | Hold Validity | PASS | held_cards ⊆ initial_cards for all 5,400 bets (count bound to the capture plan) |
| 21 | Replacement Pool Determinism | PASS | Non-held positions consume deck[5..9] L→R — 5,400/5,400 recomputed, 0 unrevealed |
| 22 | Deck Integrity | PASS | deck[0..9] = 10 unique valid cards — 5,400/5,400 recomputed, 0 unrevealed; draw-bias bound: for every range 2…52 the rejection ceiling is a whole number of ranges (bias exactly 0), rejection census 275,400 swaps / 0 rejected chunks |
| 23 | Card Rank Distribution | PASS | 13 ranks uniformly distributed across initial deals |
| 24 | Card Suit Distribution | PASS | 4 suits uniformly distributed across initial deals |
| 25 | Phase E Hold Pattern Coverage | PASS | 800/800 Phase E bets recomputed; the 8 planned hold patterns × 100 bets each match the capture plan exactly |
| 26 | Optimal-Play RTP Verification | PASS | 99.9000% (exhaustive C(52,5), cross-validated against 9/6 JoB at 99.5439%); headline figures asserted against the published constants. Since 14 October 2026 (C3) the optimal-play figure fails here only above the published 99.900000% (and when `rtpPercent` is not `duel.rtp` to 6 dp); below it is an RTP-CLAIM miss on this step (RTP FIGURE OVERSTATED, exit 5) |
| 27 | Reconstructed Hands Disclosure | PASS | 0 reconstructed hands |
| 28 | Artifact Integrity | PASS | `optimal-play-rtp.json`, `simulation-results.json`, `rtp-convergence.html` match their SHA-256 pins in `src/artifact-pins.ts` |

Additions of 2026-09-26 (profile wiring): Step 5 also runs the ProvablyFair.org docs-site player verifier (vendored under `verifier-parity/`, pinned in `src/site-verifier.ts`) on all 5,400 hands; Step 9 also checks each Phase C hand's final hand, rank, paytable cell and exact payout; Step 11 also asserts the paytable is non-increasing by rank; Step 14 (and the pre-flight) also pin `videoPokerConfig.json`; Step 16 carries a negative control; Steps 19 and 20 are bound to the population; Step 22 prints the exact draw-bias bound and the rejection census. Each step's profile check (VP-nn) is emitted from `src/profile-map.ts`.

**The nonce flag:** 108 of 110 epochs have clean sequential nonces (0 through N-1 with no gaps), and no nonce is duplicated anywhere. Since 19 October 2026 Step 4 also checks order: in each epoch, taken in capture order (each bet's timestamp), every nonce must be above the one served before it, so a sequence served out of order fails even though its sorted set has no gap (mutation M04c); 0 of 110 epochs are out of order. 2 epochs have single-nonce capture-retry gaps — the number the capture plan pins in `src/loader.ts`; one more or one fewer fails Step 4.

| Epoch | Missing nonce | Initial deal derivable from the revealed seed |
|-------|--------------|--------------------------|
| `feec4f63` | 23 | AC,7S,6S,5S,10S → none |
| `6076267c` | 15 | KS,7H,4S,3S,QD → none |

At each gap the nonce was consumed (a gap in the sequence); the round itself is not in the capture. The revealed plaintext hashes to the epoch's commitment, so the initial deal at that nonce is derivable from it; the hash match is a consistency check. That this deal was fixed before the round rests on the capture's rotation snapshot, which recorded the commitment before the epoch's first bet (capture integrity assumed, P5). It does not show what the player held, the final hand or the payout, because no request or response for that round was captured — so the full round is not verified, and Step 4 reports a capture-origin FLAG rather than a PASS.

**Card distribution (Steps 23–24):** across 5,400 initial hands (27,000 dealt cards), each of the 13 ranks is expected ≈ 2,077 times and each of the 4 suits 6,750 times; both chi-squared goodness-of-fit tests pass (`outputs/chi-squared-results.json`). These live tests have limited power and are confirmatory; the 10M-round simulation is the authoritative statistical validation. Live serial independence is informational (underpowered at n~50/epoch).

**Deck integrity (Step 22):** for each bet the 10-card set deck[0..9] contains 10 unique cards, all members of the standard 52-card deck (`ALL_CARDS`): no impossible cards, no duplicates, no out-of-range values.

### Exploit testing

No exploitable vulnerabilities were found. The report's own S1–S10 failure-mode matrix:

| Test ID | Category | What was tested | Result | Finding summary |
|---------|----------|----------------|--------|-----------------|
| S1 | Seed Prediction | Can the server seed be predicted before reveal? | Pass | 110/110 hashes verified; predicting a seed would require breaking SHA-256 preimage resistance |
| S2 | Outcome Manipulation | Can the server change the deck after dealing? | Pass | All 5,400 decks recomputed from committed seeds; 0 mismatches |
| S3 | Client Seed Bypass | Is the client seed actually used in the HMAC? | Pass | 500 sampled bets recomputed with a wrong client seed (`'wrong-client-seed-test'`): 100% produce different decks; Phase D's 500 bets recompute under the auditor-chosen seed |
| S4 | Nonce Manipulation | Can the server reuse or skip nonces? | Pass | 108/110 epochs clean, no nonce duplicated; 2 single-nonce capture-retry gaps whose initial deal is derivable from the revealed seed (full missing rounds not verified); no server-side manipulation. Step 4 itself is a capture-origin FLAG (verdict-neutral) |
| S5 | Modulo Bias | Does the swap index selection have bias? | Pass | maxFair = floor(2^32 / range) × range; rejection zone at most 48/2^32 (range 52); a rejected value moves to the next counter; 0 of 275,400 captured draws rejected |
| S6 | Bet-Size Influence | Does bet amount affect the shuffle? | Pass | 100 Phase C ($10) bets produce identical decks to $0.01 bets. The stake does change the pay table from $1,182.86, by design (the duel.com config as fetched 2026-10-05 in a logged-in session, read-only GET; E20; [Bet-size scaling](#bet-size-scaling)) |
| S7 | Draw Manipulation | Can the server change replacement cards after seeing holds? | Pass | deck[5..9] recomputed for all 5,400 bets; pool is fixed at deal; 800/800 Phase E bets verify across the 8 patterns |
| S8 | Hand Misclassification | Does the server report wrong hand ranks? | Pass | 5,400/5,400 hand classifications match; cross-validated with pokersolver; all boundary cases tested |
| S9 | Cherry-Pick Seeds | Does the server select biased seeds from a larger pool? | Pass | captured-window rank-sum Z −0.018 vs −3.090; 5/110 chi-squared flags (binomial p=0.6485); consistent with random noise |
| S10 | Payout Manipulation | Does the server pay the correct amount? | Pass | 1,196 wins and 4,204 losses verified exactly (integer 1e-18 units, no tolerance); 5,400/5,400 multipliers match `videoPokerConfig.json`; 0 errors |

S5: fairness-integrity matrix; game-integrity testing not commissioned.

The framework's standardized S5 rows map onto them as follows (added 2026-09-26; every result is tied to a scored step run on the pinned dataset).

<!-- S5-MATRIX:START -->
| ID | Attack | Result | Evidence |
|----|--------|--------|----------|
| S5-1 | Seed substitution | Pass | 110 revealed seeds hash to their commitments; forward chain intact over 114 links with the pre-capture anchor. [Steps 1, 2] |
| S5-2 | Client-seed manipulation | Pass | 500/500 sampled bets change deck under a wrong client seed; 500 Phase D bets recompute under an auditor-set seed. Disclosed: A/B/C/E seeds from `Math.random()` (DL-2), one predictable Phase D seed (DL-3). [Steps 6, 15] |
| S5-3 | Stake-conditional outcome | Pass | 100 Phase C bets at $10 recompute identically and are paid by the same paytable cell exactly (18 paying hands, DL-5). [Step 9] |
| S5-4 | Server-seed cherry-picking | Pass, limited power | Pass 2: 110 seeds × 100,000 nonces, captured window ranked among 2,000 per seed, rank-sum Z −0.018 vs −3.090, every window re-derived in verify and windows 0 / 1,999 replayed from the revealed seeds; power ≥ 50% at 18.9% of seeds' captured windows in their worst decile; the structural defence is the player-set client seed. [Step 18] |
| S5-5 | Seed-rotation race (TOCTOU) | Not tested | Instant-settle deal/draw with a pre-committed deck; no rotation-race probe was run. |
| S5-6 | Multiplier tampering | Pass | Served multiplier = pinned paytable exactly on 5,400/5,400; payouts exact to 1e-18. [Steps 7, 8] |
| S5-7 | Nonce manipulation | Pass (2 capture-retry gaps disclosed) | 108/110 epochs clean; 2 capture-origin gaps (DL-1). [Step 4] |
| S5-8 | Range-mapping bias | Pass | Rejection ceiling is a whole number of ranges for every range 2…52 — bias exactly 0; 0 rejected chunks in 275,400 swaps. [Step 22] |
<!-- S5-MATRIX:END -->

## Reproduce the audit

Use **Node.js 22.x**, as pinned by `.nvmrc` and `package.json` `engines`. The committed artifacts in `outputs/` were produced on that line, and the last bits of a derived floating-point statistic are runtime-dependent. Dependencies come from the included lockfile (`pokersolver` at runtime; `mocha`, `ts-node`, `typescript`, `chart.js` and type packages for development). Run from the package directory:

```sh
npm ci
npm test
```

This runs the **58 Mocha unit tests** (`tests/**/*Tests.ts`: RNG, hand evaluator, optimal strategy, draw replacement, the specification self-test added 2026-10-20, and 1 test that runs Duel's Verify-tab code as a second check), then the 28 scored verification steps against the captured dataset and the committed artifacts, then the reproduction gate. Expected: `58 passing`; `Passed: 27/28`; `Hard fails: 0`; `Flags: 1 (0 verdict-affecting, 1 capture-origin)`; `VERDICT: PROVABLY FAIR — Full Pass`; `Committed artifacts NOT modified.`; `REPRODUCED`; exit 0. The verifier also prints 4 informational context items (not scored). The release manifest records a measured `npm test` wall time of 28 s on an Apple M2 Max on 2026-09-28; runtime varies by machine.

| Command | Purpose |
|--------|---------|
| `npx mocha` | 58 unit tests — RNG specification self-test, RNG, hand evaluator, strategy, draw, operator code (second check) |
| `npm run verify` | 28 verification steps against dataset + reproduction gate |
| `npm run simulate` | Monte Carlo Pass 1 (10,000,000 deal-only rounds) + Pass 2 (11,000,000 casino-seed rounds), written to `outputs/run/` |
| `npm run compute-optimal-rtp` | Exhaustive C(52,5) enumeration (about two minutes, measured 2026-09-26); writes to `outputs/run/` |
| `npm run test:full` | Unit tests → simulation → optimal-play enumeration → verification, scoring each product against its committed artifact at tolerance |
| `npm run report` | `PF_EMIT=1 npm run verify` — rewrites the committed verifier artifacts in `outputs/` |
| `npm run mutate` | Runs `tests/mutations.json` in a disposable copy |

| File | Produced by | Guard | Content |
|------|-------------|-------|---------|
| `outputs/optimal-play-rtp.json` | `PF_EMIT=1 npm run compute-optimal-rtp` | SHA-256 pin in `src/artifact-pins.ts`, Step 28 | Exact optimal-play RTP (99.9000%) + 9/6 cross-validation (99.5439%) |
| `outputs/simulation-results.json` | `PF_EMIT=1 npm run simulate` | SHA-256 pin, Step 28 | Pass 1 (10 streams × 1M, Fisher's method) + Pass 2 (110 seeds × 100K nonces) |
| `outputs/rtp-convergence.html` | `PF_EMIT=1 npm run simulate` | SHA-256 pin, Step 28 | Deal-only RTP convergence chart |
| `outputs/verification-results.json` | `PF_EMIT=1 npm run verify` | reproduction gate — every field vs a fresh run | All 28 step results |
| `outputs/determinism-log.json` | `PF_EMIT=1 npm run verify` | reproduction gate | Outcome recomputation stats |
| `outputs/chi-squared-results.json` | `PF_EMIT=1 npm run verify` | reproduction gate | Card-rank and card-suit chi-squared tables (Steps 23–24) |
| `outputs/payout-coverage.json` | `PF_EMIT=1 npm run verify` | reproduction gate | Pay-table ranks exercised by live play and the uncovered deal-stage RTP share (Step 11) |

### The gate

Neither `npm run verify` nor `npm run simulate` writes into `outputs/` without `PF_EMIT=1`. This run's results, its determinism log, its chi-squared table, its payout-coverage table, a re-derived simulation and `diff.json` go to `outputs/run/` — gitignored, a run record rather than audit evidence — so a re-run cannot replace the evidence it scores and a disagreement between two runs is recorded rather than resolved in favour of whichever ran last. The artifacts the verifier does not itself produce are pinned by SHA-256 and hashed by Step 28; a missing or altered one is a hard fail, and refreshing one of them means re-pinning it in the same commit.

`outputs/run/diff.json` compares this run against the committed artifacts field by field and records the runtime it ran on. The comparison is at tolerance — **1e-14 absolute + 1e-12 relative**, and two distinct integers never agree — so a derived statistic that moved by a unit in the last place is recorded as `withinTolerance` and not scored, while anything outside that bound is a different result. The SHA-256 dataset guard is unchanged and remains the identity of the captured bytes; it is never rewritten to make a run agree with it.

| Code | Meaning |
|------|---------|
| `0` | `PROVABLY FAIR — Full Pass`, and this run reproduces the committed artifacts |
| `1` | at least one hard fail, **or** a reproduction difference beyond tolerance |
| `2` | at least one operator-origin FLAG — `PROVABLY FAIR — Conditional Pass`. A capture-origin FLAG (Step 4's capture-retry gaps) is printed and recorded but is verdict-neutral and exits `0` |
| `5` | `RTP FIGURE OVERSTATED`: no draw check failed, but the RTP-CLAIM rule (1.2.0, switched on) found settings beyond the 0.1 pp band on the house side of the published figure. It outranks a Conditional Pass; a hard fail (exit 1) outranks it |

For deliberate artifact maintenance only, `PF_EMIT=1 npm run simulate`, `PF_EMIT=1 npm run compute-optimal-rtp` and `PF_EMIT=1 npm run verify` (`npm run report`) overwrite the committed copies. A refreshed pinned artifact must be re-pinned in `src/artifact-pins.ts` in the same commit; `npm run release-manifest` then regenerates `RELEASE-MANIFEST.json` and `node scripts/release-manifest.mjs --check` confirms it is current. The release generator requires both README.md and MANIFEST.md and checks their audit ID.

**Mutation battery:** the latest run is `npm run mutate` on 2026-10-20 (Apple M2 Max, 12 cores, Node 22.23.1; baseline verify and mocha exit 0), the whole registry of 50 entries in one run on the tree carrying the RNG rebuilt from docs/ALGORITHM.md: 50/50 mutations killed, 28/28 scored steps have a killing mutation, no declared survivors; the release manifest records that run. Earlier runs: 51/51 on 2026-10-19 (with M05f, retired on 20 October with the citation table), 46/46 on 2026-09-28 and on 2026-10-14 (first pass), 50/50 on the evening of 2026-10-14 (second pass, see the release-history entry "14 October 2026 (second pass)").

### Fresh-clone reproduction record

| Field | Value |
|---|---|
| Date | 2026-09-26 |
| Source | `git clone git@github-pf:ProvablyFair-org/pf-duel-workspace.git` (origin), HEAD `8f136585aa52ab2805ce9d2aba396a2745514bc6`; this package last changed in `6a2dfe2` |
| Runtime | Node v22.23.1 (`engines` 22.x) |
| `npm ci` | exit 0 |
| `npm test` | exit 0 — `56 passing`, `Passed: 27/28`, `Flags: 1 (0 verdict-affecting, 1 capture-origin)`, `VERDICT: PROVABLY FAIR — Full Pass`, `REPRODUCED` |
| `npm run test:full` | exit 0 — same lines; the simulation regenerated into `outputs/run/`: `rtp-convergence.html` byte-identical to the committed copy, `simulation-results.json` identical apart from its `generatedAt` line; `outputs/run/diff.json` `reproduced: true` |
| Tree after the run | no tracked file modified |
| Scope | the committed tree of `6a2dfe2`. The changes of 26 September round 2 (run metadata removed and artifacts re-pinned, Duel's Verify-tab code, simulation re-derivation) were verified in the working copy: the regenerated `simulation-results.json` from this clone, with its `generatedAt` line deleted, equals the re-pinned artifact byte for byte |

## Verify a bet

1. **Save the commitment, then find the reveal.** Duel's in-game Provably Fair panel shows the active server seed (hashed) before you play (evidence E15, illustrative). **Save that value** outside Duel before your first hand on the seed pair. After you rotate the seed pair, the hand opened from your Transactions list shows its client seed, the revealed `serverSeed` and the nonce on its Verify tab (evidence E16).
2. **Which fields to paste.** `serverSeed`, `clientSeed` and the hand's `nonce`, plus the cards you held (`held_cards`).
3. **The exact commitment encoding.** `SHA-256(hexDecode(serverSeed))` must equal the `serverSeedHashed` you saved in step 1; the seed is hex-decoded to bytes before hashing. Compare against your saved copy, not against a hash shown to you after the reveal. A match (a verifier's PASS) means the two hashes are equal: the revealed seed is the one behind the hash you saved. The assurance that the seed was fixed before you played comes from your saved record, made before the bet, not from the match.
4. **The deal and draw.** For counter k = 0 … 50, `HMAC-SHA256(key = hexDecode(serverSeed), message = clientSeed + ":" + nonce + ":" + k)` drives one backward Fisher–Yates swap ([Shuffle algorithm](#shuffle-algorithm); a rejected value, which no captured hand has, moves k on by one); `deck[0..4]` is the deal, the non-held positions are filled from `deck[5..9]` left to right, and the final hand is paid `stake × multiplier` for its rank, from the pay table of the stake's tier. `videoPokerConfig.json` (the [hand rankings](#hand-rankings) table) is the tier-0 pay table only: it applies to stakes from 0 up to tier 0's stored `max_bet` of 1182.855407010385761 (in whole cents, up to $1,182.85), which covers every captured bet ($0.01 and $10). For any other stake, use the pay table of that stake's tier in [E20](evidence/config/duel-video-poker-config-2026-10-05.captured.json): in `data.scaling_edge`, find the entry whose `min_bet` ≤ stake ≤ `max_bet`, and read its `multipliers`, ten values from the lowest rank to the highest (none, Jacks or Better, Two Pair, Three of a Kind, Straight, Flush, Full House, Four of a Kind, Straight Flush, Royal Flush; [Bet-size scaling](#bet-size-scaling)).

   *Configuration example, not a recorded bet:* a $1,200 Jacks or Better hand. $1,200 lies in tier 1 (E20 `id` 2: `min_bet` 1182.855407010385761 to `max_bet` 1297.265863353965642, `house_edge` 0.0011), whose Jacks or Better multiplier is 0.9998999, so the hand pays $1,200 × 0.9998999 = $1,199.87988, not the $1,200 the tier-0 table would give.

The ProvablyFair.org verify-bets page runs the same derivation; Step 5 runs its code on every captured hand. In the vendored copy Step 5 runs, the multiplier comes from one fixed pay table (`verifier-parity/games/video-poker/paytables.js`) whose ten values equal `videoPokerConfig.json`, with no stake input, so the multiplier it returns is the tier-0 multiplier and gives the payout only for a stake in tier 0; for any other stake, take the multiplier from the stake's tier in E20 as in step 4. Duel's public Provably Fair verify page also shows the five initial cards and the next five cards in the deck (E17). After each session, rotate your client seed and verify your previous hands with the revealed server seed; setting your own client seed in the fairness panel contributes your own input (Phase D confirmed that custom client seeds are genuine HMAC inputs).

**Worked example (Phase A, nonce 1):** server seed hash `107cca7f92491e65e438a779d79dd253a16ccfef10d5ce5d31d2bcbb3ff22f7b`, client seed `cpc4ihmPtvpHpapv`, messages `cpc4ihmPtvpHpapv:1:{cursor}`.

```
initial_hand = deck[0..4] = ['KH', '10C', '3H', 'QD', 'JC']
pool         = deck[5..9] = ['2H', '10S', 'KC', '7D', ...]
held         = ['KH']                                  // position 0; positions 1–4 discarded
final_hand   = ['KH', '2H', '10S', 'KC', '7D']         // pool[0..3] fill positions 1–4
```

KH + KC is a pair of Kings, so **Jacks or Better** (1x; the $0.01 stake is in tier 0): `amount_won = $0.01 × 1 = $0.01`. Every value was recomputed from the revealed server seed and matches the server's output exactly. From the same epoch, nonce 37: initial `['8H', '6C', '4H', '10S', '8D']` (pair of 8s), held `['6C']`, final `['2H', '6C', '2S', '6S', '6H']` — three 6s and a pair of 2s, Full House (9x); the server's `full_house` classification and multiplier `9` are correct.

## Evidence

The primary evidence is the 24 April 2026 capture of 5,400 hands, its revealed seeds and the pinned pay table. Screenshots illustrate particular interface states; no step reads or hashes an image.

| ID | File | Evidence and role |
|----|------|-------------------|
| E01 | [outputs/verification-results.json](outputs/verification-results.json) | Complete results of all 28 verification steps: step number, name, status (PASS/FLAG/FAIL), detail string and, where the step measures something, a `data` block. Generated by `PF_EMIT=1 npm run verify`; a plain `npm run verify` writes to `outputs/run/` and compares against this file |
| E02 | [outputs/determinism-log.json](outputs/determinism-log.json) | Outcome recomputation summary: 5,400 verified, 0 mismatches, 0 skipped |
| E03 | [outputs/simulation-results.json](outputs/simulation-results.json) | Pass 1 (10 streams × 1,000,000 rounds, Fisher's combined p=0.7982) and Pass 2 (110 seeds × 100,000 nonces, captured-window rank-sum Z −0.018; 5 chi-squared flags, binomial p=0.6485; census rows for serial, dealt-card and window statistics). Generated by `npm run simulate` |
| E04 | [outputs/rtp-convergence.html](outputs/rtp-convergence.html) | Self-contained HTML chart of deal-only RTP convergence across 10,000,000 simulated rounds: blue line (empirical), red dashed (theoretical 33.72%) |
| E05 | [outputs/chi-squared-results.json](outputs/chi-squared-results.json) | Live-bet card-rank (13 ranks) and card-suit (4 suits) chi-squared details across all 27,000 initially dealt cards — labels, observed and expected counts, χ², degrees of freedom and p-value (Steps 23 and 24) |
| E06 | [videoPokerConfig.json](videoPokerConfig.json) | The tier-0 pay table, extracted from `GET /api/v2/video-poker/config` on 2026-04-23 with auditor notes: all 10 hand rank multipliers for the Jacks or Better variant. The full response of the same endpoint, as fetched 2026-10-05 in a logged-in session (read-only GET) and including the bet-size tiers, is E20. The file's notes, and the header of the vendored site verifier's `verifier-parity/games/video-poker/paytables.js` (a byte-exact copy, not edited), predate E20 and premise P3: where they say there are no alternative pay tables, or read `effective_edge` as a rakeback refund, [Bet-size scaling](#bet-size-scaling) and P3 apply |
| E07 | [data/video-poker-dataset-5400bets.json](data/video-poker-dataset-5400bets.json) | 5,400 hands across 5 phases (A–E) with 115 seed entries; SHA-256 `363fd4d4c072a1180ca2e7ab61d0c8dcc6f3300f315449af0d7101dd45dd0654` |
| E08 | [outputs/optimal-play-rtp.json](outputs/optimal-play-rtp.json) | Exhaustive optimal-play RTP: Duel RTP = 99.900000%, cross-validated against standard 9/6 JoB at 99.543904%; 134,459 canonical hand classes. Generated by `npm run compute-optimal-rtp` |
| E09 | [video-poker-ui.png](video-poker-ui.png) | Screenshot of the Video Poker game interface on Duel.com |
| E10 | [video-poker-dealt.png](video-poker-dealt.png) | Screenshot showing a dealt 5-card hand before the draw phase |
| E11 | [video-poker-result.png](video-poker-result.png) | Screenshot showing the final hand after the draw phase with payout |
| E12 | [outputs/payout-coverage.json](outputs/payout-coverage.json) | Which of the ten pay-table ranks live play finished on, and the deal-stage payout mass resting on the one it never produced (royal_flush, with its exact C(52,5) deal-stage probability and multiplier). Step 11 |
| E13 | [src/artifact-pins.ts](src/artifact-pins.ts) | SHA-256 pins for the three artifacts of record the verifier does not itself produce — `outputs/optimal-play-rtp.json`, `outputs/simulation-results.json`, `outputs/rtp-convergence.html`. Recomputed and compared by Step 28; a mismatch is a hard fail |
| E14 | [evidence/step1-game-ui.png](evidence/step1-game-ui.png) | The table after a completed round: the pay table (Royal Flush 812x down to Pair of Jacks or Better 1x), a 0.1 stake, the final hand 4♠ A♥ 2♥ 3♣ 5♦ paid as a Straight at 4.00x, and the "Zero Edge" and "Provably Fair" links in the game footer. Captured via browser session during live play |
| E15 | [evidence/step2-fairness-page.png](evidence/step2-fairness-page.png) | Illustrative. The in-game Provably Fair panel: active client seed, active server seed (hashed), current nonce, the pre-filled "New client seed" field, the next server seed (hashed) and the "Rotate seed" action, i.e. where a player reads the commitment before betting. The active and next hashes it shows (`775d72be01795fb6…`, `e66aa5107d67d8e8…`) appear in none of the 115 seed records, so no captured bet was played on that seed and the image is not timing evidence for any captured bet |
| E16 | [evidence/step3-transaction-reveal.png](evidence/step3-transaction-reveal.png) | A Video Poker bet opened from the account's Transactions list on its Verify tab, showing the client seed, the revealed (plaintext) server seed and the nonce for that round after rotation |
| E17 | [evidence/step4-verification-result.png](evidence/step4-verification-result.png) | Duel's public Provably Fair verify page with those inputs entered: the Game Result panel shows the five initial cards (4♠ A♥ 2♥ 3♣ 5♦) and the next five cards in the deck (Q♥ Q♦ 7♦ 4♦ 10♠), alongside the JavaScript verification code the page exposes |
| E18 | [evidence/client-seed-origin.png](evidence/client-seed-origin.png) | Annotated excerpt of duel.com's live JavaScript bundle showing how the default client seed is generated: 16 characters drawn from a 63-character alphabet (A–Z a–z 0–9 _) via rejection-sampled `crypto.getRandomValues`, filled client-side by the seed-rotation component and sent to the server only on "Rotate seed". Captured 2026-06-03 |
| E19 | [evidence/verify-tab/duel-verify-tab-video-poker-2026-04-23.captured.json](evidence/verify-tab/duel-verify-tab-video-poker-2026-04-23.captured.json) | The JavaScript in the code panel of duel.com → Provably Fair → Verify with Video Poker selected, captured 2026-04-23 during a browser session on duel.com, saved as a single JSON string literal (3,433 bytes, SHA-256 `f7e0278766eb6407053fe1a6a6ce2072b1a247097d9f27915a3ebb9d21269c87`); decoded, it is 103 lines beginning `// Code written in javascript`. Brought into this package byte for byte on 2026-09-26 from the auditor's working folder; pinned with its runner in `src/operator-verifier.ts`, executed unedited by Step 5 on all 5,400 hands and by the unit tests on the pilot rounds as a second check (VP-09). Through v1.1.0 `src/rng.ts` was ported from it and cited it line by line; since v1.2.0 `src/rng.ts` is rebuilt from docs/ALGORITHM.md and cites no line of it. See DL-8 |
| E20 | [evidence/config/duel-video-poker-config-2026-10-05.captured.json](evidence/config/duel-video-poker-config-2026-10-05.captured.json) | The response body of `GET https://duel.com/api/v2/video-poker/config` as fetched 2026-10-05 at 12:16:31 UTC (HTTP 200) in a logged-in session (read-only GET), saved byte for byte (22,515 bytes, SHA-256 `d4aeae82c5e043eb20a4c9953dbb53ad837a48bfcf6b3731f1acfaaca39afcfd`). It holds the top-level `multipliers` (equal to E06 exactly) and `scaling_edge`: 52 contiguous bet tiers from a `min_bet` of 0 to a `max_bet` of 6189.485121034804251 (about $6,189.49), each with `min_bet`, `max_bet`, `house_edge` (0.001 to 0.0061 in steps of 0.0001), its own ten `multipliers` and the same ten `probabilities`. The path, status, response headers and fetch time are in the sidecar [duel-video-poker-config-2026-10-05.captured.json.meta.json](evidence/config/duel-video-poker-config-2026-10-05.captured.json.meta.json) (SHA-256 `b2a64be04023e6eed339c714b86266ec22376644e5069c4782a290406b6ecc1c`). Read by [Bet-size scaling](#bet-size-scaling); no verification step reads it |

E14–E18 were brought across from the published verifier repository (`evidence/`); no former chapter cited them. E16 was masked on 2026-10-01: the capture account's username and avatar in the modal are covered by a solid box; every pixel outside the box is unchanged (compared pixel by pixel). The captured file was JPEG data under a `.png` name; the masked file is PNG. SHA-256 as captured `923c4e0478e1e9565519a9f8b8cc2d09d050610e8b2faf8ba9621bb678013fc8`, masked `a619e58accbaf2e04bced79daa082d2ba76ed497447c99000e74c21c04541544`.

## Limitations and trust

The commit-reveal scheme makes the shuffle deterministic and verifiable after seed rotation, and the server cannot change the outcome after committing. The remaining trust requirement is that the server does not select seeds from a pre-computed pool; Pass 2 found no evidence of this.

**Entropy model:** client seed + server seed (commit-reveal, no drand/beacon). Both seeds contribute; each server seed is committed one rotation ahead (as the next server seed hash), before the player sends that epoch's client seed. **Cherry-pick risk tier:** Moderate (standard for commit-reveal without an external randomness beacon): the server could theoretically pre-compute multiple server seeds and select the most favourable. All 114 next-seed promotion links match (Step 2). That is a consistency check: each epoch's active hash is the one recorded as "next" at the previous rotation. It does not by itself show when that hash was shown. The timing rests on the capture's rotation snapshots: each next hash was recorded one rotation before the rotation that sent the following epoch's client seed (snapshot timestamps strictly increasing over all 115 records). On that record, and with capture integrity assumed (P5), the server could not change its commitment after seeing the client seed. The server knows an epoch's client seed at the moment of commitment only if the player keeps the same client seed across rotations, as Phase D did (one client seed over 11 bet-bearing epochs, DL-3); this is inherent to the commit-reveal model without an external beacon.

| Property | Verifiable | Method |
|----------|-----------|--------|
| Deck shuffle determinism | Yes | Recompute from (serverSeed, clientSeed, nonce) |
| Revealed seed is consistent with its commitment | Yes | SHA-256(hex_bytes(serverSeed)) = the commitment the bets were served under, plus the forward links; consistency checks, not timing |
| Commitment was shown before the bets | Conditionally | The capture's rotation snapshots, each recorded before its epoch's first bet; holds only as far as the capture is a faithful record (P5) |
| Client seed influence | Yes | Wrong client seed produces different deck |
| Hand classification | Yes | Independent evaluateHand matches server |
| Payout correctness | Yes | amount_won = amount × multiplier |
| Replacement pool pre-determination | Yes | deck[5..9] fixed at deal time |
| Seed selection fairness | Partially | Pass 2 statistical test (no direct proof) |

| Requires trust | Why |
|----------|-----|
| Cross-account fairness | Single-account audit; cannot verify all accounts receive the same RNG treatment |
| Seed generation randomness | Server claims seeds are random; we verify they match commitments, not how they were generated |
| Tiers above tier 0 (from $1,182.86) | Pay tables from E20 and the Step 26 enumeration; no live bet above tier 0 |

### Declared limitations register

Each row is something this audit does not establish, with its measured magnitude. None changes the verdict; capture-origin rows never count against the operator.

| ID | Limitation | Magnitude (measured on the pinned dataset) | Closure / where it is carried |
|----|-----------|---------------------------------------------|-------------------------------|
| DL-1 | Two captured rounds are missing (capture retries) | 2 nonce gaps in 2 epochs of 49; the initial deal at each missed nonce is derivable, the hold / final hand / payout are not verified | Step 4, capture-origin FLAG (verdict-neutral) |
| DL-2 | The auditor's client seeds for phases A, B, C and E came from `Math.random()` (not a CSPRNG) | 4,900 of 5,400 bets; `capture/capture.reference.js:212-216` `generateClientSeed` | Capture-origin disclosure. The operator's own default seed generator is `crypto.getRandomValues` (E18) |
| DL-3 | Phase D used ONE predictable client seed | 500 bets across 11 bet-bearing epochs, all with client seed `pfauditmod66jae` (`'pfaudit' + Date.now().toString(36)`, `capture/capture.reference.js:334`); the profile floor is ≥ 2 distinct Phase D seeds | Step 15 recomputes all 500; capture-origin, captured before the 2026-09-23 standard |
| DL-4 | One paytable cell was never reached live | royal_flush (812.9719437907615×): 0 of 5,400 hands; 0.371 % of the deal-stage RTP rests on it (`outputs/payout-coverage.json`) | Step 11 names it; covered analytically by Step 26 |
| DL-5 | Few elevated-stake paying hands | Phase C: 100 bets at $10, 18 paying hands (profile VP-12 asks for ≥ 100 paying) | Step 9 checks every one exactly; captured before the standard |
| DL-6 | RESOLVED 2026-09-26 — part of the simulation evidence could not be re-derived from the shipped rows | Steps 17–18 recompute every per-stream and per-seed chi-squared, Fisher's p, the flag count, the binomial p, the pooled counts and RTPs from the shipped rows. Since the second 2026-09-26 regeneration the artifact also ships a 10 × 10 rank-transition census (lag-1 z −0.737 and runs p 0.1000 recomputed from it, marginals reconciled exactly), a dealt-card census over 10 deck positions × 52 cards (each position χ² df 51, smallest p 0.0015 vs Bonferroni 0.001) and an integer window census for Pass 2, whose pre-registered decision rule is now window 0 (the captured epoch) ranked among its seed's 2,000 windows of 50 by deal-only return, exact permutation null, rank-sum Z −0.018 against the pre-registered −3.090 (one-sided α 0.001); the chi-squared flag count (5 flagged, binomial p 0.6485) is still reconciled but no longer decides. Remaining approximation: the sum of 110 per-seed rank sums is referred to the normal with its exact permutation variance | Artifact SHA-256 pinned (Step 28, re-pinned 8a1771d7 → db2253de — every earlier figure unchanged, census fields added; re-pinned db2253de → 9ebc1076 on 20 October 2026 after regeneration with the rebuilt RNG, three simulated rounds changed, see [release history](#release-history)); `npm run test:full` regenerates it into `outputs/run/` and diffs it at tolerance |
| DL-7 | The optimal-play RTP is read from its pinned artifact by `npm test`; since 14 October 2026 it is held to an operator claim, the game settings' tier-0 edge (house_edge `"0.001"` on E20 tier id 1, i.e. 99.9 %; `effective_edge` 0.1 on every captured deal and draw, Step 10), which covers tier 0 only | 99.900000 % (9/6 reference 99.543904 %); the 9/6 reference asserted ± 0.0001 pp against the published constant, the Duel figure required not to exceed the published 99.900000 % (+ 0.0001 pp; below it is an RTP-CLAIM miss, exit 5, since 14 October 2026); the enumeration takes about two minutes | Step 26 + pin (Step 28); `npm run test:full` re-runs the enumeration into `outputs/run/` and diffs it at tolerance |
| DL-8 | Duel's own Verify-tab code for Video Poker was captured on 2026-04-23, five months before the other games' panels (2026-09-25), and not re-copied since | The capture (evidence/verify-tab/duel-verify-tab-video-poker-2026-04-23.captured.json) is the panel as the browser tool saved it — one JSON string literal; whether the live panel has changed since is not established | Pinned; Step 5 runs it unedited on all 5,400 hands (0 differ) |
| DL-9 | No live bet above tier 0 | 0 of 5,400 bets above tier 0's `max_bet` (1182.855407010385761); tiers 1 to 51 from E20 and Step 26 | [Bet-size scaling](#bet-size-scaling) |

### Load-bearing premises

| # | Premise | Could the captured data contradict it? | Status |
|---|---------|----------------------------------------|--------|
| P1 | SHA-256 is collision-resistant: the operator cannot find two server seeds with the same hash, so a committed server seed cannot be swapped for another after its hash is shown (preimage resistance, which keeps the seed from being read off its hash before the reveal, is the S1 property). HMAC-SHA256 output is unpredictable without the key | No | ASSUMED (standard) |
| P2 | `videoPokerConfig.json` (captured 2026-04-23) is the paytable in force during the capture (2026-04-24) | Yes — any served multiplier differing from it would show; none does (Step 8, 5,400/5,400) | ASSUMED for ranks never reached (DL-4) |
| P3 | `effective_edge` is the edge of the bet's tier (0.1 = tier 0), not an adjustment to the credited payout | Partly — every credited payout equals stake × tier-0 multiplier exactly (Steps 7 and 8), and every bet shows 0.1 (Step 10) | ASSUMED, consistent with E20 |
| P4 | The client seed recorded with each bet is the one the server used | Yes — a different seed would fail recomputation; none does (Step 5) | Evidenced |
| P5 | The capture is a faithful record of what Duel served and when, so each rotation snapshot's commitment was shown before the bets recorded after it | No — the capture is the only record of when each commitment was shown; hash matching and forward links (Steps 1–3) cannot show timing | ASSUMED |

### Scope boundaries and original recommendations

| ID | Limitation | Description |
|----|-----------|-------------|
| R-MULTI | Multi-account testing | This audit used a single funded test account. Differential RNG treatment across accounts cannot be verified without multi-account testing. |
| R-BRACKET | Tiers above tier 0 (from $1,182.86) | Pay tables from E20 and the Step 26 enumeration; no live bet above tier 0 (DL-9). |

The original report's recommendations to the operator, retained as recorded: (1, Medium) publish the Video Poker verification algorithm in the fairness documentation, including the full Fisher–Yates backward sweep pseudocode, card encoding and draw replacement logic; (2, Low) consider adding an external randomness beacon (e.g. drand) to seed generation, which would eliminate the theoretical cherry-pick risk inherent in commit-reveal without external entropy; (3, Low) document the relationship between `effective_edge` and the zero-edge rakeback mechanism.

## Terms

**Client seed:** a string provided by the player (or platform) that is an HMAC input; changing it changes the shuffle. **Commit-reveal:** the server publishes a hash of its seed before the player acts and reveals the plaintext afterwards. **Deal-only RTP:** the expected return of the 5 dealt cards scored as dealt, with no draw; it measures the RNG independent of strategy. **Epoch:** the rounds played on one server seed, ending when the player rotates seeds; this capture rotated once a seed's nonce reached 50 (its own schedule), so its epochs hold up to 50 rounds. **Fisher–Yates shuffle:** an unbiased permutation; here a backward sweep from index 51 to 1, swapping each position with a uniformly random earlier position. **Fisher's method:** combines independent tests as T = -2 Σ ln(p_i), chi-squared with 2K degrees of freedom. **HMAC-SHA256:** keyed hash producing a 32-byte deterministic output. **Jacks or Better:** the variant whose minimum paying hand is a pair of Jacks, Queens, Kings or Aces. **Nonce:** the round counter within an epoch, starting at 0 (0–49 in this capture, given its 50-round rotation schedule). **Optimal play:** the hold strategy that maximizes expected return for each dealt hand, chosen among all 32 hold patterns. **Pass 1:** simulation on auditor seeds (not casino seeds) testing the algorithm against theoretical probabilities. **Pass 2:** simulation on the actual casino server seeds × extended nonces, testing for cherry-picking. **Rejection sampling:** values ≥ maxFair are rejected so the accepted value is uniform. **Replacement pool:** the 5 cards at deck positions 5–9 that fill discarded positions left to right. **RTP:** return to player, the expected fraction of wagered money returned. **Server seed:** a hex string generated by the server; its SHA-256 is published before play and the plaintext revealed after rotation. **Zero Edge:** Duel.com's label for this game (game footer, E14); the edge starts at 0.1% and rises with bet size (see [Bet-size scaling](#bet-size-scaling)). Rakeback is outside this audit.

## Release history

| Release | What changed | Verdict |
|---------|--------------|---------|
| `v1.0.0` | The original audit. | PROVABLY FAIR — Full Pass |
| `v1.1.0` | Re-certification under Framework 1.1, October 2026, below. The dataset of record is unchanged. | unchanged |
| `v1.2.0` | RNG code rebuilt from a written specification, below; Duel's Verify-tab code kept as a second check only. | unchanged |

### v1.2.0 — RNG code rebuilt from a written specification

The client's 20 October 2026 rule: package RNG code is rebuilt from a written specification, never ported from the casino's code; the casino's code stays only as a cross-check. The verdict is unchanged: PROVABLY FAIR — Full Pass, 27 of 28 steps pass, one capture-origin FLAG (Step 4), no hard failures. The dataset of record is unchanged.

- **Where the RNG code comes from.** Through v1.1.0 `src/rng.ts` was ported from Duel's published Verify-tab code (E19) and cited 13 of its lines (`OPERATOR_SOURCE_CITES`, checked by `checkOperatorCites` in Step 5 and a unit test). It is now rebuilt from the written specification [docs/ALGORITHM.md](docs/ALGORITHM.md) (a copy of the framework's `games/video-poker/ALGORITHM.md` with the spec author's workspace paths replaced by package paths or neutral wording (its header says so)), written from Duel's public pages, the standard provably-fair construction and the 5,400 captured hands without opening Duel's code. The implementer read only that specification and a module-interface file. The only addition on integration is a provenance header comment. The citation table, `checkOperatorCites`, the Step 5 citation check, its unit test and its mutation (M05f) are removed.
- **Three-way agreement, measured on integration.** The rebuilt module against the 5,400 captured hands: commitment 5,400/5,400, dealt hand 5,400/5,400, final hand 5,400/5,400. Against Duel's Verify-tab code, run byte for byte through the package's pinned runner: deck[0..9] 5,400/5,400. Against the pinned ProvablyFair.org docs-site verifier copy: dealt hand, replacement cards and final hand 5,400/5,400. The package has no copy of the live-site verifier, so that comparison was not run.
- **Rejected draws (specification open point O1).** On a rejected value the rebuilt module moves to the next counter; Duel's Verify-tab code reads the next 4 bytes of the same hash and throws after 8, and its ceiling also rejects the top `range` values when `range` is a power of two. They agree whenever neither rejects. Neither ceiling rejected any of the 275,400 captured draws. [Shuffle algorithm](#shuffle-algorithm), S5, Step 22 and [Verify a bet](#verify-a-bet) step 4 now describe the specification's rule.
- **Second check.** Duel's Verify-tab code still runs unedited on all 5,400 hands in Step 5 and on the pilot rounds in the unit tests, described as a second check, not the source. `tests/videoPoker/RngSpecTests.ts` (new) runs the specification's own vectors and properties: 80/80. Unit tests: 58 (one citation test removed, the specification self-test added).
- **Mutations retargeted to the rebuilt code:** M06 and M29 (the HMAC message line), M22 (the rejection ceiling) and M22b (the swap census). M05f retired with the citation table. The registry has 50 entries.
- **Served holds on a hand that is not theirs.** The rebuilt `computeFinalHand` throws when a held card is not in the hand it is given (the specification leaves that case open, O7); the former port filled the hand anyway. Steps 5, 9, 21 and 25 apply the served holds to a recomputed (or, in Step 5, Duel-computed) hand, so a forged seed, client seed, hold or operator file stopped the whole run before the step that should report it: the first battery on the rebuilt tree had M06, M15, M20 and M05e exit 1 without their intended step's FAIL line. Those steps now count a refused hold set as a mismatch (`finalHandOrNull` in `tests/steps/context.ts`); on the captured data nothing changes, since every served hold is in its recomputed hand (5,400/5,400).
- **Simulation regenerated and re-pinned** (`PF_EMIT=1 npm run simulate` with the rebuilt RNG; `src/artifact-pins.ts` db2253de → 9ebc1076). Three of the 21,000,000 simulated rounds changed: one in Pass 1 (dealt-card census, 20 cells ±1, hand rank unchanged) and one on each of two Pass 2 seeds (nonce 20996, a three of a kind became none; nonce 65303, a jacks or better became none). Both Pass 2 rounds have a rejected draw (open point O1, [Shuffle algorithm](#shuffle-algorithm)). Fisher's p 0.798239, the empirical deal-only RTP 33.6999%, the serial census, the 5 flagged seeds (binomial p 0.6485) and the rank-sum Z −0.018 are unchanged; the Pass 2 aggregate chi-squared p moved from 0.71927 to 0.72000 and the smallest dealt-card p from 0.001487 to 0.001484 (threshold 0.001). `rtp-convergence.html` regenerated byte-identical; the optimal-play artifact was not regenerated (it does not use the shuffle).
- **Battery.** `npm run mutate` on 2026-10-20 (Apple M2 Max, Node 22.23.1), the whole registry (50 entries) on the rebuilt tree, baseline verify and mocha exit 0: 50/50 killed, 28/28 scored steps covered; MC3a/MC3b exit 5, MC3as/MC3bs exit 1.
- `outputs/verification-results.json` was re-emitted with `npm run report` (Step 5 and Step 22 detail text, Step 5 `operatorCitesChecked` removed, the VP-09 profile note) and `RELEASE-MANIFEST.json` regenerated with `npm run release-manifest`.

### 21 October 2026 — final QA corrections (v1.2.0)

No draw check, scored step status, measured figure or verdict changed; the dataset and every pinned artifact are unchanged.

- **Release label and signature.** The header, the README and the release-history row say `v1.2.0` (they said "unreleased"). `scripts/release-manifest.mjs` gave v1.2.0 the signature of v1.1.0 and an empty `pending` line, so `RELEASE-MANIFEST.json` read as a signed v1.2.0. Until the tag its `signature` was null and its `pending` line said v1.2.0 was not tagged or signed; v1.1.0's signed release identity is in the `RELEASE-MANIFEST.json` at the `v1.1.0` tag.
- **Capture tools.** [Dataset and capture](#dataset-and-capture) named `capture/capture.js` and `capture/fill-gaps.js` as if they shipped. It now lists the two reference records that ship, says that the runnable tools are kept in the private workshop and not published, and scopes the comparisons between each tool and its reference record as made in the workshop, not checkable from this package.
- `RELEASE-MANIFEST.json` was regenerated with `npm run release-manifest`.
- **Release wording.** At tagging, the README, this overview and the release manifest stopped describing `v1.2.0` as a draft until tagged. The release manifest records `v1.2.0`, superseding `v1.1.0`, and the fingerprint of the ProvablyFair.org signing key (`signature`, `SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY`), as tagged `v1.2.0`; it was refreshed with `npm run release-manifest`. No check, figure or verdict changed.

### v1.1.0 — what changed

- **Scored steps: 28 in v1.0.0, 28 now.** The verdict is unchanged, PROVABLY FAIR — Full Pass. The dataset of record is byte-identical to v1.0.0. v1.0.0 is the tag on commit `1ffe777`; the initial-release commit `071d7e0` scored 27/27, and Step 28 (Artifact Integrity) was added on 14 September 2026, before that tag.
- **Step 4 (Nonce Audit) is now a capture-origin FLAG.** It reports the same 2 nonce gaps v1.0.0 reported (capture retries); the initial deal at each is derivable from the revealed seed, the missing rounds are not verified. A capture-origin FLAG is disclosed and does not move the verdict; the step passed in v1.0.0.
- **Errata (2026-09-29):** the RTP convergence chart (`outputs/rtp-convergence.html`) loaded Chart.js 4.4.1 from cdn.jsdelivr.net, so a pinned artifact depended on a third-party host. The same version is now inlined, byte for byte from the npm package pinned in package-lock.json. Every figure and data point in the chart is unchanged.
- **Screenshot E16:** the capture account's username and avatar are masked with a solid box; every other pixel is unchanged. The captured SHA-256 is kept in the [Evidence](#evidence) section.
- **Added:** 18 Markdown report files, `LICENSE` (MIT), `.nvmrc` (Node 22), `RELEASE-MANIFEST.json` (written by `scripts/release-manifest.mjs`) and the mutation battery (`npm run mutate`, `tests/mutations.json`). The 18 report files were consolidated on 4 October 2026, below.

### 4 October 2026 — consolidated documentation

The 20 Markdown documents were reduced to **README.md and this MANIFEST.md**. Repeated explanations and per-chapter summary tables were removed; the dataset, pay table, evidence files, verifier code, step results and every limitation, premise, evidence exhibit and release note were retained. Documentation references in the profile-coverage map (`src/profile-map.ts`) now point to the retained sections, and `outputs/verification-results.json` and `RELEASE-MANIFEST.json` were regenerated by the package's own commands; no step result changed. Two corrections were made while merging: the former RNG chapter's card-index table skipped four cards and is replaced by the rank-major rule it was derived from (`src/rng.ts` `ALL_CARDS`), and the former RTP chapter's "fresh random seeds per stream (not pinned)" is replaced by the pinned `SIM_SEEDS` the simulation code and artifact carry. No new casino capture, simulation regeneration or mutation run is asserted for this update.

### 5 October 2026 — bet-size scaling

Added [Bet-size scaling](#bet-size-scaling) and DL-9, and scoped the 99.9000% headlines to tier 0. The tier figures come from E20, the duel.com video-poker config as fetched 2026-10-05 in a logged-in session (read-only GET), added byte for byte; its top-level `multipliers` equal E06 exactly (its tier-0 entry rounds the Royal Flush to 8 decimals), and `videoPokerConfig.json` was not edited. `effective_edge` is now read as the per-bet tier edge (premise P3); the capture holds no rakeback records. The E06 row records that the pinned configuration's notes and the vendored site verifier's paytable header predate this reading; neither file was edited. The Step 10 and Step 11 detail text and the profile notes changed with it; `outputs/verification-results.json` and `RELEASE-MANIFEST.json` were regenerated by the package's own commands and no step result changed. Two descriptions were corrected against the dataset: the seed-entry paragraph (seeds[0] carries 50 bets; the 5 empty records are seeds 61, 82, 85, 97 and 114) and the commitment timing in the entropy model. E20 is a configuration fetch, not a bet capture; no new bet capture, simulation regeneration or mutation run is asserted for this update.

### 5 October 2026 — payout instructions scoped to the stake's tier

[Verify a bet](#verify-a-bet) step 4 told players to compute the payout from `videoPokerConfig.json` without limiting it to a stake range, while [Bet-size scaling](#bet-size-scaling) and E20 give different multipliers above tier 0: a $1,200 Jacks or Better hand (a configuration example, not a recorded bet) would have been predicted at $1,200, while its E20 tier (`id` 2, `house_edge` 0.0011) pays 0.9998999x, $1,199.87988. Step 4, the [hand rankings](#hand-rankings) table and the README now limit `videoPokerConfig.json`, and the vendored site verifier's multiplier, to tier 0 (stakes from 0 to the stored `max_bet` 1182.855407010385761), and tell players how to look up the stake's tier in E20 for any other stake. The rounded tier-0 bound "$1,183" was replaced throughout by $1,182.85 (the last whole-cent stake in tier 0) or $1,182.86 (the first above it), since a stake between the stored `max_bet` and $1,183 is already in tier 1. Neither player verifier shipped here prints a payout (Duel's Verify-tab code, E19, prints the dealt and replacement cards; the vendored site verifier has no console output and returns a multiplier with no stake input), so the caveat is in the documentation and no code or output changed; `videoPokerConfig.json`, E20 and the vendored verifier files are unedited. No step result, verdict or measured figure changed.

### 5 October 2026 — commitment timing

A hash match (`SHA-256(revealed seed)` = commitment) and the forward links establish that the seed records are consistent, not when a commitment was shown: a seed and hash pair made after settlement would pass them too. The conclusion, the risk table, the missed-nonce note, the entropy model and the verifiable-properties table now describe hash matching and forward links as consistency checks, and attribute the pre-bet timing of each commitment to the capture's rotation snapshots, with capture integrity assumed (new premise P5). [Verify a bet](#verify-a-bet) and the README tell the player to save the commitment shown before betting and compare the revealed seed against that saved value: a match means hash equality, and the timing assurance comes from the saved record. E15 is labelled illustrative, since the seed it shows is not in the dataset. Two descriptions were corrected against the dataset and `capture/capture.reference.js`: the 115 seed records are rotation snapshots taken at every rotation, not only at phase boundaries, and the recorded deal and draw responses carry no seed field (each bet's `seed` block is read from `GET /api/v2/client-seed` after the round). The Step 2 and Step 4 detail text and the VP-30 profile note (premises P1–P5, evidence E01–E20) changed; `outputs/verification-results.json` and `RELEASE-MANIFEST.json` were regenerated by the package's own commands. No step result, verdict or measured figure changed.

### 6 October 2026 — capture script, rotation schedule and method wording

- **Phase-end rotations.** The seed-entry paragraph and the 5 October commitment-timing entry cited `capture/capture.reference.js` for the 115 seed records. That script, and `capture/capture.js`, end a phase without rotating and send the Phase D client seed on every Phase D rotation; records 61, 82, 85, 97 and 114 (0 bets each; record 97 carries client seed `G4PfiIOyy6POq4F2`) come from a phase-end rotation the shipped script does not contain, and it accounts for the other 110. [Dataset and capture](#dataset-and-capture) now says so; the dataset is unchanged.
- **Step 1 label.** The 4 phase-change transitions Step 1 accounts for were called end-of-phase rotations (Step 1 detail and row, a `src/loader.ts` comment). They are the phase-opening records 62, 83, 86 and 98, whose plaintext is the previous phase's last bet-bearing seed, and are now labelled so.
- **Rotation schedule.** The seed lifecycle, the Terms entries for Epoch and Nonce, the Step 12 detail and failure message and a `src/loader.ts` comment described the 50-round epoch as Duel's ("the platform's per-epoch cap", "50-bet platform cap"). It was the capture's rotation schedule (`BETS_PER_EPOCH = 50`); Duel reveals a server seed only when the player rotates.
- **Method wording.** Step 3 of the optimal-play method said hold 0 is a constant (the deal-only RTP); `src/compute-optimal-rtp.ts` removes the 5 discarded cards from the draw pool by inclusion-exclusion, so the hold-0 EV depends on the dealt hand. The deal-only RTP was defined as the return when all 5 cards are discarded; the simulation scores the 5 dealt cards (`deck[0..4]`) as dealt, and the definition in [Deal-only RTP and anti-circularity](#deal-only-rtp-and-anti-circularity) and Terms now says that. No figure changes.
- **Missed nonces.** The nonce-flag note said the missing bet exists in the server's records, which nothing in this package shows. It now says the nonce was consumed and the round is not in the capture.

`outputs/verification-results.json` (Step 1 and Step 12 detail text) and `RELEASE-MANIFEST.json` were regenerated by the package's own commands. No step result, verdict or measured figure changed; no new capture, simulation regeneration or mutation run is asserted for this update.

### 19 October 2026 — v1.1 QA corrections

No verdict, scored step status or measured figure of the audit changed; the dataset and the artifacts pinned in `src/artifact-pins.ts` are unchanged.

- **Where the RNG code comes from.** `src/rng.ts` was ported from Duel's published Verify-tab code (E19). The README, the conclusion, the risk table, the shuffle section, Step 5 (code and detail text), S7 and the worked example no longer call that recomputation independent; the hand evaluator, the C(52,5) counts and the optimal-play enumeration do not use the ported code.
- **Step 4 checks nonce order.** It checked gaps and duplicates on the sorted nonces, so a sequence served out of order passed (mutation M04c, two capture times swapped, survived on the 19 October tree before the change). It now also requires, in capture order, every nonce to be above the one before it: 0 of 110 epochs out of order. Step 4 stays a capture-origin FLAG; its detail text and data (`outOfOrder`: 0) changed.
- **Step 15** said "auditor-chosen client seeds"; Phase D used one seed (`pfauditmod66jae`, DL-3). The detail text now counts the seeds.
- **Corrected figures.** The chance that all 8 chunks of a hash are rejected was given as about 10^-75 in three places here and in a `src/rng.ts` comment; the worst case is range 52, (48/2^32)^8 ≈ 2.4 × 10⁻⁶⁴. In the deal-only table, Four of a Kind contributes 0.6242% (was 0.6243%) and None has probability 79.372518% (was 79.373131%).
- **Wording.** DL-7 and the optimal-play table no longer say no operator RTP claim was captured: since 14 October Step 26 holds the figure to the game settings' tier-0 edge. P1 names collision resistance, the property that stops a seed swap. The key-encoding paragraph says only a unit test checks the UTF-8 form. The `src/simulate.ts` header describes the current Pass 2 outputs and decision rule. `capture/fill-gaps.js` is described under [Dataset and capture](#dataset-and-capture), with what the record shows about whether it was run. The "not yet released" line is removed. The mutation-battery paragraph cited the 46/46 run; it now cites the latest.
- **Battery.** `npm run mutate` on 2026-10-19 (Apple M2 Max, Node 22.23.1), the whole registry with the new M04c: 51/51 killed, 28/28 scored steps covered.
- `outputs/verification-results.json` was re-emitted with `npm run report` (Step 4, 5 and 15 detail text, Step 4 `outOfOrder`) and `RELEASE-MANIFEST.json` regenerated with `npm run release-manifest`.

### 14 October 2026 (second pass) — an RTP miss ends RTP FIGURE OVERSTATED (FIXPASS2 class C3)

No verdict, scored step status or figure changed. `outputs/verification-results.json` was re-emitted; only the Step 26 detail line changed.

- **Step 26 no longer pre-empts the rule.** It held the Duel optimal-play figure to the published 99.900000 ± 0.0001 pp, so a lower figure ended the run NOT PROVABLY FAIR (measured with MC3a on the 14 October tree: exit 1, "Headline figures drifted from the published values: duel.rtpPercent=99.700000"). It now fails only a figure above the published 99.900000 (+ 0.0001 pp), or a `rtpPercent` that is not `duel.rtp` to 6 dp; below it is an RTP-CLAIM miss on the same step. M26 (the rendered figure forged to 99.95 and re-pinned) is still killed by Step 26.
- **Exit-5 mutations.** `scripts/mutate.mjs` gained `regen` (in the disposable copy: the RTP table rewritten by `src/rtp-settings.ts` and re-pinned, then the committed record re-emitted with `PF_EMIT=1`), `expectExit` (an entry counts as killed only when the run also ends with that exit code) and runner `test` (mocha, then the verifier, as `npm test` runs them). New entries: MC3a (the optimal-play solve's `duel.rtp` lowered to 0.997 in `outputs/optimal-play-rtp.json`, re-pinned: 99.7 %. A lowered pay-table cell would reach the table only through `npm run compute-optimal-rtp` and a re-run simulation (the Pass 1 statistics are recomputed from the pay table), neither run in a mutation) and MC3b (the claim raised to 100.1 %), each with the table and record regenerated and expected to end RTP FIGURE OVERSTATED, exit 5. MC3as and MC3bs make the same changes without regenerating the table and are expected to end exit 1: a committed RTP table that differs from the run, or from its pin, is a reproduction failure, miss or no miss.
- **Battery (Apple M2 Max, 12 cores, Node v22.23.1).** The whole registry (50 entries) in one `npm run mutate` on this tree, 14 October 2026 evening (baseline green): 50/50 killed, 28/28 scored steps covered. On 15 October `--only` (now taking several comma-separated substrings) reran the four C3 entries and every entry naming Step 26, the RTP-claim step (M26, M26b, MC3): 6/6 killed; MC3a and MC3b ended `VERDICT: RTP FIGURE OVERSTATED`, exit 5; MC3as and MC3bs exit 1 with the committed table reported as differing from the run.

### 14 October 2026 — Methodology v1.1

No draw check, scored step status, figure or verdict changed. The dataset and the artifacts pinned in `src/artifact-pins.ts` are unchanged; the RTP-claim table is new, pinned in `src/rtp-settings.ts` (below).

- **Framework 1.1.** The audit is re-certified under ProvablyFair.org Framework 1.1 (decision D1); the release manifest's `framework` field and the release row above say 1.1.
- **RTP-CLAIM 1.2.0, switched on.** `src/rtp-claim.ts` is the framework's rule 1.2.0, byte-identical to `core/rtp-claim.ts` (SHA-256 `c9a9c1c4…5f131c`), and `src/rtp-claim-switch.ts` is set to true (decision D3). This package carried no copy of the rule until now (decision D4). It now has `src/rtp-settings.ts`, `npm run rtp-claim:write` and the pinned table `outputs/rtp-claim-table.json`: one setting, the tier-0 optimal-play RTP from the existing solve (`outputs/optimal-play-rtp.json`), held to a flat 99.9%, the house_edge 0.001 Duel's game settings state for stake tier 0 (E20, decision D2). The outcome is scored on Step 26 (VP-19): pass. A house-side miss would be an operator-origin FLAG on Step 26 and the verdict RTP FIGURE OVERSTATED, exit 5; a committed table that differs from the run exits 1. The "Zero Edge" label is noted, not tested (D3). See [RTP claim](#payouts-and-rtp).
- **Profile.** The Video Poker profile version this suite cites is 1.0.2 (decision D6, approved as cited; the `-proposed` suffix is dropped, no check changed). In `outputs/verification-results.json` `profileCoverage.profileVersion` changed, and the VP-19 note on Step 26 now says the figure is held to the game settings' tier-0 edge (coverage stays partial: tiers 1–51 are not tabled).
- **S5 level.** The adversarial matrix states the S5 level received: the fairness-integrity matrix; game-integrity testing was not commissioned (decision D5).
- **Exit 5** (RTP FIGURE OVERSTATED) is added to the exit codes.
- `outputs/rtp-claim-table.json` was written with `npm run rtp-claim:write` and pinned, `outputs/verification-results.json` regenerated with `PF_EMIT=1 npm run verify`, the release manifest now also hashes the table and was refreshed with `npm run release-manifest`, `.gitignore` un-ignores the table, and the mutation runner copies it into its disposable workspace. The mutation battery was rerun: 46/46 killed, 28/28 scored steps covered.

### Where the former chapters went

| Former documentation | Consolidated location |
|---|---|
| `executive-summary.md`, `conclusion.md` | [Conclusion and scope](#conclusion-and-scope); README |
| `live-parity-testing.md` (phases, seed management) | [Dataset and capture](#dataset-and-capture); [Verification results](#verification-results) |
| `game-rules.md`, `system-architecture.md`, `rng-algorithm-analysis.md`, `game-logic-verifiability.md` | [Game and algorithm](#game-and-algorithm); worked examples in [Verify a bet](#verify-a-bet) |
| `payout-verification.md`, `rtp-analysis.md`, `optimal-play-methodology.md` | [Payouts and RTP](#payouts-and-rtp) |
| `edge-case-analysis.md`, `exploit-testing.md` | [Verification results](#verification-results); [Exploit testing](#exploit-testing) |
| `reproducibility.md`; MANIFEST "Verification", "Artifacts of record", "Reproducibility", "Fresh-clone reproduction record" | [Reproduce the audit](#reproduce-the-audit) |
| README "Verify one of your own hands" | [Verify a bet](#verify-a-bet) |
| `evidence.md` | [Evidence](#evidence) |
| `operator-trust-analysis.md`, `recommendations.md`; MANIFEST "Declared Limitations Register", "Load-Bearing Premises" | [Limitations and trust](#limitations-and-trust) |
| `glossary.md` | [Terms](#terms) |
| `SUMMARY.md`, README "Table of Contents" | [Contents](#contents); README |
