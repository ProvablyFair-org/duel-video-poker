# Manifest — Duel Video Poker Audit

- **Audit ID:** PF-2026-DL08
- **Publication date:** 4 June 2026
- **Audit report:** https://audit.provablyfair.org/casino/duel/games/video-poker/overview
- **Auditor:** ProvablyFair.org
- **Audit date:** April 2026
- **Game variant:** Jacks or Better, 9/6 pay table

## Algorithm

HMAC-SHA256-driven Fisher-Yates shuffle of the 52-card deck with rejection sampling (bias-free indices, `maxFair` ceiling). After the initial 5-card deal, the player chooses a hold pattern (one of 32 subsets); the unheld cards are replaced by consuming the next positions from the same shuffled deck.

```
key       = hexDecode(serverSeed)
cursor    = 0
deck      = [card_0, card_1, ..., card_51]
MAX_UINT32 = 0xFFFFFFFF
for i in 51..1:
    range   = i + 1
    maxFair = MAX_UINT32 - (MAX_UINT32 % range)   // rejection ceiling — removes modulo bias
    message = clientSeed + ":" + nonce + ":" + cursor
    hmac    = HMAC-SHA256(key, message)           // 64 hex chars = 8 four-byte chunks
    j       = null
    for off in [0, 8, 16, 24, 32, 40, 48, 56]:
        value = parseInt(hmac[off .. off+8], 16) as UInt32
        if value < maxFair:
            j = value % range
            break
    if j == null:
        throw "rejection exhausted"               // probability ≈ (4 / 2^32)^8 ≈ 10^-75
    swap deck[j], deck[i]
    cursor += 1
dealt   = deck[0..4]
pool    = deck[5..9]                              // up to 5 replacement cards
final   = combine(dealt, held, pool)              // unheld positions consume pool L→R
payout  = bet × payoutTable[evaluateHand(final)]
```

## Dataset

- **File:** `data/video-poker-dataset-5400bets.json`
- **SHA-256:** `363fd4d4c072a1180ca2e7ab61d0c8dcc6f3300f315449af0d7101dd45dd0654`
- **Total bets:** 5,400

## Verification

- **Verification steps:** 27 scored steps in `tests/verify.ts`
- **Unit tests:** Mocha (`tests/**/*Tests.ts`)
- **Simulation:** 10,000,000 rounds (Fisher's method, 10 streams × 1M)
- **Optimal-play RTP:** 99.9000% from exhaustive C(52,5) = 2,598,960 dealt-hand enumeration × 32 hold patterns × hand evaluation
- **External cross-validation:** Wizard of Odds 9/6 Jacks or Better at 99.5439% — the difference reflects Duel's house edge adjustment (0.1% flat)
- **Verification layers:** deck state after shuffle AND final hand after hold-and-draw — both reproduced for each of 5,400 bets
- **Expected `npm test` result:** 27/27 PASS · PROVABLY FAIR — Full Pass

## Reproducibility

Cloning this repo at the publication commit and running `npm install && npm test` reproduces the entire audit pipeline. The dataset hash is verified at startup; the verifier recomputes every dealt hand AND final hand from `(serverSeed, clientSeed, nonce, holdPattern)`; the optimal-play RTP is independently computed by `npm run compute-optimal-rtp` (no operator-supplied probability data).
