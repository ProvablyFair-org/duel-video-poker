#!/usr/bin/env node
'use strict';
/**
 * Runs DUEL'S OWN Video Poker verification code — the JavaScript shown in the code panel of
 * duel.com → Provably Fair → Verify (Video Poker) — on a batch of hands.
 *
 *   node run-operator-verifier.cjs <captured-file>        jobs as JSON on stdin → JSON on stdout
 *
 * jobs: { rounds: [{ id, serverSeed, clientSeed, nonce }] }
 *
 * WHAT RUNS. evidence/verify-tab/duel-verify-tab-video-poker-2026-04-23.captured.json, whose SHA-256
 * is pinned in src/operator-verifier.ts and checked by the caller before this runner starts. The
 * browser capture of 2026-04-23 saved the code panel as ONE JSON string literal (the file is a JSON
 * document whose value is the panel text). The single transformation made here is JSON.parse of that
 * literal, which recovers the panel text exactly; not one character of the decoded code is rewritten.
 * It is plain script (no import, no export), so it is evaluated with node:vm inside a function wrapper.
 *
 * WHAT IS NOT DUEL'S CODE (the whole harness surface):
 *   1. the wrapper `(function (crypto, TextEncoder, console) { <code> ; return { … }; })` — `crypto`
 *      is Node's WebCrypto (the same W3C API the page uses: crypto.subtle.importKey / sign),
 *      `TextEncoder` is Node's, `console` is a recorder. The code's own top level runs with its empty
 *      inputs and logs its "Please provide valid …" line; the recorded lines are returned.
 *   2. the calls: for each hand, shuffleDeck(serverSeed, clientSeed, nonce, ALL_CARDS) — the file's own
 *      function and constant — once; the first ten cards are returned. The file's getVideoPokerCards
 *      is shuffleDeck(...).slice(offset, offset + 5) called at offsets 0 and 5, so deck[0..9] is exactly
 *      what its two calls print; calling shuffleDeck once halves the HMAC work. The file has no hold or
 *      payout logic: it prints the dealt hand and the replacement cards only.
 * Exit 0 with JSON; exit 1 if the file will not evaluate or does not define those names.
 */
const vm = require('vm');
const fs = require('fs');

function fail(msg) { process.stderr.write(`operator verifier: ${msg}\n`); process.exit(1); }

const file = process.argv[2];
if (!file) fail('usage: run-operator-verifier.cjs <captured-file>');
let src;
try { src = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(`captured file is not a JSON string literal: ${e.message}`); }
if (typeof src !== 'string') fail('captured file does not decode to a string');
const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!jobs || !Array.isArray(jobs.rounds)) fail('jobs must be { rounds: [...] }');

const logs = [];
const recorder = { log: (...a) => logs.push(a.map(String).join(' ')), error: (...a) => logs.push(a.map(String).join(' ')) };

let mod;
try {
  const wrapped = `(function (crypto, TextEncoder, console) {\n${src}\n;return { shuffleDeck, getVideoPokerCards, ALL_CARDS };\n})`;
  mod = vm.runInThisContext(wrapped, { filename: file })(globalThis.crypto, TextEncoder, recorder);
} catch (e) { fail(`file did not evaluate: ${e.message}`); }
if (typeof mod.shuffleDeck !== 'function' || !Array.isArray(mod.ALL_CARDS)) fail('file does not define shuffleDeck / ALL_CARDS');

(async () => {
  const results = [];
  const BATCH = 100;
  for (let i = 0; i < jobs.rounds.length; i += BATCH) {
    const slice = jobs.rounds.slice(i, i + BATCH);
    const out = await Promise.all(slice.map(async r => {
      try { const d = await mod.shuffleDeck(r.serverSeed, r.clientSeed, Number(r.nonce), mod.ALL_CARDS); return { id: r.id, cards: d.slice(0, 10) }; }
      catch (e) { return { id: r.id, cards: null, error: e.message }; }
    }));
    results.push(...out);
  }
  await new Promise(r => setImmediate(r));
  process.stdout.write(JSON.stringify({ logs, allCards: mod.ALL_CARDS, results }));
})().catch(e => fail(e.message));
