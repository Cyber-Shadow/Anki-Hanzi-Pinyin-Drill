"""Render a note through the LIVE patched templates (read out of the running collection
via the MCP) to verify widget placement + no answer leaks on the writing front.
Config-driven: note type, fields and template detection come from hanzi-drill.conf.json.
"""
import os, shutil, tempfile, re
import hd_common as hd

conf = hd.load_conf()
call = hd.make_call(conf["mcpUrl"])

tpl = call("model_templates", {"model_name": conf["model"]})["templates"]
sty = call("model_styling", {"model_name": conf["model"]})["css"]
clean = {n: {"Front": hd.strip_block(t["Front"], conf)[0]} for n, t in tpl.items()}
w_name, r_name = hd.detect_sides(clean, conf)
print("note type: %r | writing: %r | reading: %r" % (conf["model"], w_name, r_name))
F, R = tpl[w_name], tpl[r_name]

HANZI, PINYIN = "商店", "shāngdiàn"
tmp = tempfile.mkdtemp(prefix="hd-render-")
from anki.collection import Collection
from anki.notes import Note
col = Collection(os.path.join(tmp, "c"))
m = col.models.new(conf["model"])
field_names = set()
for t in tpl.values():  # reconstruct field list from mustaches in the live templates
    for mm in re.finditer(r"\{\{[#/]?(?!Typed|FrontSide|Text|Media|Tags)([A-Za-z][^{}]*?)\}\}",
                          t.get("Front", "") + t.get("Back", "")):
        field_names.add(mm.group(1))
field_names |= {conf["charsField"], conf["pinyinField"]}
for n in sorted(field_names):
    col.models.add_field(m, col.models.new_field(n))
tw = col.models.new_template("W")
tw["qfmt"], tw["afmt"], tw["ord"] = F["Front"], F["Back"], 0
col.models.add_template(m, tw)
tr = col.models.new_template("R")
tr["qfmt"], tr["afmt"], tr["ord"] = R["Front"], R["Back"], 1
col.models.add_template(m, tr)
m["css"] = sty
col.models.add(m)

vals = {n: "" for n in field_names}
vals[conf["charsField"]] = HANZI
vals[conf["pinyinField"]] = PINYIN
for n, v in (("English", "shop, store"), ("Example", "商店开门了吗？"),
             ("Example EN", "Is the shop open?"), ("POS", "noun"),
             ("Cantonese", "soeng1 din6")):
    if n in field_names: vals[n] = v
note = Note(col, m)
for i, f in enumerate(x["name"] for x in m["flds"]):
    note[f] = vals.get(f, "")
col.add_note(note, col.decks.id("hanzi-drill-rendercheck"))
c0, c1 = sorted(note.cards(), key=lambda c: c.ord)
q0, a0 = c0.question(), c0.answer()
q1, a1 = c1.question(), c1.answer()
col.close()
shutil.rmtree(tmp, ignore_errors=True)

def visible(html):  # strip JS comments — pinyin-like example text in comments isn't a leak
    html = re.sub(r"/\*[\s\S]*?\*/", "", html)
    return re.sub(r"(?<![:\w])//[^\n]*", "", html)

def chk(cond, msg):
    print(("✓ " if cond else "✗ FAIL ") + msg)
    return bool(cond)

ok = True
ok &= chk(q0.count("id='hd-canvas'") == 1, "writing front: exactly one quiz canvas")
ok &= chk("<script>" in q0 and q0.find("id='hd-hanzi'") < q0.rfind("<script>"),
          "writing front: hidden spans before script")
ok &= chk(q0.count(HANZI) == 1, "writing front: characters appear once (hidden span only)")
ok &= chk(visible(q0).count(PINYIN) == 1, "writing front: pinyin only in hidden span")
if vals.get("Example"):
    ok &= chk(vals["Example"] not in q0, "writing front: no example leak")
ok &= chk(q0.count("<script>") == 1, "writing front: single script block")
ok &= chk(a0.count("id='hd-canvas'") == 1, "writing back (FrontSide echo): canvas appears once")
ok &= chk(a0.count("hanzi-drill error: ") <= 1, "no fired error string in rendered HTML")
script_region = q0[q0.rfind("<script>"):]
ok &= chk(not re.search(r"\{\{[^}]+\}\}", script_region), "no unsubstituted mustaches inside script")
ok &= chk(q1.count(HANZI) >= 1 and q1.count("id='hd-canvas'") == 1,
          "reading front: chars shown AND guided quiz canvas present once")
ok &= chk(a1.count("id='hd-canvas'") == 1, "reading back (FrontSide echo): canvas appears once")
print("ALL OK" if ok else "FAILURES PRESENT")
raise SystemExit(0 if ok else 1)
