# Builds hanzi-drill-proto.apkg: one note type, one card (the 商店 test card),
# stroke quiz on the answer side. Run: python build.py   (pip install anki)
import json, os, urllib.request, urllib.parse, zipfile
from anki.collection import Collection, ExportAnkiPackageOptions, DeckIdLimit

HERE = os.path.dirname(os.path.abspath(__file__))
COLL = os.path.join(HERE, "build", "coll.anki2")
os.makedirs(os.path.dirname(COLL), exist_ok=True)
if os.path.exists(COLL):
    os.remove(COLL)
col = Collection(COLL)

# --- stroke data for every char that appears in the prototype cards ---
chars = "商店门开吗"
data = {}
for ch in chars:
    url = f"https://cdn.jsdelivr.net/gh/chanind/hanzi-writer-data@master/data/{urllib.parse.quote(ch)}.json"
    data[ch] = json.loads(urllib.request.urlopen(url, timeout=60).read())
with open(os.path.join(HERE, "media", "hanzi-data.js"), "w", encoding="utf-8") as f:
    f.write("window.HD_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";")
print("stroke data:", {c: len(d["strokes"]) for c, d in data.items()})

# --- JS payloads (inlined into the template; no media files needed) ---
import json
data_js = "window.HD_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
INLINE = (
    open(os.path.join(HERE, "media", "hanzi-writer.min.js"), encoding="utf-8").read().rstrip()
    + "\n;" + data_js
    + "\n;" + open(os.path.join(HERE, "media", "hanzi-drill.js"), encoding="utf-8").read().rstrip()
    + "\n"
)
assert "</script" not in INLINE.lower(), "cannot inline: contains closing script tag"
assert "{{" not in INLINE, "widget JS contains field mustaches — Anki substitutes them even inside <script>"
# JS syntax gate: a SyntaxError would ship silently and kill the widget on-device
import shutil, subprocess
if shutil.which("node"):
    nodecheck = subprocess.run(
        ["node", "-e", "new Function(require('fs').readFileSync(process.argv[1],'utf8'))",
         os.path.join(HERE, "media", "hanzi-drill.js")], capture_output=True, text=True)
    assert nodecheck.returncode == 0, "hanzi-drill.js syntax error:\n" + nodecheck.stderr[-600:]
    print("widget JS syntax ✓ (node)")
else:
    print("WARNING: node not found — skipping JS syntax gate")

# quiz markup / data spans / widget CSS come from hd_common — single source shared with
# install.py, so the demo deck can never drift from what gets installed into real models.
import hd_common as hd
conf0 = hd.load_conf()
B = hd.blocks(conf0)

# --- note type: same field schema as the user's "Mandarin" note type (AI card workflow).
# Named "hanzi-drill" deliberately: importing a type named "Mandarin" would MERGE into the
# real one and the card would render with the stock templates (no widget). ---
model = col.models.new("hanzi-drill")
for fld in ("Characters", "Pinyin", "Cantonese", "English", "POS", "Example",
            "Example Pinyin", "Example EN", "Cantonese Note", "Review Note"):
    col.models.add_field(model, col.models.new_field(fld))

model["css"] = """
.hd-box{font-family:sans-serif;max-width:340px;margin:8px auto}
.hd-row{display:flex;gap:8px;margin:3px 0;align-items:baseline}
.hd-lbl{color:#888;font-size:.7em;text-transform:uppercase;letter-spacing:.04em;min-width:74px;flex-shrink:0}
.hd-val{font-size:1em}
.hd-val.big{font-size:1.7em;font-weight:600}
.hd-cjk{font-size:1.6em}
.hd-cnote{background:#3a3116;border-left:3px solid #d97706;padding:4px 8px;margin:6px 0;font-size:.9em}
""" + B["css"]
# WIDGET (from hd_common) already ends with the hidden hd-hanzi / hd-want-pin spans.
WIDGET, HIDDEN = B["quiz"], ""
DIR_W, DIR_R = B["dir_w"], B["dir_r"]

W_PROMPT = """
<div class='hd-row'><span class='hd-lbl'>English</span><span class='hd-val big'>{{English}} <span style='color:#888;font-size:.7em'>({{POS}})</span></span></div>
"""

INFO = """
<div class='hd-row'><span class='hd-lbl'>Characters</span><span class='hd-val big'>{{Characters}}</span></div>
<div class='hd-row'><span class='hd-lbl'>Pinyin</span><span class='hd-val'>{{Pinyin}}</span></div>
<div class='hd-row'><span class='hd-lbl'>Cantonese</span><span class='hd-val'>{{Cantonese}}</span></div>
<div class='hd-row'><span class='hd-lbl'>English</span><span class='hd-val'>{{English}} <span style='color:#888'>({{POS}})</span></span></div>
{{#Example}}<div class='hd-row'><span class='hd-lbl'>Example</span><span class='hd-val'>{{Example}}</span></div>{{/Example}}
{{#Example Pinyin}}<div class='hd-row'><span class='hd-lbl'>Ex. pinyin</span><span class='hd-val'>{{Example Pinyin}}</span></div>{{/Example Pinyin}}
{{#Example EN}}<div class='hd-row'><span class='hd-lbl'>Ex. english</span><span class='hd-val'>{{Example EN}}</span></div>{{/Example EN}}
{{#Cantonese Note}}<div class='hd-cnote'>{{Cantonese Note}}</div>{{/Cantonese Note}}
{{#Review Note}}<div class='hd-row'><span class='hd-lbl'>Review</span><span class='hd-val'>{{Review Note}}</span></div>{{/Review Note}}
"""

SCRIPT = "<script>__HD_JS__</script>"

# card 1 = writing direction: English(+POS) only (no example — it gives away the
# characters); the quiz lives on the FRONT so the attempt happens before the reveal.
FRONT_W = "<div class='hd-box'>" + W_PROMPT + WIDGET + HIDDEN + DIR_W + SCRIPT + "</div>"
BACK_W = "<div class='hd-box' id='hd-info'>" + INFO + "</div>"

# card 2 = reading direction: characters -> everything. Guided quiz lives on the FRONT
# (chars already visible; outline guide + picker); reveal flips it to stroke-order browse.
FRONT_R = ("<div class='hd-box'>"
           + "<div class='hd-row'><span class='hd-lbl'>Characters</span>"
           + "<span class='hd-val big'>{{Characters}}</span></div>"
           + WIDGET + DIR_R + SCRIPT + "</div>")
BACK_R = "<div class='hd-box' id='hd-info'>" + INFO + "</div>"

tpl_w = col.models.new_template("Writing")
tpl_w["qfmt"] = FRONT_W.replace("__HD_JS__", INLINE)
tpl_w["afmt"] = BACK_W.replace("__HD_JS__", INLINE)
tpl_w["ord"] = 0
col.models.add_template(model, tpl_w)
tpl_r = col.models.new_template("Reading")
tpl_r["qfmt"] = FRONT_R.replace("__HD_JS__", INLINE)
tpl_r["afmt"] = BACK_R.replace("__HD_JS__", INLINE)
tpl_r["ord"] = 1
col.models.add_template(model, tpl_r)
col.models.add(model)

# --- the test note ---
from anki.notes import Note
note = Note(col, model)
note.fields = ["商店", "shāngdiàn", "soeng1 din6", "shop, store", "noun",
               "商店开门了吗？", "shāngdiàn kāimén le ma?", "Is the shop open?",
               "", ""]
note.tags = ["hsk2", "word", "noun"]
did = col.decks.id("hanzi-drill-proto")
col.add_note(note, did)

# --- sanity: render BOTH cards' answer sides from the collection itself ---
cards = col.get_note(note.id).cards()
assert len(cards) == 2, f"expected 2 cards, got {len(cards)}"
for c in cards:
    q, a = c.question(), c.answer()
    widget_side, info_side = q, a  # both directions: quiz on the front now
    assert "__HD_JS__" not in q and "__HD_JS__" not in a, "unreplaced placeholder"
    assert all(s in widget_side for s in ("HD_DATA", "HanziWriter", "id='hd-canvas'")), f"card {c.ord} widget missing"
    assert all(s in info_side for s in ("商店", "shāngdiàn", "soeng1 din6", "shop, store")), f"card {c.ord} info missing"
    # inline script must come AFTER the hidden field spans or init runs too early
    i_span, i_scr = widget_side.find("id='hd-hanzi'"), widget_side.rfind("<script>")
    assert i_span != -1 and i_scr != -1 and i_span < i_scr, f"card {c.ord}: script before spans"
    for label in ("Pinyin", "Cantonese", "English"):
        assert f"hd-lbl'>{label}" in info_side, f"card {c.ord} missing label {label}"
    if c.ord == 0:  # writing card: quiz on FRONT, no spoilers on front, no second init
        assert "shop, store" in q, "writing front missing English prompt"
        assert "商店开门" not in q and "Is the shop open" not in q, "example leaks on writing front"
        assert q.count("商店") == 1, "characters leak on writing front (only hidden span allowed)"
        assert "id='hd-canvas'" not in a and "<script>" not in a, "answer must not re-init the widget"
        assert "id='hd-info'" in a and "id='hd-info'" not in q, "reveal marker wrong"
    else:
        assert "商店" in q and q.count("商店") == 2, "reading front should show chars + hidden span"
    print(f"card ord {c.ord} ({'writing' if c.ord==0 else 'reading'}) ✓ widget on FRONT")

out = os.path.join(HERE, "hanzi-drill-proto.apkg")
if os.path.exists(out):
    os.remove(out)
col.export_anki_package(
    out_path=out,
    options=ExportAnkiPackageOptions(with_scheduling=True, with_media=False),
    limit=DeckIdLimit(deck_id=did),
)
import io
import zstandard as zstd
with zipfile.ZipFile(out) as z:
    blob = b""
    for name in z.namelist():
        data_ = z.read(name)
        try:
            data_ = zstd.ZstdDecompressor().decompress(data_, max_output_size=200_000_000)
        except Exception:
            pass
        blob += data_
    for want in ("HD_DATA", "HanziWriter"):
        assert want.encode() in blob, f"{want} missing from exported apkg"
print("apkg contains widget + stroke data ✓")
print("wrote", out, os.path.getsize(out), "bytes")
col.close()
