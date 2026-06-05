// Capture methodology, published for provenance/review.
// Reference record, not a runnable tool.
// Dataset in `data/`, hash-verified by the suite.

if (window._vpkill) window._vpkill();

(function () {
  'use strict';

  var INSTANCE = Date.now();
  window._vpkill = function () { INSTANCE = -1; };

  // ── Phase config ────────────────────────────────────────────────────────
  // Total: 3000 + 1000 + 100 + 500 + 800 = 5,400 bets
  var PHASES = [
    { key: 'A', name: '$0.01 random holds',       total: 3000, amount: '0.01', holdFn: holdRandom },
    { key: 'B', name: '$0.01 targeted holds',     total: 1000, amount: '0.01', holdFn: holdTargeted },
    { key: 'C', name: '$10 stake independence',   total: 100,  amount: '10',   holdFn: holdRandom },
    { key: 'D', name: '$0.01 custom seed',        total: 500,  amount: '0.01', holdFn: holdRandom },
    { key: 'E', name: '$0.01 systematic holds',   total: 800,  amount: '0.01', holdFn: holdSystematic },
  ];

  var BETS_PER_EPOCH = 50;
  var BET_DELAY = 500;
  var MAX_ERRORS = 8;
  var DB_NAME = 'vp_capture';

  // ── Hold decision functions ─────────────────────────────────────────────

  var RANK_VAL = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
  function cardRank(c) { return RANK_VAL[c.slice(0, -1)]; }
  function cardSuit(c) { return c.slice(-1); }

  function holdRandom(cards, idx) {
    // Each card independently 50% held
    return cards.filter(function () { return Math.random() < 0.5; });
  }

  function holdTargeted(cards, idx) {
    // 0-399: hold pairs (hunt 3oaK/FH/4oaK)
    // 400-699: hold 4-flush (hunt flush/SF)
    // 700-899: hold 4-straight (hunt straight)
    // 900-999: hold 3+ royal cards (hunt royal)
    var parsed = cards.map(function (c) { return { card: c, rank: cardRank(c), suit: cardSuit(c) }; });

    if (idx < 400) {
      var rankCounts = {};
      parsed.forEach(function (p) { (rankCounts[p.rank] = rankCounts[p.rank] || []).push(p.card); });
      for (var r in rankCounts) { if (rankCounts[r].length >= 2) return rankCounts[r]; }
    } else if (idx < 700) {
      var suitGroups = {};
      parsed.forEach(function (p) { (suitGroups[p.suit] = suitGroups[p.suit] || []).push(p.card); });
      for (var s in suitGroups) { if (suitGroups[s].length >= 4) return suitGroups[s].slice(0, 4); }
    } else if (idx < 900) {
      var sorted = parsed.slice().sort(function (a, b) { return a.rank - b.rank; });
      for (var j = 0; j <= 1; j++) {
        if (sorted[j + 3].rank - sorted[j].rank === 3) {
          return [sorted[j], sorted[j+1], sorted[j+2], sorted[j+3]].map(function (p) { return p.card; });
        }
      }
    } else {
      var royalBySuit = {};
      parsed.forEach(function (p) { if (p.rank >= 10) (royalBySuit[p.suit] = royalBySuit[p.suit] || []).push(p.card); });
      for (var rs in royalBySuit) { if (royalBySuit[rs].length >= 3) return royalBySuit[rs]; }
    }
    return []; // no match → discard all
  }

  function holdSystematic(cards, idx) {
    // 8 patterns × 100 each:
    //   0-99: hold 0,  100-199: hold pos 0,  200-299: hold pos 1,
    //   300-399: hold pos 2,  400-499: hold pos 3,  500-599: hold pos 4,
    //   600-699: hold pos 0+2,  700-799: hold all 5
    var block = Math.floor(idx / 100);
    switch (block) {
      case 0: return [];
      case 1: return [cards[0]];
      case 2: return [cards[1]];
      case 3: return [cards[2]];
      case 4: return [cards[3]];
      case 5: return [cards[4]];
      case 6: return [cards[0], cards[2]];
      case 7: return cards.slice();
      default: return [];
    }
  }

  // ── IndexedDB ───────────────────────────────────────────────────────────
  var db = null;

  function openDB() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('bets')) d.createObjectStore('bets', { autoIncrement: true });
        if (!d.objectStoreNames.contains('seeds')) d.createObjectStore('seeds', { autoIncrement: true });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = function (e) { db = e.target.result; resolve(db); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function dbPut(store, value, key) { return new Promise(function (ok, fail) { var tx = db.transaction(store, 'readwrite'); var r = key !== undefined ? tx.objectStore(store).put(value, key) : tx.objectStore(store).add(value); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { fail(r.error); }; }); }
  function dbGetAll(store) { return new Promise(function (ok, fail) { var r = db.transaction(store, 'readonly').objectStore(store).getAll(); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { fail(r.error); }; }); }
  function dbGet(store, key) { return new Promise(function (ok, fail) { var r = db.transaction(store, 'readonly').objectStore(store).get(key); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { fail(r.error); }; }); }
  function dbClear(store) { return new Promise(function (ok, fail) { var r = db.transaction(store, 'readwrite').objectStore(store).clear(); r.onsuccess = function () { ok(); }; r.onerror = function () { fail(r.error); }; }); }
  function dbCount(store) { return new Promise(function (ok, fail) { var r = db.transaction(store, 'readonly').objectStore(store).count(); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { fail(r.error); }; }); }

  // ── State ───────────────────────────────────────────────────────────────
  var meta = {};
  var paused = false;
  var betCount = 0;
  var seedCount = 0;

  function freshMeta() {
    var counts = {};
    for (var i = 0; i < PHASES.length; i++) counts[PHASES[i].key] = 0;
    return {
      phaseIdx: 0, phaseBets: 0, epochBets: 0, phaseStarted: false,
      token: null, tokenAt: 0, errors: 0, running: false,
      lastNextHash: null, createdAt: new Date().toISOString(),
      lastTxId: null,
      activeServerSeedHashed: null, activeClientSeed: null,
      phaseBetCounts: counts,
    };
  }

  function saveMeta() { return dbPut('meta', meta, 'state'); }

  // ── Logging ─────────────────────────────────────────────────────────────
  function log(msg) { console.log('%c[vp] ' + msg, 'color:#5c9eff'); updatePanel(); }
  function warn(msg) { console.warn('%c[vp] ' + msg, 'color:#ffb74d'); updatePanel(); }
  function good(msg) { console.log('%c[vp] ' + msg, 'color:#81c784'); updatePanel(); }
  function bad(msg) { console.error('%c[vp] ' + msg, 'color:#ff4444; font-weight:bold'); updatePanel(); }

  // ── Panel ───────────────────────────────────────────────────────────────
  function buildPanel() {
    var old = document.getElementById('cap-panel'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'cap-panel';
    Object.assign(d.style, { position:'fixed', bottom:'16px', right:'16px', zIndex:'99999', background:'#0d1117', border:'1px solid #1e2d3d', borderRadius:'8px', padding:'12px 16px', fontFamily:'monospace', fontSize:'11px', color:'#b8cfe0', minWidth:'300px', boxShadow:'0 4px 24px rgba(0,0,0,.7)', cursor:'move', userSelect:'none' });
    var dragging = false, ox = 0, oy = 0;
    d.addEventListener('mousedown', function (e) { if (e.target.tagName === 'BUTTON') return; dragging = true; ox = e.clientX - d.offsetLeft; oy = e.clientY - d.offsetTop; });
    document.addEventListener('mousemove', function (e) { if (!dragging) return; d.style.left = (e.clientX - ox) + 'px'; d.style.top = (e.clientY - oy) + 'px'; d.style.right = 'auto'; d.style.bottom = 'auto'; });
    document.addEventListener('mouseup', function () { dragging = false; });

    var title = document.createElement('div'); title.textContent = 'VIDEO POKER CAPTURE';
    Object.assign(title.style, { color:'#5c9eff', fontWeight:'700', fontSize:'13px' }); d.appendChild(title);
    var st = document.createElement('div'); st.id = 'cap-status'; Object.assign(st.style, { margin:'6px 0', color:'#4d6880', fontSize:'10px' }); d.appendChild(st);

    for (var pi = 0; pi < PHASES.length; pi++) {
      var ph = PHASES[pi];
      var row = document.createElement('div'); Object.assign(row.style, { display:'flex', alignItems:'center', gap:'6px', marginBottom:'3px' });
      var lbl = document.createElement('span'); lbl.textContent = ph.key; Object.assign(lbl.style, { width:'22px', color:'#4d6880', fontWeight:'700', fontSize:'10px' });
      var barOuter = document.createElement('div'); Object.assign(barOuter.style, { flex:'1', height:'8px', background:'#161e28', borderRadius:'4px', overflow:'hidden' });
      var fill = document.createElement('div'); fill.id = 'cap-bar-' + ph.key; Object.assign(fill.style, { height:'100%', width:'0%', background:'#2dff82', borderRadius:'4px', transition:'width .3s' }); barOuter.appendChild(fill);
      var ct = document.createElement('span'); ct.id = 'cap-ct-' + ph.key; ct.textContent = '0/' + ph.total; Object.assign(ct.style, { width:'80px', textAlign:'right', fontSize:'9px', color:'#4d6880' });
      row.appendChild(lbl); row.appendChild(barOuter); row.appendChild(ct); d.appendChild(row);
    }

    var seedLine = document.createElement('div'); seedLine.id = 'cap-seeds'; Object.assign(seedLine.style, { margin:'6px 0 4px', fontSize:'10px', color:'#4d6880' }); d.appendChild(seedLine);
    var btnRow = document.createElement('div'); Object.assign(btnRow.style, { display:'flex', gap:'4px', marginTop:'8px' });
    function mkBtn(text, color, fn) { var b = document.createElement('button'); b.textContent = text; Object.assign(b.style, { flex:'1', padding:'5px 0', background:'#161e28', border:'1px solid #1e2d3d', color: color, borderRadius:'3px', cursor:'pointer', fontFamily:'monospace', fontSize:'10px', fontWeight:'700' }); b.addEventListener('click', fn); return b; }
    btnRow.appendChild(mkBtn('GO', '#2dff82', function () { pub.go(); }));
    btnRow.appendChild(mkBtn('PAUSE', '#ffcc44', function () { pub.pause(); }));
    btnRow.appendChild(mkBtn('SAVE', '#33ccff', function () { pub.save(); }));
    d.appendChild(btnRow); document.body.appendChild(d);
  }

  function updatePanel() {
    for (var pi = 0; pi < PHASES.length; pi++) {
      var ph = PHASES[pi]; var n = meta.phaseBetCounts ? (meta.phaseBetCounts[ph.key] || 0) : 0;
      var bar = document.getElementById('cap-bar-' + ph.key); var ct = document.getElementById('cap-ct-' + ph.key);
      if (bar) { bar.style.width = Math.min(100, n / ph.total * 100) + '%'; bar.style.background = n >= ph.total ? '#33ccff' : '#2dff82'; }
      if (ct) ct.textContent = n + '/' + ph.total;
    }
    var st = document.getElementById('cap-status');
    if (st) { st.textContent = (paused ? 'paused' : (meta.running ? 'running' : 'idle')) + ' | bets: ' + betCount + ' | seeds: ' + seedCount + (meta.errors > 0 ? ' | err:' + meta.errors : ''); st.style.color = meta.running && !paused ? '#2dff82' : '#4d6880'; }
    var sl = document.getElementById('cap-seeds');
    if (sl) sl.textContent = 'seeds: ' + seedCount + ' | epoch: ' + (meta.epochBets || 0) + '/' + BETS_PER_EPOCH;
  }

  // ── API ─────────────────────────────────────────────────────────────────
  var HEADERS = {
    'content-type': 'application/json', 'accept': 'application/json, text/plain, */*',
    'x-duel-device-identifier': localStorage.getItem('security:uuid') || '',
    'x-env-class': localStorage.getItem('env_class') || 'blue',
  };

  function api(method, path, body) {
    var opts = { method: method, credentials: 'include', headers: HEADERS };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok || j.success === false) throw new Error((j.message || JSON.stringify(j).slice(0, 200)).slice(0, 200));
        return j.data || j;
      });
    });
  }

  function refreshToken() {
    return api('POST', '/api/v2/user/security/token', { uuid: localStorage.getItem('security:uuid'), code: '0000', type: 'standard' })
      .then(function (r) { meta.token = r.token || r; meta.tokenAt = Date.now(); return meta.token; });
  }
  function ensureToken() { return (Date.now() - meta.tokenAt > 300000) ? refreshToken() : Promise.resolve(meta.token); }
  function getActiveSeed() { return api('GET', '/api/v2/client-seed'); }
  function getTransaction(txId) { return api('GET', '/api/v2/user/transactions/' + txId); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function generateClientSeed() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var s = ''; for (var i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function rotateSeed(customSeed) {
    var clientSeed = customSeed || generateClientSeed();
    return ensureToken().then(function (token) {
      log('rotate: clientSeed=' + clientSeed.slice(0, 8) + '...');
      function tryRotate(attempt) {
        return api('POST', '/api/v2/client-seed/rotate', { client_seed: clientSeed, security_token: token }).catch(function (e) {
          if (/active.*round|complete.*round/i.test(e.message) && attempt < 4) {
            return clearActive(token).then(function () { return wait(500); }).then(function () { return tryRotate(attempt + 1); });
          }
          throw e;
        });
      }
      return tryRotate(0);
    });
  }

  // ── Clear any stuck active round (up to 5 retries) ──────────────────────
  function clearActive(token) {
    function attempt(n) {
      if (n >= 5) return Promise.resolve();
      return api('GET', '/api/v2/video-poker').then(function (data) {
        if (!data || !data.hand_id || data.status !== 0) return;
        log('clearing stuck hand ' + data.hand_id + ' (attempt ' + (n + 1) + ')');
        return api('POST', '/api/v2/video-poker/' + data.hand_id + '/draw', { held_cards: [] })
          .then(function () { return wait(300); })
          .catch(function () { return wait(500).then(function () { return attempt(n + 1); }); });
      }).catch(function () {});
    }
    return attempt(0);
  }

  // ── Play one video poker round: deal → hold → draw ─────────────────────
  function playRound(amount, holdFn, holdIdx, token) {
    return clearActive(token).then(function () {
      return api('POST', '/api/v2/video-poker', {
        amount: String(amount), currency: 105, instant: false, security_token: token,
      });
    }).then(function (dealData) {
      if (!dealData || !dealData.hand_id || !Array.isArray(dealData.initial_cards) || dealData.initial_cards.length !== 5) {
        throw new Error('bad deal response: ' + JSON.stringify(dealData).slice(0, 200));
      }
      var handId = dealData.hand_id;
      var initialCards = dealData.initial_cards;
      var heldCards = holdFn(initialCards, holdIdx);

      return wait(250).then(function () {
        return api('POST', '/api/v2/video-poker/' + handId + '/draw', { held_cards: heldCards });
      }).then(function (drawData) {
        return {
          deal: dealData,
          draw: drawData,
          heldCards: heldCards,
        };
      });
    });
  }

  // ── Seed rotation ───────────────────────────────────────────────────────
  function doRotation(phase, customSeed) {
    return Promise.resolve().then(function () {
      if (!meta.lastNextHash) {
        return getActiveSeed().then(function (s) {
          meta.lastNextHash = s.next_server_seed_hash;
          log('initial next_hash: ' + meta.lastNextHash.slice(0, 24) + '...');
        });
      }
    }).then(function () {
      return rotateSeed(customSeed);
    }).then(function (rot) {
      var entry = {
        at: new Date().toISOString(), context: 'rotate-phase-' + phase, phase: phase,
        seed: { clientSeed: rot.client_seed, serverSeedHashed: rot.server_seed_hashed,
                nextServerSeedHash: rot.next_server_seed_hash, serverSeed: null },
        nonce: 0,
      };
      var promoted = rot.server_seed_hashed === meta.lastNextHash;
      entry.nextSeedPromotion = {
        previousNextHash: meta.lastNextHash, newActiveHash: rot.server_seed_hashed,
        newNextHash: rot.next_server_seed_hash, match: promoted,
      };
      if (promoted) good('promoted: ' + meta.lastNextHash.slice(0, 16) + ' -> ' + rot.server_seed_hashed.slice(0, 16));
      else warn('PROMOTION MISMATCH!');
      meta.lastNextHash = rot.next_server_seed_hash;
      meta.activeServerSeedHashed = rot.server_seed_hashed;
      meta.activeClientSeed = rot.client_seed;

      if (meta.lastTxId) {
        return getTransaction(meta.lastTxId).then(function (tx) {
          var txData = tx.data || tx;
          entry.seed.serverSeed = txData.server_seed || null;
          entry.revealedFrom = { transactionId: meta.lastTxId };
          good('revealed: ' + (entry.seed.serverSeed || 'PENDING').slice(0, 16) + '...');
          return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
        }).catch(function () {
          return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
        });
      }
      return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
    });
  }

  // ── Main loop ───────────────────────────────────────────────────────────
  function runLoop() {
    if (INSTANCE === -1 || paused) { log('paused'); meta.running = false; saveMeta(); updatePanel(); return; }
    var phaseIdx = meta.phaseIdx;
    if (phaseIdx >= PHASES.length) {
      good('ALL PHASES COMPLETE — ' + betCount + ' bets, ' + seedCount + ' seeds. Run vp.save()');
      meta.running = false; saveMeta(); updatePanel();
      return;
    }
    var cfg = PHASES[phaseIdx];

    // Phase start: rotate seed (custom for Phase D)
    if (!meta.phaseStarted) {
      meta.phaseStarted = true; saveMeta();
      log('Phase ' + cfg.key + ': ' + cfg.name + ' — ' + cfg.total + ' @ $' + cfg.amount);
      if (cfg.key === 'D') { meta.phaseDSeed = 'pfaudit' + Date.now().toString(36); }
      var cs = cfg.key === 'D' ? meta.phaseDSeed : null;
      doRotation(cfg.key, cs).then(function () { updatePanel(); setTimeout(runLoop, BET_DELAY); }).catch(function (e) {
        warn('rotation failed: ' + e.message); meta.errors++;
        if (meta.errors >= MAX_ERRORS) { warn('too many errors — pausing'); paused = true; }
        saveMeta(); updatePanel(); setTimeout(runLoop, 3000);
      });
      return;
    }

    // Phase end — no rotation here; the next phase's start rotation reveals
    // the last active seed. Double-rotating loses the intermediate plaintext.
    if (meta.phaseBets >= cfg.total) {
      good('Phase ' + cfg.key + ' done');
      meta.phaseIdx++; meta.phaseBets = 0; meta.epochBets = 0; meta.phaseStarted = false; saveMeta();
      updatePanel(); setTimeout(runLoop, BET_DELAY);
      return;
    }

    // Epoch boundary
    if (meta.epochBets >= BETS_PER_EPOCH) {
      var ds = cfg.key === 'D' ? meta.phaseDSeed : null;
      doRotation(cfg.key, ds).then(function () { updatePanel(); setTimeout(runLoop, BET_DELAY); }).catch(function (e) {
        warn('epoch rotation: ' + e.message); meta.errors++;
        if (meta.errors >= MAX_ERRORS) { warn('too many errors — pausing'); paused = true; }
        saveMeta(); updatePanel(); setTimeout(runLoop, 3000);
      });
      return;
    }

    // ── Place one video poker round ───────────────────────────────────────
    ensureToken().then(function (token) {
      return playRound(cfg.amount, cfg.holdFn, meta.phaseBets, token);
    }).then(function (result) {
      // Increment counters immediately so they survive even if getActiveSeed fails
      meta.lastTxId = result.deal.transaction_id;
      meta.phaseBets++;
      meta.phaseBetCounts[cfg.key] = (meta.phaseBetCounts[cfg.key] || 0) + 1;
      meta.epochBets++;
      betCount++;
      return getActiveSeed().then(function (seedState) {
        var actualNonce = seedState.nonce != null ? seedState.nonce - 1 : meta.epochBets;
        if (actualNonce < 0) { warn('nonce clamped to 0 (server returned nonce=' + seedState.nonce + ') — check indexing'); actualNonce = 0; }

        // $0 effective bet guard — nonce may not have incremented server-side
        var effectiveAmt = parseFloat(result.deal.amount_coins || result.draw.amount_won || cfg.amount);
        if (effectiveAmt === 0 && parseFloat(cfg.amount) > 0) {
          bad('$0 EFFECTIVE BET detected (hand=' + result.deal.hand_id + ') — nonce may be desynced. Pausing.');
          paused = true;
        }

        var rec = {
          at: new Date().toISOString(), phase: cfg.key,
          deal: {
            request: { amount_coins: cfg.amount, currency: 105 },
            response: {
              hand_id: result.deal.hand_id, status: result.deal.status,
              amount_currency: result.deal.amount_currency, amount_coins: result.deal.amount_coins,
              initial_cards: result.deal.initial_cards,
              transaction_id: result.deal.transaction_id, effective_edge: result.deal.effective_edge,
            },
          },
          draw: {
            request: { held_cards: result.heldCards },
            response: {
              hand_id: result.draw.hand_id, status: result.draw.status,
              initial_cards: result.draw.initial_cards, held_cards: result.draw.held_cards,
              final_cards: result.draw.final_cards, combination: result.draw.combination,
              multiplier: result.draw.multiplier, amount_won: result.draw.amount_won,
              transaction_id: result.draw.transaction_id, effective_edge: result.draw.effective_edge,
            },
          },
          seed: {
            serverSeedHashed: seedState.server_seed_hashed || meta.activeServerSeedHashed,
            clientSeed: seedState.client_seed || meta.activeClientSeed,
            nonce: actualNonce,
          },
        };

        // Correct epochBets from server nonce if available
        if (seedState.nonce != null) meta.epochBets = seedState.nonce;
        meta.errors = 0;

        return dbPut('bets', rec).then(function () { return saveMeta(); }).then(function () {
          if (betCount % 100 === 0) {
            log(cfg.key + ': ' + meta.phaseBets + '/' + cfg.total + ' | total: ' + betCount + ' | ' + result.draw.combination + ' ' + result.draw.multiplier + 'x');
          }
          updatePanel();
        });
      });
    }).then(function () {
      setTimeout(runLoop, BET_DELAY);
    }).catch(function (e) {
      warn('bet failed: ' + e.message); meta.errors++;
      if (meta.errors >= MAX_ERRORS) { warn('too many errors — pausing'); paused = true; }
      saveMeta(); updatePanel(); setTimeout(runLoop, 2000);
    });
  }

  });

console.log('[vp] reference record loaded — see data/ for the captured dataset');
