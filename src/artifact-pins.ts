/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * These files are shipped as evidence and their figures are quoted in the report, but until this
 * pin existed nothing hashed them: emptying, duplicating or shrinking any of them left the
 * verifier reporting PROVABLY FAIR — Full Pass, exit 0. A published artifact that nothing can
 * distinguish from a rewritten one is not evidence.
 *
 * outputs/verification-results.json is deliberately NOT pinned — it is this verifier's own
 * output and is rewritten on every run by construction.
 *
 * Regenerating an artifact legitimately means re-pinning it here, in the same commit, with the
 * run that produced it.
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'optimal-play-rtp.json':
    '9d0607c24b9ba16f1f6c6ce66c50ec36e7773a929db90b0ddb6da630aa105a62',
  'rtp-convergence.html':
    'e04b4e8b0f47377578b1cb578b63c7dbeaf23144e1c4d7d6b51675d82f6e9bd3',
  'simulation-results.json':
    '54405ef4380ff4797744ba051d606b3867ff5f7bd5d6e99cce56372688ede013',
});
