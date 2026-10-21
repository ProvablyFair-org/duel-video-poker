/**
 * Which ProvablyFair.org Video Poker profile check each scored step implements.
 *
 * The profile (pf-audit-framework games/video-poker/profile.json, 1.0.2, VP-01 … VP-32) is a
 * PROPOSAL pending the profile owner. This suite scores 28 steps under its own numbering, which every
 * chapter cites and which therefore is not renumbered. The mapping is declared here, emitted into
 * outputs/verification-results.json beside the step results, and read back by `pf-audit matrix`.
 *
 * THIS FILE LABELS; IT DOES NOT CHECK. A check is claimed only where the step's assertion decides the
 * profile's `asserts` text (written 2026-09-26 from the step code as it stands after that day's additions).
 *
 * COVERAGE DESCRIBES THE PACKAGE, NOT THE STEP.
 *   full    — nothing the profile's `asserts` requires is unimplemented; a check split across steps is
 *             `full` on each, and each note says which half it carries.
 *   partial — something the profile requires is implemented nowhere in this package; the note says what.
 */

export type Coverage = 'full' | 'partial';

export interface CheckClaim { id: string; coverage: Coverage; note?: string }
export interface StepClaims { claims: CheckClaim[]; reason?: string }

export const PROFILE_GAME = 'video-poker';
export const PROFILE_VERSION = '1.0.2';

const VP06 = 'PARTIAL for disclosures the capture cannot supply: the phase A/B/C/E client seeds came from Math.random() '
  + '(capture/capture.reference.js:212-216 generateClientSeed; 4,900 of 5,400 bets, MANIFEST DL-2), and Phase D used ONE predictable '
  + 'seed, pfauditmod66jae (\'pfaudit\' + Date.now().toString(36), capture/capture.reference.js:334) on all 500 Phase D bets across 11 '
  + 'bet-bearing epochs — below the ≥ 2 distinct Phase D seeds floor, and the exposed epochs are not enumerated by a step '
  + '(MANIFEST DL-3). Classified RULE-NEWER-THAN-CAPTURE (captured 2026-04-24, standard 2026-09-23): capture-origin, disclosed, '
  + 'not a recapture request';
const VP10 = 'deck, deal & draw structure split across Steps 19 (rank = evaluator on the served final hand), 20 (held ⊆ initial, '
  + '|held| ≤ 5), 21 (non-held positions filled from deck[5..9] left to right) and 22 (deck[0..9] = 10 distinct valid cards), '
  + 'each bound to EXPECTED_BETS = 5,400';
const VP15 = 'coverage split: Step 11 (single declared config; 9 of 10 hand ranks reached live, the never-reached royal_flush named '
  + 'with its deal-stage RTP share in outputs/payout-coverage.json) and Step 25 (8 planned hold patterns × 100 asserted '
  + 'against EXPECTED_PHASE_E_HOLD_PATTERNS)';
const VP22 = 'rank (Step 23, 13 ranks, χ² at α = 0.01) and suit (Step 24, 4 suits) fit of all 27,000 dealt cards; informational '
  + '(policy INFORMATIONAL, Mike 2026-09-29): a rejection at α = 0.01 is INFO — reported, never counted, verdict unchanged '
  + '(it was a FAIL until this ruling); an unplaceable card or a short card count still FAILs';

export const STEP_CLAIMS: Record<number, StepClaims> = {
  1: { claims: [{ id: 'VP-01', coverage: 'full', note: 'all 115 seed records walked; 110 revealed plaintexts hash to their commitment; population bound to EXPECTED_SEEDS / EXPECTED_REVEALED_EPOCHS' }] },
  2: { claims: [{ id: 'VP-02', coverage: 'full', note: '114 forward links recomputed from raw hashes plus the pre-capture anchor; the capture script\'s own match flags are re-checked, not trusted' }] },
  3: { claims: [{ id: 'VP-03', coverage: 'full', note: 'epochs keyed by the rotation timeline, not by the bets\' own hash; same server-seed hash AND same client seed within each of the 110 bet-bearing epochs' }] },
  4: { claims: [{ id: 'VP-04', coverage: 'full', note: 'duplicates and gaps are FAILs unless they match the 2 capture-retry gaps pinned in src/loader.ts, which are a capture-origin FLAG (verdict-neutral, MANIFEST DL-1); an unrevealed-seed gap is a FAIL' }] },
  5: {
    claims: [
      { id: 'VP-07', coverage: 'full', note: 'every bet recomputed to its served initial hand AND final hand with the served holds; recomputed count must equal EXPECTED_BETS; a reconstructed or unrevealed bet is a FAIL' },
      { id: 'VP-24', coverage: 'full',
        note: 'the ProvablyFair.org docs-site verifier (VerifyBets games/video-poker derive.js + evaluator.js + paytables.js + '
          + 'lib/hmac-sha256.js, read with git cat-file from mikepforg/pf-audit-duel origin/main @ bd4d59c on 2026-09-26) is '
          + 'vendored byte-exact under verifier-parity/ and its four SHA-256 recorded in src/site-verifier.ts; Step 5 FAILs '
          + 'unless every copy hashes to its pin, then runs the site\'s own deriveVideoPoker on all 5,400 bets with their '
          + 'served holds and FAILs on any initial hand, final hand, hand rank or multiplier that differs from the served '
          + 'value (measured 0 differ). Not checked: the LIVE www.provablyfair.org bundle' },
    ],
  },
  6: { claims: [{ id: 'VP-06', coverage: 'partial', note: `influence half — 500 sampled bets must ALL change deck under a wrong client seed (the chance-collision expectation for a 52-card permutation is below 1e-60, so no exception is allowed); ${VP06}` }] },
  7: { claims: [{ id: 'VP-11', coverage: 'full', note: 'exact on the served decimal strings: integer 1e-18 units (BigInt), amount_won × 10^18 = amount_coins × multiplier for all 1,196 wins, 0 for all 4,204 losses; off-grid product is an error, no rounding rule assumed. Replaced relative 1e-12 on parsed doubles (2026-09-26)' }] },
  8: { claims: [{ id: 'VP-13', coverage: 'full', note: 'served multiplier === videoPokerConfig.json value for the served rank on 5,400/5,400; the table is the operator config endpoint (GET /api/v2/video-poker/config, file field `source`), pinned in src/loader.ts and by the pre-flight; the derivation reads no operator odds field' }] },
  9: { claims: [{ id: 'VP-12', coverage: 'partial', note: 'all 100 Phase C ($10) bets recompute deal and final hand, classify to the served rank, are served the paytable cell of that rank and are credited exactly stake × multiplier. PARTIAL: 18 of the 100 are paying hands, below the ≥ 100 elevated-stake paying hands the profile asks for (MANIFEST DL-5). Searched: the dataset has two stakes (0.01 ×5,300, 10 ×100). Classified RULE-NEWER-THAN-CAPTURE' }] },
  10: { claims: [{ id: 'VP-31', coverage: 'full', note: 'all 10,800 served effective_edge values (deal + draw of 5,400 bets) equal 0.1 exactly; every captured bet was served tier 0 (0.1); higher tiers per E20, the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET) (MANIFEST Bet-size scaling); the field is the bet\'s tier edge, not an adjustment to the credited payout (MANIFEST premise P3) — every credited payout equals stake × paytable multiplier exactly (Step 7)' }] },
  11: {
    claims: [
      { id: 'VP-14', coverage: 'full', note: 'multipliers non-increasing along royal_flush > … > none (812.9719437907615 ≥ 58 ≥ 26 ≥ 9 ≥ 6 ≥ 4 ≥ 3 ≥ 2 ≥ 1 ≥ 0); an inversion makes Step 11 a FLAG (disclosed); the tier-0 table declares no cap; the full duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET; E20) ends its bet tiers at a max_bet of 6189.485121034804251 (about $6,189.49), where a Royal Flush\'s profit is $5,000,000.00 (MANIFEST Bet-size scaling)' },
      { id: 'VP-15', coverage: 'full', note: VP15 },
    ],
  },
  12: { claims: [{ id: 'VP-05', coverage: 'full', note: 'epoch-size histogram half — 110 epochs matching the pinned multiset (106 × 50, 2 × 49, 2 × 1), cap 50, summing to EXPECTED_BETS' }] },
  13: { claims: [{ id: 'VP-05', coverage: 'full', note: 'population half — 5,400 bets / 115 seeds and every phase count from src/loader.ts constants; meta.phaseBetCounts reconciled against them, never the denominator' }] },
  14: { claims: [{ id: 'VP-26', coverage: 'full', note: 'dataset AND videoPokerConfig.json SHA-256 pinned in src/loader.ts; the pre-flight aborts before any step on either mismatch; Step 14 re-asserts both and prints the measured hashes' }] },
  15: { claims: [{ id: 'VP-06', coverage: 'partial', note: `Phase D half — all 500 Phase D bets recompute under an auditor-set seed distinct from Phase A; ${VP06}` }] },
  16: { claims: [{ id: 'VP-18', coverage: 'full', note: 'all C(52,5) = 2,598,960 hands enumerated by the package evaluator reproduce the published rank counts exactly; deal-only RTP from those counts and the pinned table, no operator probability field; negative control: 10 of 10 corrupted rank tallies rejected. Per-hand rejection of a wrong served rank is Step 19' }] },
  17: { claims: [{ id: 'VP-20', coverage: 'full', note: '10,000,000 rounds (10 × 1,000,000) on pinned seeds, artifact pinned (Step 28), regenerated by npm run test:full and diffed at tolerance. Every statistic RE-DERIVED IN VERIFY from rows the artifact ships (since 2026-09-26): the 10 per-stream hand-rank counts (each stream χ² and p, Fisher\'s statistic and p, pooled counts, empirical RTP — FAIL probed M17b); the 10 × 10 rank-transition census of the concatenated 10,000,000-hand sequence, whose marginals must reconcile exactly with the histograms and from which lag-1 r / z and the runs count / z / p are recomputed (the artifact\'s own scalars must agree; the verdict uses the recomputation — FAIL probed M17c); and a dealt-card census, 10 deck positions (5 dealt + 5 replacement) × 52 cards, each position χ² (df 51) against uniform at family α 0.01, Bonferroni 0.001 (smallest p 0.0015 — FAIL probed M17d). RTP convergence tracked against the exact deal-only RTP. The census is exact integer content; figures unchanged by the 2026-09-26 regeneration (8a1771d7 → db2253de: only the census fields added). Re-pinned 2026-10-20 (db2253de → 9ebc1076) after regeneration with the RNG rebuilt from docs/ALGORITHM.md: one Pass 1 round changed at a rejected draw (dealt-card census, 20 cells ±1); every per-stream rank count, Fisher\'s p 0.798239 and the serial census unchanged' }] },
  18: { claims: [{ id: 'VP-21', coverage: 'full', note: '110 revealed seeds × 100,000 nonces (≥ 10,000 floor), bound to EXPECTED_REVEALED_EPOCHS; 2,000 disjoint windows of 50 per seed, window 0 = the captured epoch (nonces 0–49). Statistic (pre-registered, since 2026-09-26): the deal-only return of the hands dealt in window 0 ranked among its seed\'s 2,000 windows — an exact permutation null per seed (window 0 exchangeable with the others under no cherry-pick), rank sums over seeds standardised by the exact permutation variance into Z; FAIL at Z < −3.090 (one-sided α 0.001, the Duel limbo Step 19 rule). Every window re-derived in verify from the shipped integer window census, reconciled exactly with each seed\'s rank counts; windows 0 and 1,999 of every seed dealt again from the revealed seed in verify and equal to the census, and all 5,400 captured deals reproduced by the window-0 replay. Measured Z = −0.018; detection power printed (≥ 50 % when ≥ 18.9 % of seeds\' captured windows sit in their worst decile). FAIL probed M18c / M18d. The chi-squared flag count (5 flagged, binomial p 0.6485) is still recomputed and reconciled but no longer decides the step. The sum of 110 per-seed rank sums is referred to the normal with its exact permutation variance (as in limbo), not enumerated' }] },
  19: { claims: [{ id: 'VP-10', coverage: 'full', note: `rank half — ${VP10}` }] },
  20: { claims: [{ id: 'VP-10', coverage: 'full', note: `hold half — ${VP10}` }] },
  21: {
    claims: [
      { id: 'VP-10', coverage: 'full', note: `draw half — ${VP10}` },
      { id: 'VP-17', coverage: 'full', note: 'the HMAC message is clientSeed:nonce:cursor (src/rng.ts) — no hold field; witnessed on data: every bet\'s final hand recomputes from the same deck with its served holds (Step 21, 5,400) across all 8 planned hold patterns (Step 25)' },
    ],
  },
  22: {
    claims: [
      { id: 'VP-10', coverage: 'full', note: `deck half — ${VP10}` },
      { id: 'VP-08', coverage: 'full', note: 'computed from the shuffle\'s own ceiling (src/rng.ts maxFairFor): for every range 2…52, maxFair is a whole number of ranges — each swap index exactly uniform, bias 0; worst per-chunk rejection probability printed; rejection census over the capture printed (275,400 swaps, 0 rejected chunks)' },
    ],
  },
  23: { claims: [{ id: 'VP-22', coverage: 'full', note: VP22 }] },
  24: { claims: [{ id: 'VP-22', coverage: 'full', note: VP22 }] },
  25: {
    claims: [
      { id: 'VP-15', coverage: 'full', note: VP15 },
      { id: 'VP-17', coverage: 'full', note: 'hold-pattern witness: 800 Phase E bets over the 8 planned patterns recompute to their served final hand and rank from the deck fixed at deal' },
    ],
  },
  26: { claims: [{ id: 'VP-19', coverage: 'partial', note: 'optimal-play RTP 99.900000 % by exhaustive enumeration (2,598,960 deals, 134,459 classes), cross-validated on 9/6 Jacks or Better 99.543904 %, computed against the pinned config (payTableHash re-checked); npm test asserts the pinned artifact\'s figures ± 0.0001 pp against the published constants (the profile allows this), and npm run test:full re-runs the enumeration into outputs/run/ and diffs it at tolerance (2026-09-26 regeneration byte-identical apart from the removed run metadata). Since 2026-10-14 (Methodology v1.1, D4) the RTP-CLAIM rule 1.2.0 holds this figure to the 0.1 % edge the game settings state for stake tier 0 (E20 scaling_edge id 1; src/rtp-settings.ts, outputs/rtp-claim-table.json): PASS. PARTIAL because only tier 0 is tabled: tiers 1–51 of E20 have no optimal-play solve in this package (DL-9); the declaration\'s gameModel.edge.claimed stays null (listed in unknowns). Classified PAGE-READ' }] },
  27: { claims: [{ id: 'VP-32', coverage: 'full', note: 'reconstructed (gap-filled) records are counted and named by bet index; 0 in this capture; Step 5 FAILs on any reconstructed record, so none is ever scored as recomputed' }] },
  28: { claims: [{ id: 'VP-27', coverage: 'full', note: 'optimal-play-rtp.json, simulation-results.json and rtp-convergence.html pinned in src/artifact-pins.ts, un-ignored by name, never written by verify (verify writes only outputs/run/); no pinned or committed artifact carries run metadata (the pin itself FAIL-probed by M28, M28b, M17, M26). VALUE DOMAINS (src/domains.ts, 2026-09-26): Step 28 validates every numeric leaf (5,088) of the five committed JSON artifacts — simulation-results, optimal-play-rtp, chi-squared-results, determinism-log, payout-coverage — in both directions, bounds from src/loader.ts, src/rng.ts and the pinned pay table: an impossible value FAILs even when re-pinned (M28c), an undeclared numeric leaf FAILs (M28d). verification-results.json is the run record, compared field by field at the reproduction tolerance' }] },
};

export const NOT_APPLICABLE: Array<{ id: string; reason: string }> = [
  { id: 'VP-16', reason: 'applies = { money.balanceField, notNull: true }; declared null — no deal or draw response carries a running balance (measured over every key of the pinned dataset 2026-09-26: no key matching /bal|wallet/i)' },
];

export const PACKAGE_CHECKS: Array<{ id: string; artifact: string; coverage: Coverage | 'none'; note: string }> = [
  { id: 'VP-09', artifact: 'docs/ALGORITHM.md + tests/videoPoker/RngSpecTests.ts + evidence/verify-tab/duel-verify-tab-video-poker-2026-04-23.captured.json + src/operator-verifier.ts + tests/videoPoker/VideoPokerTests.ts (Second check block) + Step 5', coverage: 'full',
    note: 'REWRITTEN 2026-10-20 (v1.2.0). src/rng.ts is rebuilt from a written specification, docs/ALGORITHM.md '
      + '(framework games/video-poker/ALGORITHM.md), by an implementer who never opened Duel\'s code; Duel\'s published '
      + 'Verify-tab code is run as a second check, not used as the source. Through v1.1.0 src/rng.ts was a port of that code '
      + 'and cited 13 of its lines (OPERATOR_SOURCE_CITES); the port and the citation table are gone. The Verify-tab code was '
      + 'captured 2026-04-23 during a browser session on duel.com and is vendored byte for byte (SHA-256 f7e02787…) and pinned '
      + 'with its runner. The asserts: (1) unit tests reproduce captured rounds from their revealed seed against the operator\'s '
      + 'published algorithm — the Second check block in tests/videoPoker/VideoPokerTests.ts EXECUTES the code unedited on the '
      + 'two live pilot rounds and requires their live cards; (2) fixed vectors — the same block pins the ten cards of pilot '
      + 'nonce 1 and the deal of nonce 3, and tests/videoPoker/RngSpecTests.ts runs the spec\'s own vectors and properties '
      + 'against src/rng.ts (80/80); (3) "the adapter cites the operator source line it ports" — superseded for this package by '
      + 'the 20 Oct 2026 rule that RNG code is rebuilt from a written spec: nothing is ported, so no operator line is cited; '
      + 'docs/ALGORITHM.md §4 names the source of every step instead (Duel\'s public pages, the standard construction, or the '
      + '5,400 live hands). Step 5 also runs the code on all 5,400 hands: deck[0..9] = src/rng.ts, deal = served, served holds '
      + 'on its replacements = served final hand (0 differ). The two differ only on a rejected draw (docs/ALGORITHM.md O1), '
      + 'which none of the 275,400 captured draws hit. FAIL probed: M05d (capture edited without re-pin), M05e (operator swap '
      + 'forged AND re-pinned). The capture predates the other games\' 2026-09-25 copies and was not re-copied (MANIFEST DL-8)' },
  { id: 'VP-23', artifact: 'MANIFEST.md#exploit-testing', coverage: 'full',
    note: 'framework rows S5-1 … S5-8 mapped onto the report\'s S1–S10, each tied to a step; S5-5 Not tested (disclosed)' },
  { id: 'VP-25', artifact: 'MANIFEST.md#verify-a-bet', coverage: 'full',
    note: 'in order: where the seed is revealed (E15, E16), which fields to paste, the commitment encoding SHA-256(hexDecode(serverSeed)), the deal/draw derivation and payout' },
  { id: 'VP-28', artifact: 'package.json engines + test:full + MANIFEST.md#fresh-clone-reproduction-record', coverage: 'full',
    note: 'FRESH CLONE RUN 2026-09-26: git clone of ProvablyFair-org/pf-duel-workspace at 8f13658 (this package as committed in '
      + '6a2dfe2), Node v22.23.1: npm ci exit 0; npm test exit 0 — 56 passing, 27/28 + 1 capture-origin FLAG, PROVABLY FAIR — '
      + 'Full Pass, REPRODUCED; npm run test:full exit 0 — the 10M + 11M-round simulation regenerated into outputs/run/, '
      + 'rtp-convergence.html byte-identical, simulation-results.json identical apart from its generatedAt line, diff recorded in '
      + 'outputs/run/diff.json (reproduced: true, runtime 22.23.1); no tracked file modified. Audit ID PF-2026-DL08; engines 22.x. '
      + 'The clone tested the COMMITTED tree; the 2026-09-26 round-2 changes (metadata-free re-pins, operator code, re-derivation) '
      + 'are verified in the working copy only until they are committed and a clone is re-run' },
  { id: 'VP-29', artifact: 'tests/mutations.json + scripts/mutate.mjs', coverage: 'full',
    note: 'step-named registry run in a disposable copy by `npm run mutate`; every scored step has at least one killing mutation (the runner reads the scored steps from the baseline run); includes forgeries that edit a pinned artifact AND re-pin it; no declared survivors' },
  { id: 'VP-30', artifact: 'MANIFEST.md#limitations-and-trust + MANIFEST.md#evidence', coverage: 'full',
    note: 'MANIFEST Limitations and trust carries the declared-limitations register DL-1 … DL-9 with measured magnitudes and the load-bearing premises table P1–P5; MANIFEST Evidence numbers E01–E20 with their role' },
];

export function profileCoverageBlock(): Record<string, unknown> {
  return { game: PROFILE_GAME, profileVersion: PROFILE_VERSION, notApplicable: NOT_APPLICABLE, packageChecks: PACKAGE_CHECKS };
}

export function labelFor(step: number): Record<string, unknown> {
  const entry = STEP_CLAIMS[step];
  if (!entry) return { profileIds: [], profileChecks: [], profileNote: 'no mapping declared for this step' };
  return entry.claims.length
    ? { profileIds: entry.claims.map(c => c.id), profileChecks: entry.claims }
    : { profileIds: [], profileChecks: [], profileNote: entry.reason ?? 'no reason given' };
}
