// Capture methodology, published for provenance/review.
// Reference record, not a runnable tool.
// Dataset in `data/`, hash-verified by the suite.

(async function () {
  'use strict';

  // Missing hands — transaction IDs of the bets AROUND each gap
  var GAPS = [
    { label: 'Gap 1 (Phase A, nonce 23)', txBefore: 556786892, txAfter: 556787618, expectedNonce: 23, phase: 'A' },
    { label: 'Gap 2 (Phase D, nonce 15)', txBefore: 556931710, txAfter: 556932773, expectedNonce: 15, phase: 'D' },
  ];

  var HEADERS = {
    'content-type': 'application/json', 'accept': 'application/json, text/plain, */*',
    'x-duel-device-identifier': localStorage.getItem('security:uuid') || '',
    'x-env-class': localStorage.getItem('env_class') || 'blue',
  };

  function api(method, path) {
    return fetch(path, { method: method, credentials: 'include', headers: HEADERS })
      .then(function (res) { return res.json(); });
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Step 1: paginate transaction history to find missing tx IDs
  console.log('%c[fill] Scanning transaction history...', 'color:#5c9eff');

  var allTxs = [];
  var page = 1, lastPage = 1;

  while (page <= lastPage && page <= 100) {
    var resp = await api('GET', '/api/v2/user/transactions?page=' + page + '&per_page=100&type=video_poker_rounds&grouped=1');
    var body = resp.data || resp;
    var txs = Array.isArray(body) ? body : (body.data || []);
    lastPage = body.last_page || resp.last_page || lastPage;

    for (var i = 0; i < txs.length; i++) {
      var tx = txs[i];
      var txId = tx.id || (tx.data && tx.data.id);
      if (txId) allTxs.push({ id: txId, data: tx.data || tx });
    }

    console.log('%c[fill] page ' + page + '/' + lastPage + ' — ' + allTxs.length + ' txs so far', 'color:#5c9eff');
    page++;
    await wait(300);
  }

  console.log('%c[fill] Total transactions fetched: ' + allTxs.length, 'color:#81c784');

  // Step 2: find missing tx IDs — they fall between txBefore and txAfter
  var found = [];

  for (var g = 0; g < GAPS.length; g++) {
    var gap = GAPS[g];
    console.log('%c[fill] Looking for ' + gap.label + '...', 'color:#ffb74d');

    // Find txs with IDs between the neighbors
    var candidates = allTxs.filter(function (t) {
      return t.id > gap.txBefore && t.id < gap.txAfter;
    });

    if (candidates.length === 0) {
      // Fallback: try fetching individual tx IDs in the range
      console.log('%c[fill] No match in paginated data, trying sequential tx IDs...', 'color:#ffb74d');
      for (var tryId = gap.txBefore + 1; tryId < gap.txAfter; tryId++) {
        try {
          var detail = await api('GET', '/api/v2/user/transactions/' + tryId);
          var d = detail.data || detail;
          if (d && d.initial_cards) {
            candidates.push({ id: tryId, data: d });
            console.log('%c[fill] Found hand at tx ' + tryId, 'color:#81c784');
          }
        } catch (e) {}
        await wait(200);
      }
    }

    if (candidates.length === 0) {
      console.log('%c[fill] WARNING: could not find missing hand for ' + gap.label, 'color:#ff4444');
      continue;
    }

    // Fetch full detail for each candidate
    for (var c = 0; c < candidates.length; c++) {
      var cand = candidates[c];
      console.log('%c[fill] Fetching detail for tx ' + cand.id + '...', 'color:#5c9eff');
      var detailResp = await api('GET', '/api/v2/user/transactions/' + cand.id);
      var dd = detailResp.data || detailResp;
      await wait(300);

      // Only keep if it has video poker fields
      if (!dd.initial_cards) {
        console.log('%c[fill] tx ' + cand.id + ' is not a video poker hand, skipping', 'color:#ffb74d');
        continue;
      }

      found.push({
        gap: gap.label,
        phase: gap.phase,
        expectedNonce: gap.expectedNonce,
        transactionId: cand.id,
        detail: dd,
      });

      console.log('%c[fill] Got hand: ' + dd.initial_cards.join(',') + ' → ' + (dd.final_cards || []).join(',') + ' = ' + dd.combination, 'color:#81c784');
    }
  }

  // Step 3: print results
  console.log('%c[fill] ════════════════════════════════════════', 'color:#5c9eff');
  console.log('%c[fill] Found ' + found.length + ' missing hands:', 'color:#81c784; font-weight:bold');
  console.log(JSON.stringify(found, null, 2));

  // Also try the type as "video_poker_bets" if we got 0 results from pagination
  if (allTxs.length === 0) {
    console.log('%c[fill] Retrying with type=video_poker_bets...', 'color:#ffb74d');
    var resp2 = await api('GET', '/api/v2/user/transactions?page=1&per_page=10&type=video_poker_bets&grouped=1');
    console.log('%c[fill] Response:', 'color:#5c9eff');
    console.log(resp2);
  }

  return found;
});
console.log('[fill] reference record loaded — see data/ for the captured dataset');
