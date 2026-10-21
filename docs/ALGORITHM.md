# Duel.com Video Poker: clean-room algorithm specification

> Package copy of the ProvablyFair.org audit framework's `games/video-poker/ALGORITHM.md`.
> It differs from that file only where the file named locations or tracking items
> in the spec author's workspace: those now read as paths inside this package or as
> neutral wording. No rule, number, vector or source note was changed.

Written 20 Oct 2026 for the ProvablyFair.org audit of Duel.com Video Poker
(Jacks or Better).

This document is the only input an implementer needs to rebuild Duel Video
Poker's deal, draw, hand evaluation and settlement. It was written without
opening any Duel source code, any port of it, or any copy of Duel's in-site
verifier code (see §8 for every file and URL opened). Every step names where it
came from:

- **PAGE**: Duel's public pages, as captured in
  `evidence/*.png`, quoted with the file.
- **STANDARD**: the standard provably-fair construction used across the
  industry (commit to SHA-256 of a server seed, HMAC-SHA256 keyed by the server
  seed over the client seed, nonce and a counter, bytes to integer, Fisher-Yates
  shuffle, rejection sampling).
- **DATA**: fixed by testing the standard candidates against all 5,400 live
  rounds in `data/video-poker-dataset-5400bets.json`
  (captured 24 Apr 2026). The data chose; Duel's code did not.
- **CONFIG**: Duel's public video-poker config, `GET /api/v2/video-poker/config`,
  captured 5 Oct 2026 as
  `evidence/config/duel-video-poker-config-2026-10-05.captured.json`.

The captured pages say what goes in and show one verified result. They do not
say how the inputs are combined or how the deck is built, so most of §2 was
settled by DATA, and then confirmed against the one result Duel's own Verify
page shows (§2, Step 6).

---

## 1. Inputs and commitment

### 1.1 Inputs

| Input | Form | Source |
|---|---|---|
| `serverSeed` | 64 lowercase hex characters (32 bytes); secret until the pair is rotated | PAGE: the in-game "Provably Fair" modal shows "Active server seed (Hashed)" and "Next server seed (Hashed)" (step2-fairness-page.png); the transaction modal's Verify tab shows the revealed "Server seed" (step3-transaction-reveal.png). Form: DATA (all 114 revealed seed records are 64 hex chars) |
| `clientSeed` | text string | PAGE: "Active client seed" / "New client seed" (step2). The default is 16 characters from `A–Z a–z 0–9 _`, generated in the browser (client-seed-origin.png). DATA: 4,900 rounds carry 16-char seeds; the 500 Phase D rounds carry the player-set 15-char seed `pfauditmod66jae` |
| `nonce` | non-negative integer; 0 on the first round after a rotation, +1 per round | PAGE: "Nonce 3" in the modal (step2), "Nonce 2" on the Verify tab (step3, step4). DATA: nonces 0–49, minimum 0 |
| `held_cards` | the subset of the 5 initial cards the player keeps (0 to 5 cards), sent with the draw | DATA (`draw.request.held_cards`); every hold count 0…5 occurs (948 / 1,088 / 1,442 / 1,111 / 600 / 211 rounds) |
| `amount` | stake, decimal | DATA (`deal.request.amount_coins`: `0.01` on 5,300 rounds, `10` on 100) |

A card is written `<rank><suit>`: rank one of `2 3 4 5 6 7 8 9 10 J Q K A`,
suit one of `D H S C` (diamonds, hearts, spades, clubs). E.g. `10D`, `QS`, `AH`.
SOURCE: DATA (the served `initial_cards` / `final_cards` strings).

### 1.2 Commitment

PAGE (step2-fairness-page.png, in-game modal): "Use these values to verify that
every bet placed had a truly random and unpredictable outcome." The modal shows
the active seed only as "Active server seed (Hashed)" and the next one as "Next
server seed (Hashed)", both as 64-hex strings.

The pages do not say what bytes are hashed. Spec:

```
commitment = lowercase_hex( SHA-256( hex_decode(serverSeed) ) )
```

i.e. hash the **32 raw bytes** the 64 hex characters encode, not the 64 ASCII
characters.

- SOURCE: STANDARD (SHA-256 commitment) + DATA for the encoding.
- Candidates tried: SHA-256 over the hex-decoded 32 bytes → the 110 distinct
  revealed seeds resolve all 110 bet hashes, **5,400 / 5,400** rounds;
  SHA-256 over the ASCII hex string → **0 / 5,400**.
- Verification: every round's `seed.serverSeedHashed` must equal `commitment`
  of a revealed seed. **Pair seeds to rounds by hashing, not by record
  position**: in the capture a rotation record carries the *revealed old* seed
  (`seed.serverSeed`) next to the *new* active hash (`seed.serverSeedHashed`).
  Example: seed record 2 reveals `2424d436…fdc9`, whose SHA-256 is `107cca7f…2f7b`,
  the active hash of record 1, not of record 2.
- The capture also records, at every rotation, the next-seed hash shown before
  the rotation (`nextServerSeedHash`), which becomes the active hash after it
  (step2 shows both the active and the next hash).

---

## 2. Outcome derivation

### Step 1: the starting deck

```
RANKS = 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A
SUITS = D, H, S, C
deck  = [ r + s  for r in RANKS  for s in SUITS ]     # rank-major
      = 2D 2H 2S 2C 3D 3H 3S 3C … AD AH AS AC          # index 0 … 51
```

- SOURCE: DATA. Found without assuming any order: with the right shuffle
  applied to the identity permutation 0…51, the map *deck index → recorded
  card* is a function on every observed card of all 5,400 rounds (index 0 is
  always `2D`, 1 always `2H`, …, 51 always `AC`). The full spec with this deck
  then matches 5,400 / 5,400. Nearest alternatives (all else equal, initial
  AND final hand):

  | Deck order | Match |
  |---|---|
  | rank-major 2…A, suits D,H,S,C | **5,400 / 5,400** |
  | rank-major, suits S,H,D,C | 25 / 5,400 |
  | rank-major, suits C,D,H,S | 0 / 5,400 |
  | suit-major D,H,S,C × 2…A | 0 / 5,400 |

### Step 2: one random integer per swap

The shuffle (Step 3) needs 51 random integers. The *t*-th one (t = 0, 1, …, 50)
is drawn in range `N` as follows:

```
key     = hex_decode(serverSeed)                                  # 32 bytes
message = UTF-8( clientSeed + ":" + decimal(nonce) + ":" + decimal(k) )
digest  = HMAC-SHA256(key, message)                               # 32 bytes
v       = digest[0..3] read as an unsigned 32-bit BIG-ENDIAN integer
LIMIT   = floor(2^32 / N) * N
if v >= LIMIT: k = k + 1 and recompute (see Open point O1)
result  = v mod N
k       = k + 1
```

`k` is a counter that starts at **0** for the first swap of the round and goes
up by one per integer drawn, so with no rejection integer *t* uses `k = t`
(messages `clientSeed:nonce:0` … `clientSeed:nonce:50`). `decimal()` is plain
base 10: no padding, sign or separators. Only the first 4 bytes of each digest
are used; the other 28 are discarded.

- SOURCE: STANDARD (HMAC-SHA256 keyed by the server seed, `clientSeed:nonce`
  message with a cursor, big-endian bytes to integer, rejection sampling) +
  DATA for every choice below.
- Candidates tried, each scored on initial AND final hand over 5,400 rounds
  (all else as in the spec):

  | Variant | Match |
  |---|---|
  | **spec**: key = hex-decoded, HMAC-SHA256, msg `c:n:k` with k = 0…50, first 4 bytes BE, `mod N` | **5,400 / 5,400** |
  | msg `c:n` for the first integer, then `c:n:1`, `c:n:2`, … | 3,858 / 5,400 |
  | msg `c:n:k` with k starting at 1 | 0 / 5,400 |
  | msg `c:n:i` with k = the swap position i (51…1) | 0 / 5,400 |
  | msg `n:c:k` | 0 / 5,400 |
  | key = the 64-character ASCII hex string | 0 / 5,400 |
  | HMAC-SHA512 | 0 / 5,400 |
  | one HMAC per 8 integers (4-byte chunks streamed across the digest) | 0 / 5,400 |
  | u32 little-endian | 0 / 5,400 |
  | float `v / 2^32 × N`, floored, instead of `v mod N` | 0 / 5,400 |

  A wider deck-order-agnostic sweep (1,400 combinations of key form ×
  {HMAC-SHA256, HMAC-SHA512, SHA-256(seed:message)} × 5 message formats × 8
  number mappings × 7 shuffle shapes, first 100 rounds) found only this
  construction consistent (score 1.0); the next best family scored 0.9554
  (the `c:n`-first variant) and everything else ≤ 0.152.
- **Rejection.** For every range used (N = 2…52) this spec rejects
  `v ≥ floor(2^32/N)·N` (STANDARD). The data **cannot** tell rejection apart
  from plain `v mod N`: the expected number of rejected draws is
  1.383 × 10⁻⁷ per round (Σ over N = 2…52 of (2^32 mod N)/2^32), i.e. 0.00075
  over the 5,400 rounds, and **0** were hit. Both forms give 5,400 / 5,400.
  LIMIT for N = 52 is 4294967248; for N = 2 it is 2^32 (nothing rejected).

### Step 3: shuffle (backward Fisher-Yates)

```
a = copy of deck                         # Step 1
for i = 51 down to 1:                    # 51 swaps, t = 51 - i
    j = random_integer(N = i + 1)        # Step 2, so 0 ≤ j ≤ i
    swap a[i], a[j]
```

- SOURCE: STANDARD (Fisher-Yates) + DATA for the direction.
- Candidates tried: backward Fisher-Yates dealing from the front → **5,400 /
  5,400**; forward Fisher-Yates (`j = i + rand(52 − i)`, i = 0…50) → 0 / 5,400;
  "select from remaining" (card t = remaining[rand(52 − t)]) → 0 / 5,400;
  backward Fisher-Yates dealing from the back → 0 / 5,400; sort-by-random-key
  → ≤ 0.152 consistency in the sweep.
- Each swap is exactly uniform under rejection (bias 0); under plain `mod N`
  the bias per swap is at most (2^32 mod N)/2^32 < 52/2^32 ≈ 1.2 × 10⁻⁸.

### Step 4: the deal

```
initial_cards = a[0], a[1], a[2], a[3], a[4]           # shown left to right
```

- SOURCE: DATA (5,400 / 5,400; dealing from the back 0 / 5,400). PAGE: Duel's
  Verify page labels the result "Initial Cards" followed by "Next 5 cards in
  the deck" (step4-verification-result.png), i.e. the deal is the top 5 cards
  and the draw comes from the next 5.

### Step 5: the draw

```
replacements = a[5], a[6], a[7], a[8], a[9]
t = 0
for p = 0 … 4:                                         # hand positions, left to right
    if initial_cards[p] is held: final[p] = initial_cards[p]
    else:                         final[p] = replacements[t]; t = t + 1
```

Non-held positions are filled **left to right** from the next deck cards, in
deck order. A held card keeps its position. The deck is fixed by
`(serverSeed, clientSeed, nonce)` before the hold is chosen: the hold is not an
input to any HMAC.

- SOURCE: DATA (+ PAGE "Next 5 cards in the deck", step4).
- Candidates tried: left to right in deck order → **5,400 / 5,400**;
  right to left → 811 / 5,400; positional (position p takes a[5 + p]) →
  1,739 / 5,400.
- Every round's held cards are a subset of its initial cards (5,400 / 5,400),
  the request and response hold lists are equal (5,400 / 5,400), and
  a[0..9] are 10 distinct cards (5,400 / 5,400).

### Step 6: independent check against Duel's public Verify page

step4-verification-result.png is Duel's Provably Fair > Verify page with
Game = Video Poker, Client seed `OIWrfjgI0qtip9f2`, Server seed
`dcef593aa600985411514f97945ef2dd63caeea7791a2f66e3a366aa253dc383`, Nonce 2.
Duel shows Initial Cards **4♠ A♥ 2♥ 3♣ 5♦** and Next 5 cards in the deck
**Q♥ Q♦ 7♦ 4♦ 10♠**. This spec gives
`['4S','AH','2H','3C','5D','QH','QD','7D','4D','10S']`, the same ten cards in
the same order. (Only the input-value lines of the page's code panel are
visible in that capture; no code was read from it. The capital `I` vs lower
`l` in the client seed is read from the code panel's input line; the match
confirms the reading.) The same seed and nonce are bet #624335377 in
step3-transaction-reveal.png, and step1-game-ui.png shows that hand
(4♠ A♥ 2♥ 3♣ 5♦) paid as "Straight 4x".

---

## 3. Hand evaluation, win condition and payout

### 3.1 Hand ranks (Jacks or Better)

Evaluate the 5 final cards. Ranks valued 2…10, J = 11, Q = 12, K = 13,
A = 14. First match wins, top to bottom:

| Rank (served `combination`) | Rule |
|---|---|
| `royal_flush` | straight flush 10-J-Q-K-A |
| `straight_flush` | straight and flush, not royal |
| `four_of_a_kind` | four cards of one rank |
| `full_house` | three of one rank + two of another |
| `flush` | five cards of one suit |
| `straight` | five consecutive ranks; **A-2-3-4-5 counts** (ace low); no wrap (Q-K-A-2-3 is not a straight) |
| `three_of_a_kind` | three of one rank |
| `two_pair` | two pairs |
| `jacks_or_better` | exactly one pair, of J, Q, K or A |
| `none` | anything else |

- SOURCE: PAGE for the rank names and order (paytable in step1-game-ui.png:
  "Royal Flush, Straight Flush, 4 of a Kind, Full House, Flush, Straight,
  3 of a Kind, 2 Pairs, Pair of Jacks or Better"); PAGE for the ace-low
  straight (step1 pays 4-A-2-3-5 as "Straight 4x"); STANDARD for the rest;
  CONFIG for the served names (`multipliers` keys).
- DATA: the evaluator applied to the recorded `final_cards` equals the served
  `combination` on **5,400 / 5,400** rounds. Ranks reached: none 4,204,
  jacks_or_better 698, two_pair 294, three_of_a_kind 144, straight 27,
  full_house 15, flush 15, four_of_a_kind 2, straight_flush 1, royal_flush 0.
  The royal flush rule, and the A-high-only royal, are unwitnessed in data (O3).

### 3.2 Multiplier (paytable)

CONFIG, tier 1 of `scaling_edge` (`min_bet 0`, `max_bet 1182.855407010385761`,
`house_edge "0.001"`), indexed in the order none, jacks_or_better, two_pair,
three_of_a_kind, straight, flush, full_house, four_of_a_kind, straight_flush,
royal_flush:

```
[0, 1, 2, 3, 4, 6, 9, 26, 58, 812.97194379]
```

The top-level `multipliers` object gives the same values except
`royal_flush: 812.9719437907615` (more digits; O3).

```
tier = the scaling_edge entry with  min_bet ≤ amount < max_bet
multiplier = tier.multipliers[rank index]
```

- SOURCE: CONFIG + PAGE (step1 shows 812x, 58x, 26x, 9x, 6x, 4x, 3x, 2x, 1x,
  and for a 0.1 stake "81.29719438" next to the royal flush).
- DATA: the served `multiplier` equals the tier-1 value for the evaluated rank
  on **5,400 / 5,400** rounds (and equals the top-level `multipliers` value on
  5,400 / 5,400; the two differ only on the royal flush, which never occurred).
- The config has 52 tiers, edge 0.001 to 0.0061. Higher tiers scale each
  multiplier by (1 − e)/(1 − 0.001), written to 8 decimals (e.g. tier 2,
  e = 0.0011: two_pair 1.9997998). Only tier 1 was exercised (O4).
- The config also carries a `probabilities` array per tier. It is the
  operator's claim and must not be read by an implementation.

### 3.3 Edge field

Every deal and draw response carries `effective_edge`, a percentage. It equals
`100 × tier.house_edge` (0.1) on **5,400 / 5,400** rounds (deal and draw).
SOURCE: CONFIG + DATA. The game UI labels the game "Zero Edge" (step1); the
edge served on every captured round was 0.1 %.

### 3.4 Payout

```
win  (multiplier > 0): amount_won = amount × multiplier
loss (rank none):      amount_won = 0
```

- SOURCE: STANDARD (stake × multiplier) + DATA: exact decimal equality on
  **5,400 / 5,400** rounds (e.g. 0.01 × 58 = `0.58`, 10 × 2 = `20`).
- Every witnessed multiplier is an integer, so no rounding was exercised. The
  rounding of a royal-flush or higher-tier payout (non-integer multiplier) is
  unwitnessed (O3, O4). step1 displays 0.1 × 812.9719437907615 as
  "81.29719438" (8 decimals); that is a display, not a settled payout.
- `amount_won` is in the same unit as the request `amount_coins`. The deal
  response's `amount_coins` (e.g. `0.010001`, `10.0008`) differs from the
  stake and is not used by the payout (O5).

### 3.5 Fields an implementation must not read

`initial_cards`, `final_cards`, `combination`, `multiplier`, `amount_won`,
`effective_edge` and the config `probabilities` are the operator's claims, to
be checked. The derivation reads only `serverSeed`, `clientSeed`, `nonce`,
`held_cards`, `amount` and the CONFIG `scaling_edge` table.

---

## 4. Source per step (summary)

| Step | Source | Evidence |
|---|---|---|
| Inputs: server seed (hashed / revealed), client seed, nonce | PAGE | step2, step3, step4 |
| Commitment = SHA-256 of hex-decoded seed, hex output | STANDARD + DATA | 5,400/5,400 (ASCII form 0/5,400) |
| Seed ↔ round pairing by hash | DATA | 110/110 hashes, 5,400/5,400 rounds |
| Deck = rank-major 2…A × D,H,S,C | DATA | 5,400/5,400; nearest other order 25/5,400 |
| HMAC-SHA256, key = hex-decoded server seed | STANDARD + DATA | 5,400/5,400 (ASCII key 0, SHA-512 0) |
| Message `clientSeed:nonce:k`, k = 0…50 per swap | STANDARD + DATA | 5,400/5,400 (`c:n` first 3,858; k from 1 0; k = i 0) |
| First 4 bytes, big-endian u32, `mod N` | DATA | 5,400/5,400 (LE 0, float 0, streamed 0) |
| Rejection `v ≥ floor(2^32/N)·N` → next k | STANDARD | not exercised (0 hits, 0.00075 expected); O1 |
| Backward Fisher-Yates, deal a[0..4] | STANDARD + DATA + PAGE | 5,400/5,400; forward 0, select 0, from back 0; step4 "Initial Cards" |
| Draw: non-held positions left to right from a[5..9] | DATA + PAGE | 5,400/5,400 (R→L 811, positional 1,739); step4 "Next 5 cards in the deck" |
| Reproduces Duel's own Verify page | PAGE | step4: all 10 cards, in order |
| Jacks-or-Better evaluator, ace-low straight | PAGE + STANDARD + DATA | 5,400/5,400; step1 4-A-2-3-5 = Straight |
| Multiplier = CONFIG tier[amount].multipliers[rank] | CONFIG + PAGE + DATA | 5,400/5,400 (tier 1 only) |
| effective_edge = 100 × tier.house_edge | CONFIG + DATA | 5,400/5,400 |
| Payout = amount × multiplier, exact | STANDARD + DATA | 5,400/5,400 (integer multipliers only) |

---

## 5. Test vectors (from the dataset)

Each vector is copied from `video-poker-dataset-5400bets.json`; the server seed
is the revealed seed whose SHA-256 equals the round's `serverSeedHashed`. Round
id = `hand_id` (with the `transaction_id`). "HMAC k=0" is the digest for the
first swap (i = 51); `j` lists the 51 swap targets for i = 51, 50, …, 1. Edge
0.1 % (tier 1) on all five.

**V1: hand_id 589162** (tx 556509221, Phase A, 3 held, loss)
```
serverSeed  2424d436197860c90bad4022573f14eab6c9da3dcc2d50e57ad7d52357f0fdc9
commitment  107cca7f92491e65e438a779d79dd253a16ccfef10d5ce5d31d2bcbb3ff22f7b
clientSeed  cpc4ihmPtvpHpapv   nonce 0   amount 0.01
HMAC k=0    msg "cpc4ihmPtvpHpapv:0:0"
            4ed6dc5abf2a0d7f4c905c4d32f34c9c55d7e62c4c33db49eb1e816300541c26
            u32 1322703962 → j(i=51) = 34
j           34 30 43 28 35 28 15 20 30 18 1 23 15 34 37 35 31 9 6 21 2 0 3 19 12 14
            24 3 13 4 14 6 17 1 16 1 4 12 4 7 2 5 4 6 0 1 5 2 0 1 1
a[0..9]     8H JS 4D 10D 4C | 4S KS AH KD QD
initial     8H JS 4D 10D 4C     held JS 4D 10D
final       4S JS 4D 10D KS     → none   multiplier 0   amount_won 0
```

**V2: hand_id 593949** (tx 556919346, Phase D player-set seed, the only straight flush)
```
serverSeed  f7c670b05ebea748011cfd9df0b4ebc82fa3e296f687aeb924abbd5c0fd60dd2
commitment  449a8c95beaebe1e188594f95944df260f578d8b84743c27b5cc773524566216
clientSeed  pfauditmod66jae   nonce 28   amount 0.01
HMAC k=0    msg "pfauditmod66jae:28:0"
            9f8c7a807bbb3f0855fead48a77634a31d0959a9cec22ab77af7db317e57f8ff
            u32 2676783744 → j(i=51) = 24
j           24 29 38 32 28 2 31 40 22 39 17 37 10 1 33 36 30 32 32 31 10 18 21 26 10
            13 10 1 10 16 4 14 9 4 5 8 1 0 6 12 5 0 4 0 2 6 5 1 0 2 0
a[0..9]     6C 2C 3C QC 5C | 4C KC KS 7C 10C
initial     6C 2C 3C QC 5C     held 6C 2C 3C 5C
final       6C 2C 3C 4C 5C     → straight_flush   multiplier 58   amount_won 0.58
```

**V3: hand_id 591339** (tx 556705526, Phase A, four of a kind)
```
serverSeed  ecfa3d7aa4433e9d7dfd87a208e213c70284c2b978fba10fb2cb7554b19e5849
commitment  a4764f4c6eb8f4908ba142f155ce43e412f9dc3a303eaaf155af01966e270a9d
clientSeed  N7yI44jUR2NcHQHr   nonce 13   amount 0.01
HMAC k=0    msg "N7yI44jUR2NcHQHr:13:0"
            a4d5829396b3477970f925ebdbeb8e643b9f2ba91b4f0572cef31f8b4531e04f
            u32 2765456019 → j(i=51) = 27
j           27 0 7 14 7 44 22 4 21 28 22 16 38 11 17 6 24 24 31 5 13 14 11 23 4 4
            13 18 0 17 7 14 18 9 10 11 8 9 3 12 8 5 3 4 6 3 1 3 2 1 0
a[0..9]     QD QS QH 2S QC | 2H 7D JD 8S 8H
initial     QD QS QH 2S QC     held QD QS QH QC
final       QD QS QH 2H QC     → four_of_a_kind   multiplier 26   amount_won 0.26
```

**V4: hand_id 593775** (tx 556905403, Phase C, 10 stake, win)
```
serverSeed  d2f479c131d62535e68de957ce53d0610337a310e965111a1ff434bd1c091e89
commitment  c6c491699ffbdf54564c9284d38d54025b3e57f3de018c22d72cc45adafeac0a
clientSeed  Msv09D5aCfx4wZnd   nonce 14   amount 10
HMAC k=0    msg "Msv09D5aCfx4wZnd:14:0"
            5da92f85692775445d04753b6ed6bd6b32f7e0a48cac0b0e81f2c98210ea0add
            u32 1571368837 → j(i=51) = 25
j           25 14 47 12 26 33 25 5 37 39 16 35 34 19 26 26 4 3 19 25 8 18 5 17 3
            25 7 14 8 16 7 12 10 6 6 6 5 13 11 11 8 5 8 3 4 6 4 1 2 2 0
a[0..9]     KS 2D 4H 2S 2H | 7H 7S QD 8C 7D
initial     KS 2D 4H 2S 2H     held KS 2D 2S
final       KS 2D 7H 2S 7S     → two_pair   multiplier 2   amount_won 20
```

**V5: hand_id 593883** (tx 556914268, Phase D, 0 held: full redraw, win)
```
serverSeed  edeaeeea31ffaeb8c647f89d5b3678cd3efba3d1cbfcb1cb852155ddb95c3d58
commitment  4b6beb7d9861be4d5f36b37b41690f71399256d5f218c100939670c7a4961165
clientSeed  pfauditmod66jae   nonce 12   amount 0.01
HMAC k=0    msg "pfauditmod66jae:12:0"
            1579c265bf89d56d614e04e7f76f2b751bfb2f131867718bcb66e3dc249bbd70
            u32 360301157 → j(i=51) = 21
j           21 41 41 13 33 34 35 26 0 22 36 15 34 12 21 17 9 24 12 31 14 14 2 13
            13 21 17 3 16 0 2 1 16 11 6 2 4 9 6 2 9 9 9 4 2 0 0 1 2 2 0
a[0..9]     4D 3H JC 3C 7D | 8C QS KC QD 4S
initial     4D 3H JC 3C 7D     held (none)
final       8C QS KC QD 4S     → jacks_or_better   multiplier 1   amount_won 0.01
```

**V6: Duel's public Verify page** (step4-verification-result.png; no round outcome, cards only)
```
serverSeed  dcef593aa600985411514f97945ef2dd63caeea7791a2f66e3a366aa253dc383
clientSeed  OIWrfjgI0qtip9f2   nonce 2
HMAC k=0    18ce2c5edcac268d59be1bdfae075746fa1f1c4464dde405d621cc1bdadcb0e6   u32 416164958
a[0..9]     4S AH 2H 3C 5D | QH QD 7D 4D 10S        (as shown by Duel)
```

---

## 6. Open points the public sources do not settle

- **O1: rejection and its continuation.** This spec rejects `v ≥ floor(2^32/N)·N`
  and moves to the next counter value `k + 1`, so every later swap shifts by
  one counter. Neither rejection itself nor the continuation (next counter vs
  next 4 bytes of the same digest vs plain `mod N`) is witnessed: the expected
  number of rejected draws in 5,400 rounds is 0.00075, and 0 occurred. It
  decides about 1.4 rounds in ten million. To settle it: Duel's written rules,
  or a (revealed seed, client seed, nonce) whose shuffle hits a rejection,
  found offline and then checked on Duel's Verify page.
- **O2: the pages name no algorithm.** The captured pages (step2, step3, step4)
  show the inputs and a result; none names HMAC, the key form, the separator,
  the counter, the deck order, the shuffle or the draw order. Everything in §2
  beyond the inputs rests on STANDARD + DATA and the step4 Verify-page result,
  not on a written Duel rule. Duel's `duel.com/provably-fair` Overview text was
  not captured for this game: a GET returns only the JavaScript shell, and a
  browser render on 20 Oct 2026 did not reach the page (§8).
- **O3: royal flush.** Never dealt (0 / 5,400). Its rule (10-J-Q-K-A suited),
  its multiplier (tier value `812.97194379` vs top-level `812.9719437907615`),
  and the rounding of its non-integer payout are unwitnessed. step1 displays
  "812x" and, for a 0.1 stake, "81.29719438".
- **O4: edge tiers.** Only tier 1 (`house_edge 0.001`, served as 0.1) was
  exercised: stakes 0.01 and 10 both fall in it. The boundary rule
  (`min_bet ≤ amount < max_bet`), the payout rounding with the 8-decimal
  higher-tier multipliers, and timing (config captured 5 Oct 2026, rounds on
  24 Apr 2026; it matches all 5,400, but the config live on 24 Apr was not
  captured) are not settled.
- **O5: stake basis.** The deal request carries `amount_coins` (`0.01`, `10`)
  and the response both `amount_currency` (equal to it) and `amount_coins`
  (`0.010001`…`0.010003`, `10.0007`…`10.0009`). Which of these selects the
  edge tier is not settled; `amount_won` matches the request amount × multiplier.
- **O6: client-seed encoding beyond ASCII.** UTF-8 is assumed. All captured
  client seeds are ASCII.
- **O7: holding by identity.** The draw request names held cards by card
  string, not by position. Since the 5 dealt cards are distinct, identity and
  position agree; behaviour on an invalid hold list (a card not in the hand)
  is not covered.
- **O8: drand / other entropy.** The config response's CSP lists
  `https://api.drand.sh`; no video-poker field refers to it and the spec uses
  none. If Duel ever mixes external entropy into this game, this spec does
  not describe it.

---

## 7. Reproduction of this spec

Implemented, independently of any audit package, in the spec author's check scripts
(throwaway, outside the repo:
`spec_check.py`, `alternatives.py`, `search2.py`, `vectors.py`) and run on
every round on 20 Oct 2026.

`python3 -I spec_check.py <dataset> <config>`:

```
revealed seed records 114, distinct seeds 110
commitment SHA256(hexdecode(serverSeed)) == bet serverSeedHashed: 5400/5400
  (candidate SHA256(ascii serverSeed): 0/5400)
REJECTION draws hit (u32 >= floor(2^32/N)*N): 0
init: 5400/5400
init_draw_resp_same: 5400/5400
held_req_eq_resp: 5400/5400
held_subset: 5400/5400
distinct10: 5400/5400
final_l2r: 5400/5400
final_r2l: 811/5400
final_positional: 1739/5400
final_fully_spec: 5400/5400
rank: 5400/5400
edge: 5400/5400
mult: 5400/5400
mult_top: 5400/5400
payout: 5400/5400
amt_cur_eq_req: 5400/5400
hold-count histogram: {'held_n_0': 948, 'held_n_1': 1088, 'held_n_2': 1442, 'held_n_3': 1111, 'held_n_4': 600, 'held_n_5': 211}
mismatching hand_ids: []
candidate counter k = i (51..1) instead of 0..50: initial hands 0/5400
candidate no rejection (plain mod): initial hands 5400/5400
E-step4 vector deck[0..9]: ['4S', 'AH', '2H', '3C', '5D', 'QH', 'QD', '7D', '4D', '10S']
```

`python3 -I alternatives.py <dataset>` (initial AND final hand):

```
5400/5400  SPEC: key=hexdecoded, HMAC-SHA256, msg c:n:k (k=0..50), first 4 bytes BE, mod (i+1), backward FY, deal from front, deck 2..A x D,H,S,C
3858/5400  msg c:n for k=0, then c:n:k
0/5400  msg c:n:k with k starting at 1
0/5400  msg n:c:k
0/5400  key = ASCII hex string
0/5400  HMAC-SHA512
0/5400  4-byte stream across digests (8 numbers per HMAC)
0/5400  u32 little-endian
0/5400  float (u32/2^32) x N, floored
0/5400  forward Fisher-Yates
0/5400  select from remaining
0/5400  deal from back of deck
0/5400  deck suit order C,D,H,S
25/5400  deck suit order S,H,D,C
0/5400  deck suit-major D,H,S,C x 2..A
```

---

## 8. Files and URLs opened while writing this spec

Read: `evidence/` `step1-game-ui.png`,
`step2-fairness-page.png`, `step3-transaction-reveal.png`,
`step4-verification-result.png`, `client-seed-origin.png` (shows Duel's
client-seed *generator* in the browser bundle, not the video-poker derivation),
`config/duel-video-poker-config-2026-10-05.captured.json` and its `.meta.json`;
`data/video-poker-dataset-5400bets.json`;
the audit framework's `games/video-poker/profile.json`;
the audit framework's `games/dice/ALGORITHM.md` (model of shape).

URLs, 20 Oct 2026, GET only, no login, no bets: `https://duel.com/provably-fair`
by curl (returned the 4,304-byte JavaScript shell, no prose) and in a
automated browser (the page text read back was a Duel 404 page at another
URL, with no provably-fair content; nothing from it is used here).

Not opened: anything under `video-poker/evidence/verify-tab/` or any
`verifier-parity` path, any `src/`, `tests/`, `scripts/`, `capture/`,
`verify.js`, `test.js`, `MANIFEST.md` or `README.md` of any Duel package, any
saved Duel JS bundle, or Duel's live Verify tab.
