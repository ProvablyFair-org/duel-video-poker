# Duel Video Poker — Verifier

Independent verifier for the ProvablyFair.org audit of **Duel.com Video Poker** (Jacks or Better, 9/6 pay table).

- **Audit report:** https://audit.provablyfair.org/casino/duel/games/video-poker/overview
- **Audit ID:** PF-2026-DL08
- **Audited:** April 2026
- **Algorithm:** HMAC-SHA256-driven Fisher-Yates shuffle of the 52-card deck with rejection sampling (bias-free indices, `maxFair` ceiling)
- **Optimal-play RTP:** 99.9000% (exhaustive enumeration of C(52,5) = 2,598,960 dealt hands × all 32 hold patterns × hand evaluation)

## What's in this repo

This is the verification codebase for a card game audit. It re-derives every audited deal AND final hand from the captured dataset, computes the optimal-play RTP from exhaustive enumeration, and cross-validates against the Wizard of Odds 9/6 Jacks or Better reference (99.5439%).

## Reproduce

```sh
git clone git@github.com:ProvablyFair-org/duel-video-poker.git
cd duel-video-poker
npm install
npm run compute-optimal-rtp   # exhaustive C(52,5) enumeration (~1 min, generates optimal-play-rtp.json)
npm test                      # unit tests + 10M-round simulation + 27-step verification
```

`npm run compute-optimal-rtp` is a separate first step because it does an exhaustive enumeration of all C(52,5) = 2,598,960 dealt hands, computing the optimal-play RTP for each. It writes `outputs/optimal-play-rtp.json`, which `npm test` consumes in Step 26 (Optimal-Play RTP Verification). Expected: 27/27 PASS, **PROVABLY FAIR — Full Pass**.

Individual scripts:

```sh
npm run compute-optimal-rtp   # exhaustive C(52,5) enumeration of optimal-play RTP (~1 min)
npm run simulate              # 10M-round simulation (Fisher's method, 10 streams × 1M)
npm run verify                # 27-step verification (deal + final hand + optimal-play RTP)
```

## Dataset

- **File:** `data/video-poker-dataset-5400bets.json`
- **SHA-256:** `363fd4d4c072a1180ca2e7ab61d0c8dcc6f3300f315449af0d7101dd45dd0654`
- **Bets:** 5,400 (each carries dealt hand, hold pattern, and final hand)

## Card-game-specific notes

Video Poker uses a different audit framework than slot/dice/crash games:
- **Optimal-play RTP** computed from exhaustive enumeration, not just simulation
- **Cross-validation** against an external reference (Wizard of Odds 9/6 Jacks or Better at 99.5439%)
- **Two-layer verification**: deck state after shuffle AND final hand after hold-and-draw — both reproduced for each of 5,400 bets

## License

MIT
