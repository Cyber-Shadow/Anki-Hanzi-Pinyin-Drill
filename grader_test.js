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
  
function check(wantS, v) {
  var w = syllabify(wantS)[0] || {syl:'?',tone:0};
  var g = syllabify(v);
  if (!g.length) return false;
  var wt = w.tone, gt = g[0].tone;
  if (!gt && /[1-5]/.test(v)) gt = 5;
  var toneOk = wt ? gt === wt : (gt === 0 || gt === 5);
  return g[0].syl === w.syl && toneOk;
}
const cases = [
 ['jiǎng','jiang',false], ['jiǎng','jiang3',true], ['jiǎng','Jiang3',true], ['jiǎng','jiǎng',true],
 ['jiǎng','jiang1',false], ['jiǎng','jiang5',false], ['jiǎng','jiang2',false],
 ['de','de',true], ['de','de5',true], ['de','dé',false], ['de','de1',false],
 ['shāng','shang1',true], ['shāng','shang',false], ['shāng','shāng',true],
 ['hǎo','hao3',true], ['hǎo','hao',false], ['hǎo','hǎo',true],
 ['lái','lai2',true], ['lái','lái',true], ['zǒu','zou3',true], ['gōu','gou1',true],
 ['nǚ','nv3',true], ['nǚ','nü3',true], ['nǚ','nu3',false],
 ['lǜ','lv4',true], ['lǜ','lü4',true], ['lǜ','lu4',false], ['lǜ','lǜ',true],
 ['zhōng','zhong1',true], ['zhōng','zong1',false], ['zhōng','zhōng',true],
 ['ér','er2',true], ['ér','er',false], ['ér','ěr',false],
 ['shénme','shen2 me',true], ['shénme','shénme',true], ['shénme','shen2',true],
 ['jiāng','jiang',false], ['jiāng','jiang1',true], ['jiāng','jiang2',false], ['xiě','xie3',true],
 ['nǐ','ni3',true], ['hào','hao4',true], ['hěnnǐ','hen3nǐ',true], ['hěnnǐ','hen2',false],
 ['huār','hua1r',true], ['huār','huar1',true], ['huār','hua1',false],
 ['niǔ','niu3',true], ['kuài','kuai4',true], ['zuān','zuan1',true],
 ['shāngdiàn','shāngdiàn',true], ['shāngdiàn','shang1 dian4',true], ['shāngdiàn','shang1 dian',true],
 ['dǎ','da3',true], ['māma','ma1ma',true], ['māma','ma1 ma5',true], ['māma','ma2',false],
 ['hǎo','hao5',false], ['xiāngjiāo','xiang1jiao1',true], ['qún','qun2',true],
];
let bad = 0;
for (const [w,g,exp] of cases) { const got = check(w,g); if (got !== exp) { bad++; console.log('FAIL', w, '/', g, 'expected', exp, 'got', got); } }
console.log(bad ? bad + ' FAILURES of ' + cases.length : 'ALL ' + cases.length + ' grader cases pass');
