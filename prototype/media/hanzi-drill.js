// hanzi-drill: stroke-order quiz + per-character pinyin grading inside the Anki reviewer.
// Ships as a media file referenced from the Mandarin note type's templates (also inlined
// into the prototype apkg). DOM contract: hidden spans #hd-hanzi / #hd-want-pin carrying
// the Characters / Pinyin fields, a #hd-canvas box, #hd-status line, pinyin row (#hd-pinhint,
// #hd-pin, #hd-pinnext, #hd-pinfb), buttons #hd-replay / #hd-giveup / #hd-check.
// Per-character flow is PARALLEL: the drawing quiz and the pinyin box are both live for
// the current char — neither gates the other (a dead keyboard must never block drawing).
(function () {
  'use strict';
  if (window.__HD_BOOTED) { // script re-executed (FrontSide echo on answer render) — singleton
    try { window.__HD_MOUNT && window.__HD_MOUNT(); } catch (e) {}
    return;
  }
  window.__HD_BOOTED = true;

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function txt(id) { var e = $(id); return e ? e.textContent.trim() : ''; }
  function hanzi(s) { var m = (s || '').match(/[\u3400-\u9fff\uf900-\ufaff]/g); return m ? m.join('') : ''; }
  function domRevealed() {
    if ($('hd-info')) return true; // prototype pages mark the answer side
    var a = document.getElementById('answer');
    // AnkiDroid's new review layout keeps a HIDDEN #answer in the page from load —
    // existence would false-positive; check it's actually on screen.
    if (a) return a.style.display !== 'none' && a.offsetWidth > 0;
    return false;
  }
  function apiRevealed() { // old AnkiDroid reviewer: page NOT re-rendered on show-answer —
    var v = null;                            // ask the app instead (JS API both generations)
    try { if (window.api && api.isDisplayingAnswer) { var x = api.isDisplayingAnswer(); if (x && x.then) { x.then(function(b){ if (b) onAnswerShown(); }).catch(function(){}); return false; } v = !!x; } } catch (e) {}
    if (v === null) { try { if (window.AnkiDroidJS && AnkiDroidJS.isDisplayingAnswer) v = !!AnkiDroidJS.isDisplayingAnswer(); } catch (e) {} }
    return !!v;
  }
  function onAnswerShown() {
    if (!sess) return;
    if (!sess.answerCalled) {
      sess.answerCalled = true;
      if (sess.started && !sess.quizDone) sess.skipped = true; // revealed mid-attempt → honest self-grade
    }
    if (dirMarker() === 'reading') { showBrowseOnly(); return; } // reveal -> stroke-order browse, no quiz
    showStatic();
  }
  function dirMarker() { return txt('hd-dir'); } // 'writing' | 'reading' | ''
  function answerSide() {
    if (!sess) return false;
    return sess.answerCalled || domRevealed() || apiRevealed();
  }
  function revealed() { return answerSide(); }
  function reveal() {
    try { if (window.api && api.ankiShowAnswer) return api.ankiShowAnswer(); } catch (e) {}
    try { if (window.AnkiDroidJS && AnkiDroidJS.ankiShowAnswer) return AnkiDroidJS.ankiShowAnswer(); } catch (e) {}
    try { if (typeof ankiShowAnswer === 'function') return ankiShowAnswer(); } catch (e) {}
    try { if (typeof showAnswer === 'function') return showAnswer(); } catch (e) {}
  }
  function grade(ease) { // 1..4, every AnkiDroid API generation; desktop = no-op
    try { if (window.api && api['ankiAnswerEase' + ease]) return api['ankiAnswerEase' + ease](); } catch (e) {}
    try { if (window['ankiAnswerEase' + ease]) return window['ankiAnswerEase' + ease](); } catch (e) {}
    try { if (window.AnkiDroidJS && AnkiDroidJS['ankiAnswerEase' + ease]) return AnkiDroidJS['ankiAnswerEase' + ease](); } catch (e) {}
    try { if (typeof window['buttonAnswerEase' + ease] === 'function') return window['buttonAnswerEase' + ease](); } catch (e) {}
  }
  function log(arr) { if (window.__log) window.__log.push(arr); }

  // ---------- pinyin parsing ----------
  var DM = { 'ā':1,'á':2,'ǎ':3,'à':4,'ē':1,'é':2,'ě':3,'è':4,'ī':1,'í':2,'ǐ':3,'ì':4,
             'ō':1,'ó':2,'ǒ':3,'ò':4,'ū':1,'ú':2,'ǔ':3,'ù':4,'ü':0,'ǖ':1,'ǘ':2,'ǚ':3,'ǜ':4,
             'ḗ':2,'ḗ':2,'ē':1}; // ǜ etc. — missing entries silently degraded to 'u'
  var TONED = /[\u00c0-\u024f\u1e00-\u1eff]/;
  var VOW = 'aeiouv';
  function marksToDigits(s) { // 'jiǎng'->'jiang3', 'hǎo'->'hao3', 'shāngdiàn'->'shang1dian4'
    // digit goes at the SYLLABLE end (after nucleus vowels + n/ng/r coda), not at the
    // marked vowel — 'jia3ng' would split as jia+3+ng.
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var t = DM[s[i]];
      if (t === undefined) { out += s[i].normalize('NFD').replace(/\p{M}/gu, ''); continue; }
      var base = ('ǖǘǚǜ'.indexOf(s[i]) >= 0) ? 'v'
               : s[i].normalize('NFD').replace(/\p{M}/gu, '');
      var k = i + 1;
      while (k < s.length && VOW.indexOf(s[k]) >= 0) k++;        // rest of nucleus (hǎo, lái)
      if (s[k] === 'n') { k++; if (s[k] === 'g') k++; }           // nasal coda (jiǎng)
      else if (s[k] === 'g') k++;
      if (s[k] === 'r') k++;                                     // erhua (huār)
      out += base + s.slice(i + 1, k) + (t || '');
      i = k - 1;
    }
    return out;
  }
  function syllabify(s) { // -> [{syl,tone}]; tone 1-4, 0 unknown. Runs on LOWERCASE s:
    // Android autocap turns "shang1" into "Shang1" and a raw-case split silently finds nothing.
    s = (s || '').toLowerCase().replace(/ü/g, 'v').replace(/[\s\-_·]/g, '');
    if (/[\u00c0-\u024f\u1e00-\u1eff]/.test(s)) s = marksToDigits(s); // then ONE digit splitter
    var out = [];
    if (/[1-4]/.test(s)) {
      var cur = '';
      for (var i = 0; i < s.length; i++) {
        cur += s[i];
        if (/[1-5]/.test(s[i])) {
          var dig = +s[i];
          var syl = cur.replace(/[1-5]/, '');
          while (i + 1 < s.length && /[rst]/.test(s[i + 1])) { syl += s[i + 1]; i++; } // hua1r→huar
          out.push({ syl: syl, tone: dig }); cur = '';
        }
      }
      if (cur.trim()) out.push({ syl: cur.replace(/[^a-zv]/g, ''), tone: 0 });
      return out;
    }
    var re = /(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?[aeiouvr]+[aeiouvngr]*/g, m;
    while ((m = re.exec(s))) out.push({ syl: m[0].replace('v', 'u'), tone: 0 });
    return out;
  }
  function wantSyl(i) { var w = syllabify(txt('hd-want-pin')); return w[i] || { syl: '?', tone: 0 }; }

  // ---------- stroke data (inline subset + on-demand CDN + localStorage cache) ----------
  var CDN = 'https://cdn.jsdelivr.net/gh/chanind/hanzi-writer-data/data/';
  function cacheGet(ch) {
    try { var s = localStorage.getItem('hd:' + ch); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function cachePut(ch, d) { try { localStorage.setItem('hd:' + ch, JSON.stringify(d)); } catch (e) {} }
  function loadData(ch, cb) { // cb(data|null) — async only on first sight of a character
    if (window.HD_DATA && HD_DATA[ch]) return cb(HD_DATA[ch]);
    var c = cacheGet(ch); if (c) return cb(c);
    var x = new XMLHttpRequest();
    x.open('GET', CDN + encodeURIComponent(ch) + '.json', true);
    x.timeout = 8000;
    x.onload = function () {
      if (x.status === 200) { try { var d = JSON.parse(x.responseText); cachePut(ch, d); return cb(d); } catch (e) {} }
      cb(null);
    };
    x.onerror = x.ontimeout = function () { cb(null); };
    x.send();
  }

  // ---------- card session (survives the answer-side re-render; DOM refs don't) ----------
  var sess = null, ui = {};
  var staticMode = false; // canvas showing static/browse glyph, not a live quiz
  function newSess(w) {
    return { word: w, charIdx: 0, started: false, pinDone: [], strokeOk: [],
             pinMiss: [], pinPrevWrong: [], mistakes: 0, giveups: 0, pinWrong: 0, quizDone: false, skipped: false,
             revealSeen: false, mounts: 0 };
  }
  function status(msg, cls) {
    if (!ui.status) return;
    ui.status.textContent = msg;
    ui.status.className = 'hd-status' + (cls ? ' ' + cls : '');
  }
  function charLabel(i) { return 'char ' + (i + 1) + '/' + sess.word.length; }

  // ---------- reveal browse (back of writing card): ◂ ▸ one char at a time ----------
  var browse = { el: null, i: 0, n: 1 };
  function staticCell(div, ch) {
    var size = Math.min(ui.canvas.clientWidth || 260, 260);
    var cell = document.createElement('div');
    cell.style.cssText = 'width:' + size + 'px;height:' + size + 'px;flex-shrink:0;margin:0 auto';
    div.appendChild(cell);
    loadData(ch, function (d) {
      if (!d || !document.contains(cell)) return;
      window.HanziWriter.create(cell, ch, Object.assign({
        width: size, height: size, padding: 4, showOutline: false,
        charDataLoader: function (c, cb) { cb(d); }
      }, glyphColors()));
    });
  }
  function browseBtn(txt_, fn) {
    var b = document.createElement('button');
    b.textContent = txt_;
    b.addEventListener('click', fn);
    return b;
  }
  function browseRender() {
    var d = browse.el; if (!d) return;
    d.innerHTML = '';
    staticCell(d, sess.word[browse.i]);
    if (browse.row && browse.row.parentNode) browse.row.parentNode.removeChild(browse.row);
    var row = document.createElement('div');
    row.className = 'hd-btns';
    browse.row = row;
    var pager = function (delta) {
      browse.i = (browse.i + delta + browse.n) % browse.n;
      browseRender();
      if (dirMarker() === 'reading') playAnim(); // recognition: each char animates as it appears
    };
    if (browse.n > 1) {
      row.appendChild(browseBtn('◂', function () { pager(-1); }));
      var lbl = document.createElement('span');
      lbl.textContent = ' ' + (browse.i + 1) + ' / ' + browse.n + ' ';
      row.appendChild(lbl);
      row.appendChild(browseBtn('▸', function () { pager(1); }));
    }
    var gb = $('hd-giveup'); if (gb && gb.parentNode) gb.parentNode.insertBefore(row, gb.nextSibling);
    applyNight(row);
  }

  // ---------- night mode (AnkiDroid) ----------
  // The reviewer paints unstyled <button>s light-on-dark poorly: our .night_mode CSS
  // never matches because the reviewer page carries no night_mode class — the page just
  // gets a dark background. Detect dark-ness from the computed background and colour
  // every interactive element inline.
  var NIGHT = null;
  function darkBg(el) {
    try {
      var m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
      if (!m) return null;
      var p = m[1].split(',').map(parseFloat);
      if (p.length > 3 && p[3] < 0.5) return null; // transparent — keep walking
      return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) < 128;
    } catch (e) { return null; }
  }
  function detectNight() {
    try {
      var e = $('hd-root') || document.body;
      for (var i = 0; e && i < 12; i++, e = e.parentElement) {
        if (e.classList && (e.classList.contains('night_mode') || e.classList.contains('nightMode'))) return true;
        var d = darkBg(e);
        if (d !== null) return d;
      }
      d = darkBg(document.documentElement);
      if (d !== null) return d;
    } catch (e) {}
    return false;
  }
  function styleEl(b) {
    if (!NIGHT) return;
    if (b.tagName === 'INPUT') { b.style.background = '#111'; b.style.color = '#eee'; b.style.border = '1px solid #555'; return; }
    if (b.classList.contains('sel')) { b.style.background = '#3b82f6'; b.style.color = '#fff'; return; }
    b.style.background = '#2a2a2a'; b.style.color = '#e5e5e5'; b.style.border = '1px solid #555';
  }
  // glyph colours on the (dark) canvas — light strokes on #1e1e1e, night only
  var GLYPH = { stroke: '#3b82f6', outline: '#9ca3af', highlight: '#22c55e' };
  function glyphColors() {
    return NIGHT
      ? { strokeColor: '#d1d5db', outlineColor: '#4b5563', highlightColor: '#4ade80' }
      : { strokeColor: GLYPH.stroke, outlineColor: GLYPH.outline, highlightColor: GLYPH.highlight };
  }
  function applyNight(root) {
    if (!NIGHT) return;
    if (root && (root.tagName === 'BUTTON' || root.tagName === 'INPUT')) return styleEl(root);
    if (!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll('button,input');
    for (var i = 0; i < els.length; i++) styleEl(els[i]);
  }

  // ---------- per character: drawing quiz AND pinyin input, simultaneously ----------
  function showChar(i) {
    sess.charIdx = i; sess.started = true; staticMode = false;
    // Writing-card front = free-recall quiz: no answer spoilers, so no ▶/no-idea there.
    // (Reading card keeps them; the static back re-shows ▶ for browsing.)
    var frontQuiz = dirMarker() === 'writing';
    var rbtn = $('hd-replay'), gbtn = $('hd-giveup');
    if (rbtn) rbtn.style.display = frontQuiz ? 'none' : '';
    if (gbtn) gbtn.style.display = frontQuiz ? 'none' : '';
    // single-character card: nothing to advance to — hide next ▸ entirely
    if (ui.next) ui.next.style.display = sess.word.length > 1 ? '' : 'none';
    var ch = sess.word[i];
    if (!ch) return;
    if (ui.hint) ui.hint.textContent = 'pinyin of ' + charLabel(i) + ':';
    if (ui.pin) ui.pin.value = '';
    if (ui.pinfb) ui.pinfb.textContent = '';
    pickReset(); togglePicker(false);
    status(charLabel(i) + ' — write it, and type its pinyin');
    loadData(ch, function (d) {
      if (!ui.canvas) return;
      ui.canvas.innerHTML = '';
      if (!d) { status('no stroke data for ' + charLabel(i) + ' — self-grade', 'warn'); sess.strokeOk[i] = 'nodata'; tryAdvance(); return; }
      // create() draws the FULL glyph immediately; quiz() then fades it over 400ms
      // (strokeFadeDuration). Keep the canvas hidden PAST the fade — revealing at ~260ms
      // mid-fade is what looked like the character "briefly flashing".
      ui.canvas.style.visibility = 'hidden';
      // Fingers on a 260px canvas are coarse: default stroke leniency (avg-distance
      // threshold 350 model units) rejects honest attempts that start/end slightly off
      // back to strict (user vetoed the 3.5 experiment). leniency is a CREATE-time
      // option, NOT a quiz() option. The real leniency trap was showHintAfterMisses:
      // the engine AUTO-ACCEPTS a stroke after N mistakes — scribble 3x and it passed.
      // Writing front = 0 (never auto-accept, no hint spoiling free recall); reading
      // front = 3 (guided practice, stubborn dots shouldn't wedge the card).
      var writer = window.HanziWriter.create(ui.canvas, ch, Object.assign({
        width: Math.min(ui.canvas.clientWidth || 260, 260), height: 260, padding: 8,
        showOutline: revealed() || dirMarker() === 'reading', // writing front = free recall; reading front = guided
        drawingWidth: 5, strokeFadeDuration: 1, leniency: 1, showHintAfterMisses: 0,
        charDataLoader: function (c, cb) { cb(d); }
      }, glyphColors()));
      setTimeout(function () { if (ui.canvas) ui.canvas.style.visibility = ''; }, 350);
      (window.__starts = window.__starts || []).push(ch);
      log(['start', ch]);
      writer.quiz({
        // guided reading practice: after 3 misses on a stroke, accept it so a tricky
        // dot/hook can't wedge the card (writing front keeps 0 = never auto-accept)
        showHintAfterMisses: dirMarker() === 'reading' ? 3 : 0,
        onCorrectStroke: function (dd) {
          status(charLabel(i) + ' stroke ' + (dd.strokeNum + 1) + ' ✓', 'ok');
          log(['ok', ch, dd.strokeNum]);
        },
        onMistake: function (dd) {
          sess.mistakes++;
          log(['miss', ch, dd.strokeNum, dd.mistakesOnStroke]);
          status(dd.mistakesOnStroke > 0 ? '✗ wrong stroke or order — try again' : '✗ not this stroke', 'bad');
          if (navigator.vibrate) navigator.vibrate(60);
        },
        onComplete: function () {
          sess.strokeOk[i] = true;
          log(['charwritten', ch]);
          if (!tryAdvance()) status(charLabel(i) + ' written ✓ — type its pinyin, or next ▸', 'ok');
        }
      });
    });
  }
  function tryAdvance() { // auto-advance once BOTH aspects of the current char are done
    var i = sess.charIdx;
    if (sess.strokeOk[i] && sess.pinDone[i] === true) {
      if (i + 1 < sess.word.length) { showChar(i + 1); return true; }
      finish(); return true;
    }
    return false;
  }
  function finish() {
    sess.quizDone = true;
    status('✓ done — ' + sess.giveups + ' skipped, ' + sess.mistakes + ' stroke mistakes, ' + sess.pinWrong + ' reading misses',
      (sess.giveups || sess.mistakes || sess.pinWrong) ? 'warn' : 'ok');
  }
  function advance() {
    if (sess.charIdx + 1 < sess.word.length) showChar(sess.charIdx + 1);
    else finish();
  }
  function giveup() { // skip THIS char only (both aspects), after showing it
    var i = sess.charIdx, ch = sess.word[i];
    if (sess.pinDone[i] !== 'gaveup') sess.giveups++;
    sess.pinDone[i] = 'gaveup'; sess.strokeOk[i] = 'gaveup';
    loadData(ch, function (d) {
      if (!d || !ui.canvas) { advance(); return; }
      ui.canvas.innerHTML = '';
      if (ui.pin) ui.pin.value = '';
      window.HanziWriter.create(ui.canvas, ch, Object.assign({
        width: Math.min(ui.canvas.clientWidth || 260, 260), height: 260, padding: 8,
        showOutline: true,
        charDataLoader: function (c, cb) { cb(d); }
      }, glyphColors())).animateCharacter({ onComplete: function () { status(charLabel(i) + ' skipped → next', 'warn'); setTimeout(advance, 250); } });
    });
  }
  function playAnim() { // ▶ stroke order: watch it, then re-quiz the SAME char
    // On the static back (browsing), ▶ animates the CURRENTLY SHOWN char and stays static.
    // staticMode (not answerCalled) is the truth: showStatic() is entered from several
    // mount paths that never set answerCalled, and charIdx would then beat the pager.
    var browsing = staticMode;
    var i = browsing ? browse.i : sess.charIdx, ch = sess.word[i];
    loadData(ch, function (d) {
      if (!d || !ui.canvas) return;
      ui.canvas.innerHTML = '';
      window.HanziWriter.create(ui.canvas, ch, Object.assign({
        width: Math.min(ui.canvas.clientWidth || 260, 260), height: 260, padding: 8,
        showOutline: true,
        charDataLoader: function (c, cb) { cb(d); }
      }, glyphColors())).animateCharacter({ onComplete: function () {
        if (browsing) browseRender(); else showChar(i);
      } });
    });
  }

  // ---------- pinyin picker: full-syllable tap entry (works with a DEAD keyboard) ----------
  // AnkiDroid's reviewer WebView shows no keyboard for <input> (#12251/#18063; fixed only
  // in the not-yet-stable new reviewer). The picker grades through the SAME pinLive path.
  var INITIALS = ['','b','p','m','f','d','t','n','l','g','k','h','j','q','x','zh','ch','sh','r','z','c','s','y','w'];
  var FINALS = ['a','o','e','i','u','ü','ai','ei','ao','ou','an','en','ang','eng','ong',
                'ia','ie','iao','iu','ian','in','iang','ing','iong',
                'ua','uo','uai','ui','uan','un','uang','ueng',
                'üe','er','ê'];
  var pk = { box: null, btn: null, prev: null, ini: '', fin: '' };
  function pickSyl(ini, fin) { // display spelling; grading is umlaut-insensitive anyway
    if (!ini && !fin) return '';
    if (fin.indexOf('ü') === 0 && 'jqxy'.indexOf(ini) >= 0) fin = 'u' + fin.slice(1);
    return ini + fin;
  }
  function chipsFill(el, items, sel, cb) {
    el.innerHTML = '';
    items.forEach(function (t) {
      var b = document.createElement('button');
      b.textContent = t;
      if (t === sel) b.className = 'sel';
      styleEl(b);
      b.addEventListener('click', function (e) { e.stopPropagation(); cb(t); });
      el.appendChild(b);
    });
  }
  function pickRender() {
    var ei = $('hd-initials'), ef = $('hd-finals'), et = $('hd-tones');
    if (!ei || !ef || !et || !pk.prev) return;
    chipsFill(ei, INITIALS, pk.ini, function (t) { pk.ini = t; pickRender(); });
    chipsFill(ef, FINALS, pk.fin, function (t) { pk.fin = t; pickRender(); });
    chipsFill(et, ['1','2','3','4','·'], pk.tone, function (t) { pk.tone = t; pickRender(); });
    var syl = pickSyl(pk.ini, pk.fin);
    pk.prev.textContent = syl ? syl + (pk.tone && pk.tone !== '·' ? pk.tone : '') : '—';
  }
  function pickCommit() {
    var syl = pickSyl(pk.ini, pk.fin);
    if (!syl || !ui.pin) return;
    var t = (pk.tone && pk.tone !== '·') ? pk.tone : '';
    ui.pin.value = syl + t;
    pinLive(); // same grader as keyboard path
    togglePicker(false);
  }
  function togglePicker(on) {
    if (!pk.box) return;
    if (on === undefined) on = pk.box.style.display === 'none';
    pk.box.style.display = on ? '' : 'none';
    if (on) pickRender();
  }
  function pickReset() { pk.ini = ''; pk.fin = ''; pk.tone = ''; if (pk.prev) pk.prev.textContent = '—'; }

  // ---------- pinyin input (live echo of the user's OWN text; no spoilers pre-reveal) ----------
  function pinLive() {
    var i = sess.charIdx, ch = sess.word[i];
    if (!ui.pin || !ch || sess.pinDone[i] === 'gaveup') return;
    var was = sess.pinDone[i];
    var v = ui.pin.value.trim();
    var w = wantSyl(i), got, ok;
    if (!v) { sess.pinDone[i] = undefined; if (ui.pinfb) ui.pinfb.textContent = ''; return; }
    var hz = hanzi(v); // Chinese IME commits characters — grade those directly
    if (hz) { ok = hz === ch; got = hz; }
    else {
      var g = syllabify(v);
      got = g.length ? (g[0].syl + (g[0].tone || '')).replace('v', 'ü') : v;
      // STRICT tone: a target tone must be matched (jiang ≠ jiang3). Neutral target
      // (tone 0 in the card field) accepts no-tone or 5.
      var wt = w.tone, gt = g[0].tone;
      if (!gt && /[1-5]/.test(v)) gt = 5; // digit-style input with no digit → neutral
      var toneOk = wt ? gt === wt : (gt === 0 || gt === 5);
      ok = g.length > 0 && g[0].syl === w.syl && toneOk;
    }
    sess.pinDone[i] = ok;
    if (!ok) {
      // anchor = LONGEST wrong string so far. Backspacing 'shei2' -> 'shei' must not
      // replace the anchor with its own prefix (that would whitewash the fix), while
      // incremental typing 's'->'sh'->'shang' extends the anchor every step.
      var pw = sess.pinPrevWrong[i];
      if (!pw || v.length > pw.length) sess.pinPrevWrong[i] = v;
    }
    else if (!sess.pinMiss[i] && (was === false || was === undefined)) {
      // Corrected answer still counts as a reading miss: final text must EXTEND the
      // longest wrong attempt (normal typing only ever appends). 'shei2' -> 'shei4'
      // diverges = a real miss; 'shang' -> 'shang1' extends = clean typing progress.
      var pw2 = sess.pinPrevWrong[i];
      if (pw2 && v.indexOf(pw2) !== 0) { sess.pinMiss[i] = true; sess.pinWrong++; }
    }
    if (ui.pinfb) ui.pinfb.textContent = revealed()
      ? got + (ok ? ' ✓' : ' ✗ → ' + w.syl + (w.tone || ''))
      : got + (ok ? ' ✓' : ' ✗');
    tryAdvance();
  }
  function pinNext() {
    var i = sess.charIdx;
    if (sess.pinDone[i] !== true && sess.pinDone[i] !== 'gaveup') { sess.pinWrong++; sess.pinMiss[i] = true; } // pinMiss: fixing the text after pressing next must not count the same miss twice
    advance();
  }

  // ---------- verdict ----------
  function verdict() {
    if (sess.skipped) return { ease: null, msg: 'answer shown early — self-grade' };
    if (!sess.quizDone) return { ease: null, msg: 'finish the card first' };
    if (sess.giveups) return { ease: 1, msg: sess.giveups + ' char' + (sess.giveups > 1 ? 's' : '') + ' skipped — Again' };
    if (sess.pinWrong) return { ease: 1, msg: sess.pinWrong + ' reading miss' + (sess.pinWrong > 1 ? 'es' : '') + ' — Again' };
    if (sess.mistakes === 0) return { ease: 3, msg: 'clean — Good' };
    return { ease: 2, msg: sess.mistakes + ' stroke mistakes — Hard' };
  }

  // ---------- wiring & lifecycle ----------
  function wire() {
    var box = $('hd-root') || (ui.canvas && ui.canvas.parentNode) || document.body;
    applyNight(box);
    if (ui.pin && !ui.pin._wired) {
      ui.pin._wired = true;
      ui.pin.addEventListener('input', pinLive);
      // AnkiDroid's reviewer WebView isn't focusableInTouchMode (#12251): tapping an input
      // shows no keyboard. Re-focus on touchend wakes the IME; the app-side fix is
      // Settings → Advanced → "Type answer into the card".
      // NOTE: no e.preventDefault() here — Chrome suppresses the soft keyboard when the
      // touch gesture that focuses a field was consumed by JS. Also: after drawing on the
      // canvas Android may drop the IME while document.activeElement STILL points at our
      // input — a bare focus() is then a no-op and the keyboard never returns (this is
      // why the keyboard only appeared once per card). blur()+focus() forces a real focus
      // change so the IME re-arms on EVERY character, not just the first.
      function wakeKeyboard() {
        try {
          if (document.activeElement === ui.pin) ui.pin.blur();
          ui.pin.focus();
          ui.pin.setSelectionRange(ui.pin.value.length, ui.pin.value.length);
        } catch (er) {}
      }
      ui.pin.addEventListener('touchend', function () {
        try { ui.pin.focus(); } catch (er) {}
        setTimeout(wakeKeyboard, 60);
      });
      ui.pin.addEventListener('click', wakeKeyboard); // mouse/trackpad + safety net
      ui.pin.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); pinNext(); } });
    }
    if (ui.next && !ui.next._wired) { ui.next._wired = true; ui.next.addEventListener('click', pinNext); }
    pk.box = $('hd-pickerbox'); pk.btn = $('hd-pickbtn'); pk.prev = $('hd-pickprev');
    if (pk.btn && !pk.btn._wired) { pk.btn._wired = true; pk.btn.addEventListener('click', function () { togglePicker(); }); }
    var pok = $('hd-pickok'), pcl = $('hd-pickclear');
    if (pok && !pok._wired) { pok._wired = true; pok.addEventListener('click', pickCommit); }
    if (pcl && !pcl._wired) { pcl._wired = true; pcl.addEventListener('click', function () { pickReset(); pickRender(); }); }
    var rb = $('hd-replay'), gb = $('hd-giveup'), cb = $('hd-check');
    if (rb && !rb._wired) { rb._wired = true; rb.addEventListener('click', playAnim); }
    if (gb && !gb._wired) { gb._wired = true; gb.addEventListener('click', giveup); }
    if (cb && !cb._wired) {
      cb._wired = true;
      cb.addEventListener('click', function () {
        var v = verdict();
        if (!v.ease) { status(v.msg, 'warn'); return; }
        if (!revealed()) { sess.answerCalled = true; status(v.msg + ' — checking answer…', 'warn'); reveal(); showStatic(); return; }
        status(v.msg + ' → ' + ['?', 'Again', 'Hard', 'Good', 'Easy'][v.ease], v.ease === 3 ? 'ok' : v.ease === 1 ? 'bad' : 'warn');
        grade(v.ease);
      });
    }
  }

  function showStatic() {
    // Answer side (Writing card FrontSide echo, or reveal-after-finish): ONE finished
    // character at a time in the panel with ◂ ▸ paging; the pinyin UI is done — hide it.
    [ui.hint, ui.pin, ui.next, ui.pinfb, pk.btn, pk.box, pk.prev].forEach(function (el) {
      if (el) el.style.display = 'none';
    });
    var gb = $('hd-giveup'); if (gb) gb.style.display = 'none'; // stay hidden: back is reveal, not skip
    var rb = $('hd-replay'); if (rb) rb.style.display = ''; // ▶ animates the browsed char
    var cb = $('hd-check'); if (cb) { cb.style.display = ''; applyNight(cb); }
    staticMode = true;
    if (ui.canvas) {
      ui.canvas.style.display = 'block';
      ui.canvas.innerHTML = '';
      browse.el = ui.canvas;
      browse.n = sess.word.length;
      browse.i = (sess.charIdx >= 0 && sess.charIdx < browse.n) ? sess.charIdx : 0;
      browseRender();
    }
    var v = verdict();
    status(sess.quizDone ? v.msg + ' — tap ✓ grade' : (sess.skipped ? 'answer shown early — self-grade' : 'answer'),
      sess.skipped ? 'warn' : 'ok');
  }

  // ---------- reading card back: stroke order SHOWN, never tested ----------
  function showBrowseOnly() {
    [ui.hint, ui.pin, ui.next, ui.pinfb, pk.btn, pk.box, pk.prev].forEach(function (el) {
      if (el) el.style.display = 'none';
    });
    var gb = $('hd-giveup'); if (gb) gb.style.display = 'none';
    var cb = $('hd-check'); if (cb) cb.style.display = 'none'; // recognition card: grade with Anki's buttons
    var rb = $('hd-replay'); if (rb) rb.style.display = '';
    staticMode = true;
    if (ui.canvas) {
      ui.canvas.style.display = 'block';
      ui.canvas.innerHTML = '';
      browse.el = ui.canvas;
      browse.n = sess.word.length;
      browse.i = 0;
      browseRender();
    }
    status('stroke order');
    playAnim(); // auto-draw char 1; settles back to the static browse view
  }

  function checkReveal() { // answer got shown mid-attempt → self-grade honestly
    if (!sess) return;
    if (domRevealed() && !sess.revealSeen) {
      sess.revealSeen = true;
      if (sess.started && !sess.quizDone) { sess.skipped = true; status('answer shown early — self-grade honestly', 'warn'); }
    }
    // ^ domRevealed handled below via onAnswerShown (idempotent)
    // AnkiDroid old reviewer: user taps SHOW ANSWER; no DOM change, no script re-run in
    // the question WebView — poll the app so the panel goes static + self-grade.
    // (Reading cards need this too now: their quiz lives on the front.)
    if (sess.answerCalled) return;
    if (domRevealed() || apiRevealed()) onAnswerShown();
  }

  function mount() {
    var canvas = $('hd-canvas');
    if (!canvas) return;
    var root = $('hd-root'); if (root) root.style.display = ''; // echoed-without-script markup stays hidden; live boot reveals
    if (NIGHT === null) NIGHT = detectNight();
    ui.canvas = canvas; ui.status = $('hd-status');
    if (NIGHT) { canvas.style.background = '#1e1e1e'; canvas.style.borderColor = '#555'; }
    ui.pin = $('hd-pin'); ui.pinfb = $('hd-pinfb'); ui.hint = $('hd-pinhint'); ui.next = $('hd-pinnext');
    var w = hanzi(txt('hd-hanzi'));
    if (!w) { status('no hanzi in card', 'warn'); return; }
    if (!sess || sess.word !== w) sess = newSess(w);
    sess.mounts++;
    wire();
    checkReveal();
    var dir = dirMarker();
    if (dir === 'reading') {
      // Reading card now carries the quiz on its FRONT (guide glyph visible + picker).
      // Revealed (back re-render / answer WebView) or repeat mount -> static browse.
      if (sess.mounts === 1 && !domRevealed() && !apiRevealed()) { showChar(sess.started ? sess.charIdx : 0); return; }
      showBrowseOnly(); return;
    }
    if (dir === 'writing' && sess.mounts > 1 && sess.started && !sess.quizDone && !sess.answerCalled && !sess.revealSeen)
      sess.skipped = true; // FrontSide echo re-render with quiz unfinished = user revealed early
    // Answer side: same-page re-render (mounts>1), new-reviewer visible #answer, OR a
    // FRESH boot inside AnkiDroid's old-reviewer answer WebView (mounts==1 — ask the app).
    if (dir === 'writing' && (sess.mounts > 1 || domRevealed() || apiRevealed())) { showStatic(); return; }
    if (dir === '' && (domRevealed() || (sess.mounts > 1 && (sess.skipped || sess.quizDone || sess.started)))) { showStatic(); return; }
    showChar(sess.started ? sess.charIdx : 0);
  }
  window.__HD_MOUNT = mount;
  window.__HD = { sess: function () { return sess; }, pinNext: pinNext, showChar: showChar, verdict: verdict,
                  recheckNight: function () { NIGHT = detectNight(); applyNight($('hd-root') || document.body);
                    if (ui.canvas) { ui.canvas.style.background = NIGHT ? '#1e1e1e' : ''; ui.canvas.style.borderColor = NIGHT ? '#555' : ''; }
                    return NIGHT; } };

  try { new MutationObserver(checkReveal).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  try { setInterval(checkReveal, 700); } catch (e) {} // old AnkiDroid reviewer has no reveal DOM event
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
