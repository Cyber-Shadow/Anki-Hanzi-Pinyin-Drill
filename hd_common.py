"""hanzi-drill shared install logic — config loading, MCP calls, template detection,
and the widget blocks. Used by install.py and rendercheck.py.

Config (hanzi-drill.conf.json next to this file, all keys optional):
  {
    "mcpUrl":        "http://127.0.0.1:3141/",   # Anki MCP / AnkiConnect bridge
    "model":         "Mandarin",                 # note type to patch
    "charsField":    "Characters",               # field holding the hanzi
    "pinyinField":   "Pinyin",                   # field holding per-char pinyin (space or concatenated)
    "writingTemplate": null,                     # template names; null = auto-detect
    "readingTemplate": null
  }
Auto-detection: the template whose FRONT shows the chars field is the 'reading' card
(chars -> meaning; its quiz goes on the BACK); the one whose front does NOT is the
'writing' card (meaning -> chars; its quiz goes on the FRONT, before the reveal).
"""
import json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULTS = {
    "mcpUrl": "http://127.0.0.1:3141/",
    "model": "Mandarin",
    "charsField": "Characters",
    "pinyinField": "Pinyin",
    "writingTemplate": None,
    "readingTemplate": None,
}

def load_conf():
    conf = dict(DEFAULTS)
    p = os.path.join(HERE, "hanzi-drill.conf.json")
    if os.path.exists(p):
        conf.update(json.load(open(p, encoding="utf-8")))
    return conf

_reqid = [0]
def make_call(url):
    HDR = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    def call(name, args=None):
        _reqid[0] += 1
        body = {"jsonrpc": "2.0", "id": _reqid[0], "method": "tools/call",
                "params": {"name": name, "arguments": args or {}}}
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=HDR)
        out = urllib.request.urlopen(req, timeout=120).read().decode(errors="replace")
        for line in out.splitlines():
            if line.startswith("data: "):
                d = json.loads(line[6:])
                if "error" in d: raise RuntimeError(d["error"])
                t = d["result"]["content"][0]["text"]
                if d["result"].get("isError"): raise RuntimeError(t)
                try: return json.loads(t)
                except json.JSONDecodeError: return t
        raise RuntimeError("no data frame: " + out[:200])
    return call

MARKER = "<!-- hanzi-drill -->"
CSS_MARK = "/* hanzi-drill */"

def blocks(conf, media_dir=None):
    media_dir = media_dir or os.path.join(HERE, "media")
    hw = open(os.path.join(media_dir, "hanzi-writer.min.js"), encoding="utf-8").read()
    dr = open(os.path.join(media_dir, "hanzi-drill.js"), encoding="utf-8").read()
    da = open(os.path.join(media_dir, "hanzi-data.js"), encoding="utf-8").read()
    for nm, s in (("hanzi-writer", hw), ("hanzi-drill", dr), ("hanzi-data", da)):
        assert "</script" not in s.lower(), "%s contains a closing script tag" % nm
        assert "{{" not in s, "%s contains field mustaches — Anki substitutes them even inside <script>" % nm
    loader = ("<script src='https://cdn.jsdelivr.net/npm/hanzi-writer@3/dist/"
              "hanzi-writer.min.js'></script>")
    boot = ("<script>" + hw + da
            + "try{" + dr + "}catch(e){var s=document.getElementById('hd-status');"
            "if(s){s.textContent='hanzi-drill error: '+e.message;s.className='hd-status bad';}}</script>")
    # display:none by default: if this markup is echoed into the answer side WITHOUT its
    # scripts running (AnkiDroid old-reviewer injects answer HTML without executing
    # <script>), the dead quiz UI must not appear — only mount() reveals it.
    quiz = """
<div id='hd-root' style='display:none'>
<div class='hd-canvas' id='hd-canvas'></div>
<div class='hd-status' id='hd-status'></div>
<div class='hd-pinrow'>
  <span class='hd-lbl' id='hd-pinhint'>pinyin:</span>
  <input class='hd-pin' id='hd-pin' placeholder='type pinyin' autocorrect='off' autocapitalize='none' autocomplete='off' spellcheck='false' enterkeyhint='done'>
  <button id='hd-pinnext'>next &#9656;</button>
</div>
<div class='hd-pinfb' id='hd-pinfb'></div>
<div class='hd-picker'>
  <button id='hd-pickbtn'>&#128288; syllables</button><span id='hd-pickprev'></span>
  <div id='hd-pickerbox' style='display:none'>
    <div class='hd-chips' id='hd-initials'></div>
    <div class='hd-chips' id='hd-finals'></div>
    <div class='hd-chips' id='hd-tones'></div>
    <div class='hd-chips'><button id='hd-pickclear'>clear</button><button id='hd-pickok'>&#10003; use this</button></div>
  </div>
</div>
<div class='hd-btns'>
  <button id='hd-replay'>&#9654; stroke order</button>
  <button id='hd-giveup'>no idea</button>
  <button id='hd-check'>&#10003; grade</button>
</div>
<span class='hd-hidden' id='hd-hanzi'>{{%s}}</span>
<span class='hd-hidden' id='hd-want-pin'>{{%s}}</span>
</div>
""" % (conf["charsField"], conf["pinyinField"])
    cond_open = MARKER + "\n{{#" + conf["charsField"] + "}}\n"   # always truthy at render;
    cond_close = "\n{{/" + conf["charsField"] + "}}\n"          # shields script from Fix HTML
    return {"hw": hw, "dr": dr, "da": da, "loader": loader, "boot": boot,
            "quiz": quiz, "cond_open": cond_open, "cond_close": cond_close,
            "dir_w": "<span class='hd-hidden' id='hd-dir'>writing</span>",
            "dir_r": "<span class='hd-hidden' id='hd-dir'>reading</span>",
            "css": """
%s
.hd-hidden{display:none}
.hd-canvas{width:260px;height:260px;margin:6px auto;border:1px solid #bbb;border-radius:8px;
  touch-action:none;background:#fff}
.hd-status{min-height:1.4em;text-align:center;font-weight:600}
.hd-status.ok{color:#16a34a}.hd-status.bad{color:#dc2626}.hd-status.warn{color:#d97706}
.hd-pinrow{display:flex;gap:6px;align-items:center;justify-content:center;margin:4px 10px}
.hd-pin{width:120px;flex:0 0 auto;font-size:1.1em;padding:4px 8px;text-align:center;
  background:#fff;color:#111;border:1px solid #999}
.hd-pinrow button{padding:8px 10px}
.hd-pinfb{text-align:center;min-height:1.3em;color:#555}
.hd-picker{text-align:center;margin:4px 0}
.hd-picker button{margin:0 4px;padding:8px 12px;font-size:1em}
#hd-pickprev{font-weight:600;margin-left:6px}
.hd-chips{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin:7px auto;padding:6px 8px;max-width:300px;border:1px solid #9994;border-radius:8px}
.hd-chips button{padding:7px 9px;font-size:.95em;min-width:34px}
.hd-chips button.sel{background:#3b82f6;color:#fff;border-color:#3b82f6}
.hd-btns{text-align:center;margin:6px 0}
.hd-btns button{margin:0 4px;padding:8px 12px;font-size:1em}
/* AnkiDroid night mode: WebView paints unstyled buttons/cards dark-on-dark and inputs
   white-on-black invisible — force explicit colours on every interactive element. */
.night_mode .hd-box button{background:#2a2a2a;color:#e5e5e5;border:1px solid #555}
.night_mode .hd-chips button.sel,.night_mode .hd-btns button.sel{background:#3b82f6;color:#fff}
.night_mode .hd-canvas{background:#1e1e1e;border-color:#555}
.night_mode .hd-pin{background:#111;color:#eee;border:1px solid #555}
.night_mode .hd-pinfb{color:#aaa}
.night_mode .hd-picker{color:#ccc}
/* AnkiDroid's reviewer strips <style> blocks from the QUESTION HTML, so night colours
   must also be applied inline by the widget when the page is dark (see applyNight). */
""" % CSS_MARK}

def detect_sides(tpl, conf):
    """-> (writing_name, reading_name) from a {name: {Front, Back}} dict."""
    if conf["writingTemplate"] and conf["readingTemplate"]:
        for n in (conf["writingTemplate"], conf["readingTemplate"]):
            if n not in tpl:
                raise RuntimeError("template %r not in model; available: %s" % (n, list(tpl)))
        return conf["writingTemplate"], conf["readingTemplate"]
    tag = "{{" + conf["charsField"] + "}}"
    reading = [n for n, t in tpl.items() if tag in t.get("Front", "")]
    writing = [n for n, t in tpl.items() if tag not in t.get("Front", "")]
    # a template whose front echoes FrontSide is ambiguous — treat first-listed as reading
    if conf["readingTemplate"]: reading = [conf["readingTemplate"]]
    if conf["writingTemplate"]: writing = [conf["writingTemplate"]]
    if not reading or not writing:
        raise RuntimeError(
            "could not auto-detect card types (reading fronts containing %r: %s; others: %s). "
            "Set writingTemplate/readingTemplate in hanzi-drill.conf.json. The widget needs one "
            "card type whose front shows the characters and one whose front hides them."
            % (tag, reading, writing))
    return writing[0], reading[0]

def strip_block(side, conf):
    """Remove a widget block appended by a previous run. Returns (clean_side, found).
    Prefers our MARKER comment; falls back to the conditional opener (blocks installed
    before markers existed)."""
    i = side.find(MARKER)
    if i == -1:
        i = side.find("{{#" + conf["charsField"] + "}}")
    return (side[:i] if i != -1 else side, i != -1)
