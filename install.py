"""Install (or uninstall) hanzi-drill into ANY Anki note type via the local Anki MCP.

Configuration: hanzi-drill.conf.json next to this file (see hd_common.py / the README);
every key has a default and template names are auto-detected when unset.

  python install.py             install; on already-patched sides, replaces the widget block
  python install.py --dry       print planned changes only
  python install.py --uninstall remove widget blocks + CSS
  python install.py --backup    snapshot current templates+CSS to hd-backup-<model>.json, exit

A pre-install snapshot is written automatically before the first patch touches a model.
NOTE (AnkiConnect/MCP patch mode): old_str must be the EXACT CURRENT side — a stripped
version is a substring of it, which replaces the prefix and DUPLICATES the block.
"""
import json, os, sys
import hd_common as hd

DRY = "--dry" in sys.argv
UNINSTALL = "--uninstall" in sys.argv
BACKUP_ONLY = "--backup" in sys.argv

conf = hd.load_conf()
call = hd.make_call(conf["mcpUrl"], conf.get("backend"))
B = hd.blocks(conf)

tpl = call("model_templates", {"model_name": conf["model"]})["templates"]
sty = call("model_styling", {"model_name": conf["model"]})

def snapshot():
    p = os.path.join(hd.HERE, "hd-backup-%s.json" % conf["model"].replace(" ", "_"))
    json.dump({"templates": tpl, "styling": sty}, open(p, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("snapshot written:", p)
    return p

if BACKUP_ONLY:
    snapshot()
    sys.exit(0)

# Detect card types from CLEANED fronts: an installed block carries the chars-field
# mustache in a hidden span, which would make a writing front look like a reading one.
clean = {n: {"Front": hd.strip_block(t["Front"], conf)[0]} for n, t in tpl.items()}
w_name, r_name = hd.detect_sides(clean, conf)
print("note type: %r | writing card: %r | reading card: %r" % (conf["model"], w_name, r_name))

def patch_side(tname, side, new_str, note):
    if not DRY:
        call("update_model_templates", {"model_name": conf["model"],
            "template_name": tname, "side": side,
            "old_str": tpl[tname][side], "new_str": new_str})
    print(("DRY: would " if DRY else "") + "%s %s %s (%d chars)%s" %
          (tname, side, note, len(new_str), "" if DRY else " ✓"))

if UNINSTALL:
    # r_name/Back = legacy location (widget used to live on the reading BACK)
    for tname, side in ((w_name, "Front"), (r_name, "Front"), (r_name, "Back")):
        base, found = hd.strip_block(tpl[tname][side], conf)
        if not found:
            print("%s %s: nothing installed" % (tname, side))
            continue
        patch_side(tname, side, base.rstrip() + "\n", "widget removed")
    j = sty["css"].find(hd.CSS_MARK)
    if j == -1:
        print("CSS: nothing installed")
    else:
        if DRY:
            print("DRY: would remove CSS block")
        else:
            call("update_model_styling", {"model_name": conf["model"],
                "old_str": sty["css"], "new_str": sty["css"][:j].rstrip() + "\n"})
            print("CSS removed ✓")
    sys.exit(0)

# ---- install / update ----
installed = "id='hd-canvas'" in tpl[w_name]["Front"] or "id='hd-canvas'" in tpl[r_name]["Front"]
if not DRY and not installed:  # first-ever patch: capture pristine state
    snapshot()

# Quiz lives on BOTH fronts (writing: free-recall, no spoilers; reading: guided —
# visible outline + picker). Backs pick the widget up via the {{FrontSide}} echo.
# remove any legacy widget from the reading BACK (it moved to the FRONT)
rb_clean, had_rb = hd.strip_block(tpl[r_name]["Back"], conf)
if had_rb and not DRY:
    call("update_model_templates", {"model_name": conf["model"], "template_name": r_name,
        "side": "Back", "old_str": tpl[r_name]["Back"], "new_str": rb_clean.rstrip() + "\n"})
    print("%s Back legacy widget removed ✓" % r_name)
for tname, side, dir_tag, loader in ((w_name, "Front", B["dir_w"], ""),
                                     (r_name, "Front", B["dir_r"], B["loader"])):
    cur = tpl[tname][side]
    note = "widget updated" if "id='hd-canvas'" in cur else "widget installed"
    if "id='hd-canvas'" in cur:            # marked or legacy block — strip, then re-append
        cur, _ = hd.strip_block(cur, conf)
    new = cur + B["cond_open"] + loader + B["quiz"] + dir_tag + B["boot"] + B["cond_close"]
    patch_side(tname, side, new, note)

j = sty["css"].find(hd.CSS_MARK)
css_new = (sty["css"][:j] if j != -1 else sty["css"]).rstrip() + "\n" + B["css"]
if DRY:
    print("DRY: would %s CSS" % ("update" if j != -1 else "append"))
else:
    call("update_model_styling", {"model_name": conf["model"],
        "old_str": sty["css"], "new_str": css_new})
    print("CSS %s ✓" % ("updated" if j != -1 else "added"))

print("done — sync Anki (or the MCP 'sync' action) and pull on your devices.")
