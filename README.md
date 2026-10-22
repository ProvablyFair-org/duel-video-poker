# Duel Video Poker — Provably Fair Audit

**Auditor:** [ProvablyFair.org](https://www.provablyfair.org) · **Audit ID:** PF-2026-DL08 · **Release:** `v1.2.1` · **Capture:** 24 April 2026

**Result: PROVABLY FAIR — Full Pass.** All 5,400 captured hands reproduce: the shuffled deck, the dealt hand, the replacement pool, the final hand and the payout match recomputation with 0 mismatches. The package's RNG code was rebuilt from a written specification ([docs/ALGORITHM.md](docs/ALGORITHM.md)) by an implementer who never opened Duel's code; Duel's published Verify-tab code ([E19](MANIFEST.md#evidence)) is run as a second check, not used as the source. The verifier reports 27 passing steps out of 28, one disclosed capture-origin flag and no hard failures. The flag concerns two nonces the capture missed on retried requests; it does not identify an operator defect.

**Scope:** Video Poker (Jacks or Better) on Duel.com, played from a single funded test account at $0.01 and $10 stakes (tier 0 of the 52-tier bet-size scale in the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), [pinned here](evidence/config/duel-video-poker-config-2026-10-05.captured.json)). Under optimal play the captured pay table returns **99.9000%** for bets up to $1,182.85 (tier 0), independently computed by exhaustive enumeration and conditional on the pinned `videoPokerConfig.json`; the top tier returns 99.39% (see [Bet-size scaling](MANIFEST.md#bet-size-scaling)). Single-account testing cannot rule out differential treatment across accounts, and higher tiers are covered from that configuration, not live bets.

## What was verified

| Check | Captured evidence |
|---|---|
| Decks and hands | 5,400 of 5,400 decks, dealt hands and final hands recomputed from server seed, client seed, nonce and the recorded holds, with RNG code rebuilt from the written specification [docs/ALGORITHM.md](docs/ALGORITHM.md) |
| Seed records | 115 entries; 110 revealed server seeds hash to their commitments; 114 forward links plus the pre-capture anchor. These are consistency checks; that each commitment was shown before its bets rests on the capture's rotation snapshots, with capture integrity assumed ([premise P5](MANIFEST.md#load-bearing-premises)) |
| Payouts | 1,196 wins and 4,204 losses settled exactly on the served decimal strings (integer 1e-18 units, no tolerance) |
| Pay table | The served multiplier equals `videoPokerConfig.json` on 5,400 of 5,400 hands; live play finished on 9 of the 10 ranks (no royal flush) |
| Hand classification | 5,400 of 5,400 match the independent evaluator, which is cross-validated against `pokersolver` on 10,000 random hands |
| Optimal-play RTP | 99.900000% for the tier-0 pay table, from all C(52,5) = 2,598,960 deals × 32 hold patterns; the same engine reproduces 9/6 Jacks or Better at 99.5439% |
| Simulation evidence | 10,000,000 Pass 1 deal-only rounds (Fisher's p = 0.7982) and 110 casino seeds × 100,000 nonces in Pass 2 |
| Player verification | Duel's own Verify-tab code, run as a second check and not as the source, and the ProvablyFair.org player verifier both agree with all 5,400 hands |

The capture gaps, single-account scope and residual operator trust are retained in the [overview's limitations](MANIFEST.md#limitations-and-trust).

## Run the audit

Open a terminal in the package directory. Use **Node 22.x**, as declared in [.nvmrc](.nvmrc) and [package.json](package.json).

```sh
npm ci
npm test
```

Expected: **58 unit tests pass; 27 PASS + 1 capture-origin FLAG; zero hard failures; REPRODUCED; exit 0.** This replays every captured hand, checks the pinned artifacts and compares fresh verification results with the committed evidence. It does not rerun the simulation or the optimal-play enumeration. The exit code is the verdict: `0` PROVABLY FAIR — Full Pass · `2` PROVABLY FAIR — Conditional Pass · `5` RTP FIGURE OVERSTATED (the RTP-CLAIM rule 1.2.0 found a published RTP figure above the game's real RTP; the draws pass) · `1` NOT PROVABLY FAIR, or a reproduction difference.

**RTP claim (RTP-CLAIM 1.2.0, switched on).** The tier-0 optimal-play RTP (the pinned exhaustive solve, 99.900000%) is held to the 0.1% edge Duel's game settings state for stake tier 0 (house_edge "0.001", E20). Scored on Step 26: PASS, inside the 0.1 pp band ([table](outputs/rtp-claim-table.json)). Tiers 1–51 are not tabled. The "Zero Edge" label is noted, not tested.

```sh
npm run test:full                 # optional: also re-derives the simulation and the optimal-play enumeration
node scripts/release-manifest.mjs --check
```

Ordinary runs write to `outputs/run/` and leave the evidence of record intact. See [reproduction details](MANIFEST.md#reproduce-the-audit) for the comparison rules, exit codes, mutation battery and deliberate artifact-refresh procedure.

## Verify a bet

Save the hashed server seed shown before you play. After rotation reveals the server seed, check that `SHA-256(hexDecode(serverSeed))` equals the value you saved, not a hash shown to you after the reveal. A match (PASS) means the two hashes are equal; the assurance that the seed was fixed before you played comes from your saved copy, made before the bet. Then use the [ProvablyFair.org verifier](https://www.provablyfair.org/verify-bets) to reproduce the deck, or follow the [complete verification instructions](MANIFEST.md#verify-a-bet). Those cover the commitment encoding, the shuffle, the draw replacement and the payout. The payout uses the pay table of your stake's tier: `videoPokerConfig.json`, which is also the pay table in this package's copy of the ProvablyFair.org verifier's code (`verifier-parity/`), is the tier-0 table, for stakes up to $1,182.85 (stored `max_bet` 1182.855407010385761). For a larger stake, take the multiplier from your stake's tier in the [duel.com config](evidence/config/duel-video-poker-config-2026-10-05.captured.json) (E20), as step 4 of the instructions describes; a $1,200 Jacks or Better hand, for example, is in tier 1 and pays 0.9998999x, $1,199.87988.

## Files and evidence

There are two documentation files: this README and [MANIFEST.md — consolidated audit overview](MANIFEST.md). The overview contains the game rules, algorithm, RTP calculation, verification results, evidence, limitations and release history.

- [Captured hands](data/video-poker-dataset-5400bets.json) — SHA-256 `363fd4d4c072a1180ca2e7ab61d0c8dcc6f3300f315449af0d7101dd45dd0654`.
- [Captured pay table](videoPokerConfig.json) (tier 0, stakes up to $1,182.85) — SHA-256 `9daedc8fc7a53e328d50b5e8019c177b32d5bf7992494a7da18136f524a70542`.
- [Verification results](outputs/verification-results.json), [optimal-play RTP](outputs/optimal-play-rtp.json), [RTP claim table](outputs/rtp-claim-table.json), [simulation results](outputs/simulation-results.json) and [release manifest](RELEASE-MANIFEST.json).
- [Audit report](https://audit.provablyfair.org/casino/duel/games/video-poker/overview) · [Public repository](https://github.com/ProvablyFair-org/duel-video-poker) · [MIT license](LICENSE).

The consolidation and every later change are recorded in the [release history](MANIFEST.md#release-history).
