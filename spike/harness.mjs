import path from 'path';
import fs from 'fs';
import * as G from './grader.mjs';
const dir = path.resolve(path.dirname(new URL(import.meta.url).search.replace(/^\?/, '')));
const base = process.env.HZ_DIR || dir;
const CHARS = JSON.parse(fs.readFileSync(path.join(base, 'chars.json'), 'utf8'));

function run(ch) {
  const strokes = G.strokesFor(CHARS[ch]);
  const rows = [];
  const S = 10;
  const T = (name, i, pts, opts) => {
    const t0 = process.hrtime.bigint();
    const r = G.strokeMatches(pts, strokes, i, opts);
    rows.push({ char: ch, stroke: i, test: name, accept: r.isMatch, backwards: !!r.backwards, us: Number(process.hrtime.bigint() - t0) / 1000 });
  };
  for (let i = 0; i < strokes.length; i++) {
    const ref = strokes[i].points;
    T('perfect', i, ref, {});
    T('resampled', i, G.resample(ref, S), {});
    T('finger-jitter(18)', i, G.resample(G.jitter(ref, 18, 1234 + i), S), {});
    T('stylus-jitter(6)', i, G.resample(G.jitter(ref, 6, 99 + i), 30), {});
    T('reversed', i, ref.slice().reverse(), {});
    if (i + 1 < strokes.length) T('wrong-order(shift+1)', i, G.resample(strokes[i + 1].points, S), {});
    if (i + 2 < strokes.length) T('wrong-order(+2)', i, G.resample(strokes[i + 2].points, S), {});
    T('translated(+120,+120)', i, ref.map((p) => ({ x: p.x + 120, y: p.y + 120 })), {});
    T('translated(+220,+0)', i, ref.map((p) => ({ x: p.x + 220, y: p.y })), {});
    T('undershoot(50%)', i, (() => { const n = G.resample(ref, S); return n.slice(0, Math.max(2, n.length >> 1)); })(), {});
    T('overshoot(1.5x)', i, G.scaleFromCentroid(G.resample(ref, S), 1.5), {});
    T('scribble-1pt', i, [ref[0], ref[0]], {});
  }
  return rows;
}

// The interesting case: the user draws stroke k while the app expects stroke j (j != k).
function orderConfusion(ch) {
  const strokes = G.strokesFor(CHARS[ch]);
  const out = [];
  for (let expect = 0; expect < strokes.length; expect++) {
    for (let drew = 0; drew < strokes.length; drew++) {
      if (drew === expect) continue;
      const r = G.strokeMatches(G.resample(strokes[drew].points, 10), strokes, expect, {});
      out.push({ char: ch, expect, drew, accept: r.isMatch });
    }
  }
  return out;
}

const all = [];
const conf = [];
for (const ch of Object.keys(CHARS)) { all.push(...run(ch)); conf.push(...orderConfusion(ch)); }
fs.writeFileSync(path.join(base, 'results.json'), JSON.stringify({ strokes: all, order: conf }, null, 1));

const byTest = {};
for (const r of all) (byTest[r.test] ||= []).push(r);
const PCT = (a) => (100 * a.filter((x) => x.accept).length / a.length).toFixed(0) + '%';
console.log(`chars: ${Object.keys(CHARS).join(' ')}   total stroke attempts: ${all.length}\n`);
console.log('test'.padEnd(24) + 'accepted' + '  n' + '   maxMs');
for (const [k, v] of Object.entries(byTest))
  console.log(k.padEnd(24) + PCT(v).padStart(7) + String(v.length).padStart(5) + (Math.max(...v.map((x) => x.us)) / 1000).toFixed(2).padStart(8));

// Hard gates: behaviour the product depends on.
const expect = {
  perfect: true, resampled: true, 'finger-jitter(18)': true, 'stylus-jitter(6)': true,
  reversed: false, 'translated(+120,+120)': true, 'scribble-1pt': false,
  'wrong-order(shift+1)': false, 'wrong-order(+2)': false,
};
// Characterised leniency (documented, NOT gated to 0/100 — Kotlin port must reproduce
// ~these rates; see results.json for per-stroke golden data):
//  undershoot(50%)  ~53% accepted — short strokes forgive early lifts
//  overshoot(1.5x)  ~100% accepted — the length check only has a lower bound
//  translated(+220) rejected on strokes>0, accepted on stroke 0 (doubled threshold)
console.log('\n--- expectations ---');
let bad = 0;
for (const [k, want] of Object.entries(expect)) {
  const got = PCT(byTest[k]);
  const ok = want ? got === '100%' : got === '0%';
  if (!ok) bad++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + k.padEnd(24) + 'want ' + (want ? 'accept all ' : 'reject all ') + ' got ' + got);
}
const rev = all.filter((r) => r.test === 'reversed');
console.log('  ' + (rev.every((r) => r.backwards) ? 'PASS  ' : 'note  ') + 'reversed strokes flagged as backwards: ' + rev.filter((r) => r.backwards).length + '/' + rev.length);
// hanzi-writer doubles the distance threshold on stroke 0 (350 vs 175 after the 0.5 mod).
// Strokes with self-proximate geometry (L-shaped 𠃌 hooks) can also pass a 220-unit shift
// because avgDist measures distance to the NEAREST point of the same stroke.
// Informational: port should reproduce these rates; tightening END_TH is a tuning knob.
const t220 = all.filter((r) => r.test === 'translated(+220,+0)');
const leakT = [...new Set(t220.filter((r) => r.accept).map((r) => `${r.char}#${r.stroke}`))];
console.log('  note    translated(+220,+0)         accepted ' + PCT(t220) + ' — leaked on: ' + (leakT.join(' ') || 'none'));

const wrongs = conf.filter((c) => c.drew > c.expect);
const early = conf.filter((c) => c.drew < c.expect);
console.log('\n--- stroke-order enforcement (drew a DIFFERENT stroke than expected) ---');
console.log('  drew a LATER stroke (out of order, the common mistake): accepted ' + PCT(wrongs) + '  n=' + wrongs.length);
console.log('  drew an EARLIER stroke (repeat/miscount):               accepted ' + PCT(early) + '  n=' + early.length);
const leakY = wrongs.filter((c) => c.accept);
if (leakY.length) {
  console.log('  leaked cases (char, expected#, actually drew#):');
  for (const c of leakY) console.log(`    ${c.char} expected ${c.expect} drew ${c.drew}`);
}
const us = all.map((r) => r.us).sort((a, b) => a - b);
console.log('\ntiming per stroke check: median ' + us[us.length >> 1].toFixed(0) + 'us  p95 ' + us[Math.floor(us.length * 0.95)].toFixed(0) + 'us  max ' + us[us.length - 1].toFixed(0) + 'us');
console.log('\n' + (bad ? bad + ' expectation(s) failed' : 'all behavioural expectations hold'));
process.exit(bad ? 1 : 0);
