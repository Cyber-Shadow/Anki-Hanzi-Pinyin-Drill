"""Browser test driver injector for hanzi-drill v0.4.
run(url, mode) -> kicks window.__RUN(mode) in the page, polls window.__R."""
import json, time, subprocess, sys

DRIVER = r'''
(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) {} await sleep(40); } return false; };
  const cv = () => document.getElementById('hd-canvas');
  const resample30 = (pts) => { const n = pts.length, out = []; for (let j = 0; j < 30; j++) { const t = j/29*(n-1), i = Math.floor(t), f = t-i; const a = pts[i], b = pts[Math.min(i+1,n-1)]; out.push([a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f]); } return out; };
  const pick = () => { const s = cv().querySelector('svg'); if (!s) return null; for (const p of s.querySelectorAll('path')) { const b = p.getBoundingClientRect(); if (b.width > 1 && b.height > 1) return {svg: s, vis: p}; } return null; };
  const hasVisPath = () => !!pick();
  async function drawStroke(pts, kind) {
    let got = null;
    for (let t = 0; t < 60 && !got; t++) { got = pick(); if (!got) await sleep(25); }
    if (!got) throw new Error('no visible stroke path');
    const {svg, vis} = got;
    const ctm = vis.getCTM(), rect = svg.getBoundingClientRect();
    const J = window.__jitter || 0;      // per-stroke constant offset (realistic: stroke drawn a few px off-median)
    const O = window.__oscz || 0;        // per-point oscillating wobble (harsh synthetic; mostly for probes)
    let jn = 0;
    const sx = (p) => {
      let c = {x: ctm.a*p[0]+ctm.c*p[1]+ctm.e+rect.left, y: ctm.b*p[0]+ctm.d*p[1]+ctm.f+rect.top};
      if (O) { c.x += Math.sin(++jn * 0.7) * O; c.y += Math.cos(jn * 0.9) * O; }
      else if (J) { c.x += J; c.y += J * 0.6; } // constant lateral shift for the whole stroke
      return c;
    };
    const fire = (type, pt) => {
      const c = sx(pt);
      if (kind === 'mouse') svg.dispatchEvent(new MouseEvent(type, {bubbles:true, clientX:c.x, clientY:c.y, buttons: /up$/.test(type)?0:1}));
      else {
        const tp = new Touch({identifier:1, target: svg, clientX:c.x, clientY:c.y});
        const end = /end$/.test(type);
        svg.dispatchEvent(new TouchEvent(type, {bubbles:true, cancelable:true, touches: end?[]:[tp], targetTouches: end?[]:[tp], changedTouches:[tp]}));
      }
    };
    const names = kind==='mouse' ? ['mousedown','mousemove','mouseup'] : ['touchstart','touchmove','touchend'];
    fire(names[0], pts[0]);
    for (let j = 1; j < pts.length; j++) { fire(names[1], pts[j]); await sleep(2); }
    fire(names[2], pts[pts.length-1]);
    await sleep(40);
  }
  window.__RUN = async (mode) => {
    window.__R = 'running';
    try {
      window.__log = []; window.__starts = []; window.__eases = [];
      // record every glyph hanzi-writer is asked to draw, so replay-target bugs show up
      window.__creates = [];
      const _origCreate = window.HanziWriter.create;
      window.HanziWriter.create = function (el, ch, o) { window.__creates.push(ch); return _origCreate.call(this, el, ch, o); };
      let answered = false;
      window.api = {
        ankiShowAnswer: () => { if (!answered) { answered = true; document.body.insertAdjacentHTML('beforeend', '<div id="answer"></div>'); } return true; },
        ankiAnswerEase1: () => { window.__eases.push(1); return true; },
        ankiAnswerEase2: () => { window.__eases.push(2); return true; },
        ankiAnswerEase3: () => { window.__eases.push(3); return true; },
        ankiAnswerEase4: () => { window.__eases.push(4); return true; }
      };
      const status = () => document.getElementById('hd-status').textContent;
      const st = () => __HD.sess();
      const pickTap = (sel, label) => { const b = [...document.querySelectorAll(sel + ' button')].find(x => x.textContent === label); if (!b) throw new Error('chip not found: ' + label); b.click(); };
      const R = {mode: mode};
      const kind = (mode === 'touch') ? 'touch' : 'mouse';
      const base = (mode === 'touch' || mode === 'happy' || mode === 'picker') ? (mode === 'picker' ? 'picker' : 'happy') : (mode === 'correctmid' ? 'correct' : mode);

      if (base === 'backfresh') {
        // page was loaded with ?answering=1: FRESH boot (mounts==1), no #answer element,
        // api.isDisplayingAnswer()===true -> widget must go static immediately.
        const vis = (el) => el && getComputedStyle(el).display !== 'none';
        R.canvasLive = await waitFor(() => cv().querySelector('svg'), 8000);
        R.mounts = st().mounts;
        R.canvases = cv().querySelectorAll(':scope > div').length;   // exactly 1
        R.pinHidden = !vis(document.getElementById('hd-pin'));
        R.pinhintHidden = !vis(document.getElementById('hd-pinhint'));
        R.pickHidden = !vis(document.getElementById('hd-pickbtn'));
        var pb = [...document.querySelectorAll('.hd-btns button')].map(b => b.textContent.trim());
        R.pagerBtns = pb.filter(t => t.includes('\u25c2') || t.includes('\u25b8'));
        R.label1 = (document.querySelector('.hd-btns span') || {}).textContent;
        if (R.pagerBtns.length >= 2) {
          const fwd = [...document.querySelectorAll('.hd-btns button')].find(b => b.textContent.includes('\u25b8'));
          fwd.click(); await sleep(700);
          R.label2 = (document.querySelector('.hd-btns span') || {}).textContent;
        }
        // replay must animate the CURRENTLY SHOWN char (pager label index), not sess.charIdx
        R.createsBefore = window.__creates.slice(-1)[0];
        const lblIdx = () => parseInt(((document.querySelector('.hd-btns span') || {}).textContent || '1').trim().charAt(0), 10);
        document.getElementById('hd-replay').click();
        await sleep(400);
        R.replayTarget = window.__creates.slice(-1)[0];
        R.expectedTarget = ['\u5546', '\u5e97'][lblIdx() - 1];
        R.quizStayedStatic = getComputedStyle(document.getElementById('hd-pin')).display === 'none';
        window.__R = R; return;
      }

      if (base === 'sloppy') {
        // leniency check: wobbling every stroke by ~14px client-space must PASS with the
        // raised leniency (0 mistakes, Good) — with default leniency this produced misses.
        window.__jitter = 14;
        R.canvasLiveWithoutKeyboard = await waitFor(() => hasVisPath(), 8000);
        const pins = ['shang1', 'dian4'], chars = ['\u5546', '\u5e97'];
        for (let ci = 0; ci < 2; ci++) {
          await waitFor(() => st().charIdx === ci && hasVisPath(), 8000);
          const p = document.getElementById('hd-pin');
          p.value = pins[ci]; p.dispatchEvent(new Event('input')); await sleep(150);
          const ms = HD_DATA[chars[ci]].medians;
          for (let k = 0; k < ms.length; k++) await drawStroke(resample30(ms[k]), 'mouse');
          await sleep(600);
        }
        window.__jitter = 0;
        R.mistakes = st().mistakes; R.done = st().quizDone; R.status = status();
        document.getElementById('hd-check').click(); await sleep(300);
        document.getElementById('hd-check').click(); await sleep(250);
        R.ease = (window.__eases || []).join(',');
        window.__R = R; return;
      }

      if (base === 'readbrowse') {
        // ?dir=reading page = FRONT of the recognition card: guided quiz (outline visible,
        // picker live, chars already shown). Complete it, then emulate the answer render
        // (mounts>1) -> stroke-order browse mode: quiz UI gone, char 1 animates.
        const vis2 = (el) => el && getComputedStyle(el).display !== 'none';
        R.canvasLiveWithoutKeyboard = await waitFor(() => hasVisPath(), 8000);
        R.pinShownFront = vis2(document.getElementById('hd-pin'));
        R.pickerShown = vis2(document.getElementById('hd-pickbtn'));
        // guided: outline (guide glyph) must be VISIBLE: a #9ca3af-stroked path inside a
        // group with computed opacity > 0 (hanzi-writer fades the outline group).
        R.outlineVisible = await waitFor(() => {
          const s = cv().querySelector('svg'); if (!s) return false;
          return [...s.querySelectorAll('path')].some(p => {
            const st = (p.getAttribute('stroke') || '').replace(/\s/g, '');
            return /156,163,175/.test(st) && parseFloat(getComputedStyle(p.parentElement).opacity || '1') > 0.5;
          });
        }, 4000);
        const pins = ['shang1', 'dian4'], chars = ['\u5546', '\u5e97'];
        for (let ci = 0; ci < 2; ci++) {
          await waitFor(() => st().charIdx === ci && hasVisPath(), 8000);
          const p = document.getElementById('hd-pin');
          p.value = pins[ci]; p.dispatchEvent(new Event('input')); await sleep(150);
          const ms = HD_DATA[chars[ci]].medians;
          for (let k = 0; k < ms.length; k++) await drawStroke(resample30(ms[k]), 'mouse');
          await sleep(600);
        }
        R.done = st().quizDone; R.okCount = (window.__log || []).filter(l => l[0] === 'ok').length;
        // reveal: answer-side re-render -> browse only
        const ans = document.createElement('div'); ans.id = 'answer';
        document.body.appendChild(ans);
        ans.appendChild(document.querySelector('.hd-box'));
        window.api.ankiShowAnswer.__done = true;
        window.__creates = []; // auto-animate proof must count post-reveal creates only
        window.__HD_MOUNT();
        await sleep(900);
        R.pinHiddenOnBack = !vis2(ans.querySelector('#hd-pin'));
        R.checkHiddenOnBack = !vis2(ans.querySelector('#hd-check'));
        R.autoAnimated = await waitFor(() => window.__creates && window.__creates.length > 0, 4000);
        await sleep(4500); // settle to static after 商's animation
        R.settledStatic = !!document.querySelector('#hd-canvas svg');
        const fwd = [...document.querySelectorAll('.hd-btns button')].find(b => b.textContent.includes('\u25b8'));
        R.pagerShown = !!fwd;
        if (fwd) { window.__creates = []; fwd.click(); await sleep(900);
          R.secondChar = (window.__creates || [])[0];
          R.label = (document.querySelector('.hd-btns span') || {}).textContent; }
        window.__R = R; return;
      }

      if (base === 'onechar') {
        // page loaded with ?word=one: single-char card -> next button hidden; completing
        // the one char finishes the card and grades Good.
        R.canvasLiveWithoutKeyboard = await waitFor(() => hasVisPath(), 8000);
        const vis2 = (el) => el && getComputedStyle(el).display !== 'none';
        R.nextHidden = !vis2(document.getElementById('hd-pinnext'));
        const p = document.getElementById('hd-pin');
        p.value = 'shang1'; p.dispatchEvent(new Event('input'));
        await sleep(150);
        R.pin0 = st().pinDone[0];
        const ms = HD_DATA['\u5546'].medians;
        for (let k = 0; k < ms.length; k++) await drawStroke(resample30(ms[k]), 'mouse');
        await sleep(600);
        R.done = st().quizDone; R.status = status();
        document.getElementById('hd-check').click(); await sleep(300);
        R.afterCheck = status();
        document.getElementById('hd-check').click(); await sleep(250);
        R.ease = (window.__eases || []).join(',');
        window.__R = R; return;
      }

      if (base === 'correct') {
        // 商店 two-char word: char0 typed CLEAN; char1 typed WRONG (dian3) then FIXED
        // (dian4) without pressing next -> must count as exactly 1 reading miss -> Again.
        R.canvasLiveWithoutKeyboard = await waitFor(() => hasVisPath(), 8000);
        const pins = ['shang1', 'dian4'], chars = ['\u5546', '\u5e97'];
        for (let ci = 0; ci < 2; ci++) {
          await waitFor(() => st().charIdx === ci && hasVisPath(), 8000);
          const p = document.getElementById('hd-pin');
          if (ci === 1) {
            p.value = 'dian3'; p.dispatchEvent(new Event('input')); await sleep(150);
            R.midWrong = st().pinDone[1];
            if (mode === 'correctmid') { p.value = ''; p.dispatchEvent(new Event('input')); await sleep(100); } // clear, then fix
            p.value = 'dian4'; p.dispatchEvent(new Event('input')); await sleep(600);
          } else {
            p.value = pins[ci]; p.dispatchEvent(new Event('input')); await sleep(150);
          }
          const ms = HD_DATA[chars[ci]].medians;
          for (let k = 0; k < ms.length; k++) await drawStroke(resample30(ms[k]), 'mouse');
          await sleep(600);
        }
        R.pinWrong = st().pinWrong; R.status = status(); R.done = st().quizDone;
        document.getElementById('hd-check').click(); await sleep(300);
        R.afterCheck = status();
        document.getElementById('hd-check').click(); await sleep(250);
        R.ease = (window.__eases || []).join(',');
        window.__R = R; return;
      }

      if (base === 'staticback') {
        // emulate AnkiDroid: finish the quiz, then the answer side re-renders the FRONT
        // markup (FrontSide echo) — script re-runs, __HD_BOOTED -> __HD_MOUNT, mounts=2.
        R.canvasLiveWithoutKeyboard = await waitFor(() => hasVisPath(), 8000);
        const pins = ['shang1', 'dian4'], chars = ['\u5546', '\u5e97'];
        for (let ci = 0; ci < 2; ci++) {
          await waitFor(() => st().charIdx === ci && hasVisPath(), 8000);
          const p = document.getElementById('hd-pin');
          p.value = pins[ci]; p.dispatchEvent(new Event('input'));
          const ms = HD_DATA[chars[ci]].medians;
          for (let k = 0; k < ms.length; k++) await drawStroke(resample30(ms[k]), 'mouse');
          await sleep(600);
        }
        R.doneBeforeReveal = st().quizDone;
        // now the reveal: AnkiDroid re-renders the whole page = back HTML; the front
        // markup (incl. our widget) lives INSIDE <div id="answer">, old nodes gone.
        const ans = document.createElement('div'); ans.id = 'answer';
        document.body.appendChild(ans);
        ans.appendChild(document.querySelector('.hd-box'));
        window.api.ankiShowAnswer.__done = true;
        window.__HD_MOUNT();
        await sleep(800);
        R.staticSvgs = ans.querySelectorAll('#hd-canvas svg').length;
        const vis = (el) => el && getComputedStyle(el).display !== 'none';
        R.pinHiddenOnBack = !vis(ans.querySelector('#hd-pin'));
        R.pinhintHidden = !vis(ans.querySelector('#hd-pinhint'));
        // static back = ONE glyph at a time + paging row (2-char word)
        R.backCanvases = ans.querySelectorAll('.hd-canvas > div').length;
        R.backPager = !!ans.querySelector('.hd-btns button');
        R.backBtns = Array.from(ans.querySelectorAll('button')).map(function (b) { return b.textContent.trim(); });
        R.pickbtnHidden = !vis(ans.querySelector('#hd-pickbtn'));
        R.statusOnBack = ans.querySelector('#hd-status').textContent;
        // grade now works on the revealed page
        document.getElementById('hd-check').click();
        await sleep(300);
        R.ease = (window.__eases||[]).join(',');
        window.__R = R; return;
      }

      if (base === 'reveal') {
        // draw a little, then reveal early via the check button path / Anki showAnswer
        await waitFor(() => hasVisPath(), 8000);
        R.canvasLiveWithoutKeyboard = true;
        document.getElementById('hd-check').click(); // verdict: not done -> status; then:
        window.api.ankiShowAnswer();
        await sleep(300);
        R.status = status();
        document.getElementById('hd-check').click(); await sleep(150);
        R.afterCheck = status(); R.ease = (window.__eases||[]).join(',');
        window.__R = R; return;
      }

      R.canvasLiveWithoutKeyboard = await waitFor(() => hasVisPath(), 8000);
      const vis2 = (el) => el && getComputedStyle(el).display !== 'none';
      R.replayHiddenFront = !vis2(document.getElementById('hd-replay'));
      R.giveupHiddenFront = !vis2(document.getElementById('hd-giveup'));
      const pins = ['shang1', 'dian4'], chars = ['\u5546', '\u5e97'];
      for (let ci = 0; ci < 2; ci++) {
        R['ready' + ci] = await waitFor(() => st().charIdx === ci && hasVisPath(), 8000);
        const p = document.getElementById('hd-pin');
        if (base === 'picker') {
          document.getElementById('hd-pickbtn').click(); await sleep(80);
          const parts = [['sh','ang','1'], ['d','ian','4']][ci];
          pickTap('#hd-initials', parts[0]); pickTap('#hd-finals', parts[1]); pickTap('#hd-tones', parts[2]);
          await sleep(60);
          R['prev' + ci] = document.getElementById('hd-pickprev').textContent;
          document.getElementById('hd-pickok').click(); await sleep(120);
        }
        else if (base === 'wrongpin' && ci === 0) { p.value = 'shang4'; }
        else if (base === 'nopin') { /* leave empty */ }
        else p.value = pins[ci];
        p.dispatchEvent(new Event('input'));
        await sleep(150);
        R['pin' + ci] = st().pinDone[ci];
        if (base === 'giveup' && ci === 0) {
          document.getElementById('hd-giveup').click();
          R.advancedAfterGiveup = await waitFor(() => st().charIdx === 1, 15000); // full-char animation takes ~11 strokes x 1s
          R.giveups = st().giveups;
          continue; // char 1 draws normally below
        }
        const ms = HD_DATA[chars[ci]].medians;
        if (base === 'wrongorder' && ci === 1) {
          const s = resample30(ms[3]);
          for (let k = 0; k < 3; k++) { await drawStroke(s, kind); R.wrongOrderStatus = status(); }
        } else {
          for (let k = 0; k < ms.length; k++) await drawStroke(resample30(ms[k]), kind);
        }
        if (base === 'wrongpin' && st().pinDone[ci] === false) {
          document.getElementById('hd-pinnext').click(); await sleep(400); // escape hatch
        }
        await sleep(600);
      }
      R.status = status();
      R.mistakes = st().mistakes; R.giveups = st().giveups; R.done = st().quizDone; R.pinWrong = st().pinWrong;
      document.getElementById('hd-check').click(); await sleep(400);   // reveals
      R.afterCheck = status();
      document.getElementById('hd-check').click(); await sleep(250);   // grades
      R.ease = (window.__eases||[]).join(',');
      R.okCount = (window.__log||[]).filter(l => l[0]==='ok').length;
      window.__R = R;
    } catch (e) { window.__R = 'ERR: ' + e.message + ' | last: ' + JSON.stringify((window.__log||[]).slice(-3)) + ' | status: ' + document.getElementById('hd-status').textContent; }
  };
  return 'driver-ready';
})()
'''

def run(browser_js, url, mode, settle=16):
    """browser_js: the js() helper from browser_exec context"""
    out = {}
    # navigate fresh so boot state is clean
    subprocess.run(["browser-harness", "goto", url], capture_output=True) if False else None
    browser_js(DRIVER)
    browser_js("window.__RUN(%r); 'go'" % mode)
    t0 = time.time()
    while time.time() - t0 < settle:
        time.sleep(1.2)
        r = browser_js("typeof window.__R === 'string' ? window.__R : JSON.stringify(window.__R)")
        if r != 'running':
            try: r = json.loads(r)
            except Exception: pass
            return r
    return 'TIMEOUT'
