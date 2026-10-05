import fs from 'fs';
import path from 'path';
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));

// ---- geometry (ported from hanzi-writer geometry.ts) ----
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const last = (a) => a[a.length - 1];
const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
const mag = (p) => Math.hypot(p.x, p.y);
const dist = (p, q) => mag(sub(p, q));
export const round = (p, prec = 1) => { const m = prec * 10; return { x: Math.round(m * p.x) / m, y: Math.round(m * p.y) / m }; };
export const pathLen = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i], pts[i - 1]); return l; };
const cosSim = (a, b) => (a.x * b.x + a.y * b.y) / mag(a) / mag(b);
const extendOnLine = (p1, p2, d) => { const v = sub(p2, p1); const n = d / mag(v); return { x: p2.x + n * v.x, y: p2.y + n * v.y }; };

function frechet(c1, c2) {
  const lng = c1.length >= c2.length ? c1 : c2;
  const sht = c1.length >= c2.length ? c2 : c1;
  let prev = [];
  for (let i = 0; i < lng.length; i++) {
    const cur = [];
    for (let j = 0; j < sht.length; j++) {
      let v;
      if (i === 0 && j === 0) v = dist(lng[0], sht[0]);
      else if (i > 0 && j === 0) v = Math.max(prev[0], dist(lng[i], sht[0]));
      else if (i === 0 && j > 0) v = Math.max(last(cur), dist(lng[0], sht[j]));
      else v = Math.max(Math.min(prev[j], prev[j - 1], last(cur)), dist(lng[i], sht[j]));
      cur.push(v);
    }
    prev = cur;
  }
  return last(prev);
}

const subdivide = (curve, maxLen = 0.05) => {
  const out = [curve[0]];
  for (const p of curve.slice(1)) {
    const prev = last(out);
    const segLen = dist(p, prev);
    if (segLen > maxLen) {
      const n = Math.ceil(segLen / maxLen);
      for (let i = 0; i < n; i++) out.push(extendOnLine(p, prev, (-segLen / n) * (i + 1)));
    } else out.push(p);
  }
  return out;
};

// arc-length resample to numPoints (equivalent to hanzi-writer's outlineCurve,
// rewritten without the shifting-array walk that can run off the end of the curve)
const outlineCurve = (curve, numPoints = 30) => {
  const cum = [0];
  for (let i = 1; i < curve.length; i++) cum.push(cum[i - 1] + dist(curve[i - 1], curve[i]));
  const total = cum[cum.length - 1];
  if (total === 0) return [curve[0]];
  const out = [];
  let seg = 0;
  for (let k = 0; k < numPoints; k++) {
    const target = (total * k) / (numPoints - 1);
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span === 0 ? 0 : (target - cum[seg]) / span;
    out.push({
      x: curve[seg].x + (curve[seg + 1].x - curve[seg].x) * t,
      y: curve[seg].y + (curve[seg + 1].y - curve[seg].y) * t,
    });
  }
  return out;
};

export const normalizeCurve = (curve) => {
  const o = outlineCurve(curve);
  const mean = { x: avg(o.map((p) => p.x)), y: avg(o.map((p) => p.y)) };
  const t = o.map((p) => sub(p, mean));
  const scale = Math.sqrt(avg([t[0].x ** 2 + t[0].y ** 2, last(t).x ** 2 + last(t).y ** 2]));
  return subdivide(t.map((p) => ({ x: p.x / scale, y: p.y / scale })));
};

const rotate = (c, th) => c.map((p) => ({ x: Math.cos(th) * p.x - Math.sin(th) * p.y, y: Math.sin(th) * p.x + Math.cos(th) * p.y }));

// ---- reference stroke ----
export function makeStroke(points, i) {
  return {
    points, strokeNum: i,
    start: () => points[0],
    end: () => last(points),
    length: () => pathLen(points),
    vectors: () => points.slice(1).map((p, k) => sub(p, points[k])),
    distTo: (p) => Math.min(...points.map((sp) => dist(sp, p))),
    avgDistTo: (pts) => pts.reduce((a, p) => a + Math.min(...points.map((sp) => dist(sp, p))), 0) / pts.length,
  };
}

// ---- strokeMatches.ts ----
const COS_TH = 0, END_TH = 250, FRECHET_TH = 0.4, MIN_LEN_TH = 0.35;
const ROTATIONS = [Math.PI / 16, Math.PI / 32, 0, -Math.PI / 32, -Math.PI / 16];

const dedupe = (pts) => pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);

const dirMatches = (pts, stroke) => {
  const sv = stroke.vectors();
  const sims = [];
  for (let i = 1; i < pts.length; i++) {
    const v = sub(pts[i], pts[i - 1]);
    sims.push(Math.max(...sv.map((s) => cosSim(s, v))));
  }
  return avg(sims) > COS_TH;
};

const matchData = (points, stroke, o) => {
  const { leniency = 1, isOutlineVisible = false, checkBackwards = true, avgDistThresh = 350 } = o;
  const ad = stroke.avgDistTo(points);
  const distMod = (isOutlineVisible || stroke.strokeNum > 0) ? 0.5 : 1;
  if (!(ad <= avgDistThresh * distMod * leniency)) return { isMatch: false, avgDist: ad, backwards: false };
  const ends = dist(stroke.start(), points[0]) <= END_TH * leniency && dist(stroke.end(), last(points)) <= END_TH * leniency;
  const shape = (() => {
    const n1 = normalizeCurve(points), n2 = normalizeCurve(stroke.points);
    let min = Infinity;
    for (const th of ROTATIONS) min = Math.min(min, frechet(n1, rotate(n2, th)));
    return min <= FRECHET_TH * leniency;
  })();
  const lenOk = (leniency * (pathLen(points) + 25)) / (stroke.length() + 25) >= MIN_LEN_TH;
  const isMatch = ends && dirMatches(points, stroke) && shape && lenOk;
  if (checkBackwards && !isMatch) {
    const back = matchData(points.slice().reverse(), stroke, { ...o, checkBackwards: false });
    if (back.isMatch) return { isMatch, avgDist: ad, backwards: true };
  }
  return { isMatch, avgDist: ad, backwards: false };
};

export function strokeMatches(userPts, strokes, strokeNum, options = {}) {
  const points = dedupe(userPts);
  if (points.length < 2) return { isMatch: false, backwards: false };
  const { isMatch, backwards, avgDist } = matchData(points, strokes[strokeNum], options);
  if (!isMatch) return { isMatch, backwards };
  let best = avgDist, better = false;
  for (const later of strokes.slice(strokeNum + 1)) {
    const r = matchData(points, later, { ...options, checkBackwards: false });
    if (r.isMatch && r.avgDist < best) { best = r.avgDist; better = true; }
  }
  if (better) {
    const adj = (0.6 * (best + avgDist)) / (2 * avgDist);
    const r = matchData(points, strokes[strokeNum], { ...options, leniency: (options.leniency || 1) * adj });
    return { isMatch: r.isMatch, backwards: r.backwards };
  }
  return { isMatch, backwards };
}

// ---- test helpers ----
export const toPts = (median) => median.map(([x, y]) => ({ x, y }));
export const jitter = (pts, amp, seed) => {
  let s = seed; const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2 * amp;
  return pts.map((p) => ({ x: p.x + r(), y: p.y + r() }));
};
export const resample = (pts, n) => {
  const out = []; const seg = pathLen(pts) / (n - 1); let acc = 0, i = 1, cur = pts[0];
  out.push(cur);
  while (out.length < n && i < pts.length) {
    const d = dist(cur, pts[i]);
    if (acc + d >= seg) { cur = extendOnLine(pts[i], cur, -(seg - acc)); out.push(cur); acc = 0; }
    else { acc += d; cur = pts[i]; i++; }
  }
  return out;
};
export const scaleFromCentroid = (pts, k) => { const cx = avg(pts.map((p) => p.x)), cy = avg(pts.map((p) => p.y)); return pts.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k })); };
export const loadChars = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
export const strokesFor = (charJson) => charJson.medians.map((m, i) => makeStroke(toPts(m), i));
