/**
 * RTP-CLAIM wiring — Duel Video Poker: the per-setting RTP table and the claim it is held to.
 *
 * Added 14 October 2026 under Methodology v1.1, decision D4 (Mike: "D1, D4, D5, D6 (approve the cited
 * versions) and D9: go with your recommendations"; D4: an rtp-claim-table.json for Video Poker, RTP
 * under optimal play).
 *
 * The rule is src/rtp-claim.ts, a byte-identical copy of the framework's core/rtp-claim.ts (its
 * SHA-256 is compared by conformance C-13), version 1.2.0 (Methodology v1.1, agreed 2026-10-14). The
 * enforcement switch RTP_CLAIM_RULE_ENFORCED is the package's own src/rtp-claim-switch.ts, set to
 * true (decision D3): the outcome is scored on the step carrying VP-19, and a house-side miss makes
 * the verdict RTP FIGURE OVERSTATED (exit 5), never NOT PROVABLY FAIR.
 *
 * SETTINGS. One: Jacks or Better at stake tier 0 (stakes up to 1182.855407010385761, E20 scaling_edge
 * id 1), the pay table this audit captured and audits (videoPokerConfig.json), played optimally. Every
 * captured bet was priced at tier 0 (Steps 8 and 10). Tiers 1–51 are not tabled: the package has no
 * optimal-play solve for their pay tables (MANIFEST.md#bet-size-scaling, DL-9).
 * RTP. The existing optimal-play solve, outputs/optimal-play-rtp.json `duel.rtp` (src/compute-optimal-rtp.ts:
 * exhaustive enumeration of all 2,598,960 deals, 134,459 classes, every hold), pinned by SHA-256 in
 * src/artifact-pins.ts and checked by Step 26. It is a double; the rule takes that double's exact binary
 * value (rationalFromDouble). Its departure from 0.999, 2.8e-12, is far inside the 0.1 pp band.
 * CLAIM. Flat 99.9 % (house edge 0.1 %), a stated edge in the game settings (decision D2: "The edge in
 * Duel's game settings counts"): house_edge "0.001" on scaling_edge tier id 1 of Duel's video-poker
 * config (GET https://duel.com/api/v2/video-poker/config as fetched 2026-10-05; E20,
 * evidence/config/duel-video-poker-config-2026-10-05.captured.json), the tier whose multipliers are the
 * audited pay table; every captured deal and draw shows effective_edge 0.1 (Step 10). Duel also labels
 * the game "Zero Edge" (MANIFEST.md#payouts-and-rtp): a zero-edge line, noted, not tested (D3).
 *
 *   npm run rtp-claim:write    rewrite outputs/rtp-claim-table.json and print its SHA-256 to pin
 */
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { RtpClaim, RtpClaimAccumulator, RtpClaimResult, rtpClaimTable, rtpClaimGate, RtpClaimGate, rationalFromDouble } from './rtp-claim';

export const RTP_CLAIM: RtpClaim = {
  kind: 'flat',
  rtp: '0.999',
  source: 'game settings: house_edge "0.001" on scaling_edge tier id 1 (stakes up to 1182.855407010385761) of Duel\'s video-poker config, the tier whose multipliers are the audited pay table (E20, GET https://duel.com/api/v2/video-poker/config as fetched 2026-10-05); effective_edge 0.1 on every captured deal and draw (Step 10). The "Zero Edge" label is noted, not tested (MANIFEST.md#payouts-and-rtp)',
};

/** The scored step that carries VP-19 (src/profile-map.ts): the optimal-play RTP. */
export const RTP_CLAIM_STEP = 26;

export const RTP_CLAIM_TABLE = path.join(__dirname, '..', 'outputs', 'rtp-claim-table.json');
/** SHA-256 of the committed table — re-pin with the run that rewrote it (npm run rtp-claim:write). */
export const RTP_CLAIM_TABLE_SHA256 = 'd16678b014447e3b3f958f9f4ee9c432cf34e0f54a108e48911f812eedc44e54';

/** The pinned optimal-play solve (Step 26 / Step 28 hold its bytes and figures). */
const OPTIMAL_PLAY = path.join(__dirname, '..', 'outputs', 'optimal-play-rtp.json');

export function computeRtpClaim(): RtpClaimResult {
  const solve = JSON.parse(fs.readFileSync(OPTIMAL_PLAY, 'utf8'));
  const rtp = solve?.duel?.rtp;
  if (typeof rtp !== 'number' || !Number.isFinite(rtp)) throw new Error('rtp-settings: outputs/optimal-play-rtp.json has no duel.rtp');
  const r = rationalFromDouble(rtp);
  const acc = new RtpClaimAccumulator(RTP_CLAIM);
  acc.add('jacks-or-better, stake tier 0 (E20 id 1, up to 1182.855407010385761), optimal play', r.n, r.d);
  return acc.result();
}

export function rtpClaimTableText(r: RtpClaimResult): string {
  return rtpClaimTable(r, {
    package: 'duel/video-poker', game: 'video-poker',
    settingSpace: 'one setting: Jacks or Better at stake tier 0 (E20 scaling_edge id 1, stakes up to 1182.855407010385761), the audited pay table (videoPokerConfig.json), optimal play; tiers 1–51 are not tabled (no optimal-play solve for their pay tables)',
    rtpMethod: 'the exact binary value of the double outputs/optimal-play-rtp.json duel.rtp (src/compute-optimal-rtp.ts: exhaustive enumeration of all 2,598,960 deals and every hold; pinned in src/artifact-pins.ts, checked by Step 26)',
  });
}

export function runRtpClaimGate(): RtpClaimGate {
  const r = computeRtpClaim();
  return rtpClaimGate(r, rtpClaimTableText(r), RTP_CLAIM_TABLE, RTP_CLAIM_TABLE_SHA256);
}

if (require.main === module) {
  const text = rtpClaimTableText(computeRtpClaim());
  fs.writeFileSync(RTP_CLAIM_TABLE, text);
  console.log(`wrote outputs/rtp-claim-table.json sha256 ${createHash('sha256').update(text).digest('hex')}`);
}
