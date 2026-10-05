# hanzi-drill

Stroke-order writing practice + strict pinyin grading **inside AnkiDroid cards** — Pleco-style
handwriting feedback added to an existing note type, without changing how you make cards.

In review you **trace each character** on a canvas that rejects wrong strokes and wrong
stroke order in real time (vibrates + tells you), and **enter its pinyin** (keyboard or an
on-card syllable picker). The widget then grades the card for you: clean → Good, stroke
mistakes → Hard, skipped char or reading miss → Again.

> **Vibe-coded** by Qwen3.8 Flash Next (via Hermes); human-directed and human-tested,
> not human-reviewed. · Status **v0.5**, in daily use by the author.

## It's just card templates

There is no app, no phone-side install, nothing running in the background. The entire
feature is **HTML + JavaScript embedded in the note type's card templates** (plus CSS in
its Styling section). AnkiDroid renders cards in a web view, so that JavaScript runs at
review time. That's the whole mechanism — in principle you could paste it into Anki's
template editor by hand.

Why `install.py` exists instead: the block is ~80 KB (quiz engine + stroke data inlined),
it must go into *both* templates' fronts in an exact shape, and it must be *appended to* —
not replace — your existing template HTML. The script does the pasting over Anki's local
HTTP API, on desktop, once, with a backup taken first. Templates can only be edited on
Anki desktop anyway; sync then carries the widget to your phone like any other template
change, and every new note you create (by hand or LLM) inherits it automatically.
`build.py` goes further: it produces a demo deck (`hanzi-drill-proto.apkg`) whose own
note type already contains the widget — importable with zero scripts, if you want to try
it in a sandbox first.

## Adding it to your deck

1. **Anki desktop:** install
   [AnkiConnect](https://foosoft.net/projects/anki-connect/) (*Tools → Add-ons → Get
   Add-ons*, code `2055492159`), restart Anki. It's a plain HTTP API — no AI agent
   required. The [Anki MCP add-on](https://github.com/ankimcp/anki-mcp-server-addon)
   also works; the tools auto-detect either bridge.
2. **This folder** (Python 3 stdlib only — `pip install` nothing): edit
   `hanzi-drill.conf.json` to name your note type and fields, then
   `python install.py --dry` to preview and `python install.py` to apply. Your templates
   are snapshotted to `hd-backup-<model>.json` before the first patch touches them.
3. **Sync** Anki, pull on your phone/tablet, review any card of that note type — the
   drawing canvas is just there.
4. Undo: `python install.py --uninstall` (restores templates byte-for-byte), sync again.

Config keys:

```json
{
  "mcpUrl": "http://localhost:8765",
  "backend": null,
  "model": "Mandarin",
  "charsField": "Characters",
  "pinyinField": "Pinyin",
  "writingTemplate": null,
  "readingTemplate": null
}
```

`mcpUrl` points at whichever bridge you installed (`:8765` / `:3141`); `backend` may pin
`"ankiconnect"`/`"mcp"` or stay `null` to auto-probe. Your note type needs **two card
types**: one front showing the characters (reading card → *guided* quiz: outline visible)
and one hiding them (writing card → *free-recall* quiz). Which is which is auto-detected
from whether the front contains `{{charsField}}`; pin the names in config if it guesses
wrong. Pinyin may be tone-marked (`shāngdiàn`), numeric (`shang1 dian4`) or mixed;
syllables map to characters by position.

## How the review works

Widget code is inlined into **both fronts** (the answer side receives it through the
`{{FrontSide}}` echo; a hidden `#hd-dir` span stamps the card type; the quiz markup stays
`display:none` until the script boots, so an inert echo can never show dead input
fields).

Per character, two tasks run **in parallel** — nothing gates the canvas, because a dead
keyboard must never make a card undrawable:

* **Draw** — hanzi-writer quiz mode against Make Me A Hanzi medians. Strict matching
  (`leniency: 1`); wrong strokes are never auto-accepted — the only way past is to draw
  it correctly. After many misses (5 writing / 6 reading) the target stroke flashes as a
  last-resort hint. ▶ replay / "no idea" are hidden on the writing front (spoilers);
  the reading card keeps them, with a looser hint threshold (guided practice).
* **Pinyin** — text field graded live, or the 🔤 picker (tap initial / final / tone).
  The picker exists because AnkiDroid's stable reviewer can't raise a keyboard for card
  inputs (upstream bug #18063), so don't debug that. Grading is strict and tone-aware:
  `jiang` ✗ for `jiǎng`; `lv4`/`lü4` ✓ for `lǜ`; neutral tone accepts toneless or `5`;
  typing the actual hanzi is compared as the character. A wrong answer you later *fix*
  still counts as one reading miss (`shei2`→`shei4` grades Again).

Both done → next character (`next ▸` force-advances, hidden on single-char cards). The
verdict maps to Good/Hard/Again and is answered via the AnkiDroid JS API; if you flip
the card early it degrades to honest self-grading. The answer side shows a stroke-order
browse panel — one character at a time (◂ 1/n ▸) with ▶ replay; on reading backs it
auto-animates. Night mode is detected and themed inline (AnkiDroid gives the page no
dark-mode class).

Stroke data: inline subset → `localStorage` cache (`hd:<char>`) → CDN (cached on
success), so reviews work offline once a character has been seen; an unseen character
while offline degrades to "self-grade" instead of blocking. Data from
[hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) /
[Make Me A Hanzi](https://github.com/skishore/makemeahanzi) (Arphic-derived — see its
COPYING); the quiz engine is vendored
[hanzi-writer v3.7.3](https://github.com/chanind/hanzi-writer) (MIT).

## Files

```
media/hanzi-drill.js         the widget (~600 lines)
media/hanzi-writer.min.js    vendored quiz engine
media/hanzi-data.js          inline stroke data (offline bootstrap)
hanzi-drill.conf.json        your setup
hd_common.py                 shared: config, AnkiConnect/MCP bridge, template detection
install.py                   install / --dry / --uninstall / --backup
build.py                     demo deck (hanzi-drill-proto.apkg) with leak gates
rendercheck.py               renders a note through the live templates, asserts invariants
grader_test.js               61-case pinyin grader tests (node)
driver.py + test-page.html   browser rig: synthetic drawing, 12 flow modes
```

Ship a widget change: `node grader_test.js && python build.py && python install.py &&
python rendercheck.py`.

## Testing

Browser rig, no Anki needed: `python -m http.server 8781 --bind 127.0.0.1` (exactly one
server — see pitfalls), open `test-page.html` (`?dir=reading`, `?word=one`,
`?answering=1`, `?v=<bust>` — bump the bust after editing the widget), and run
`window.__RUN(mode)` with the driver block from `driver.py`:

| mode | proves |
|---|---|
| `mouse` / `touch` / `picker` | clean runs → `ease: 3`, 19/19 strokes on 商店 |
| `sloppy` | 14px-off strokes still pass (leniency floor) |
| `wrongorder` / `wrongpin` / `giveup` / `correct` | rejection + Hard/Again semantics |
| `reveal` | early flip → self-grade, never auto-grade |
| `staticback` / `backfresh` | answer-side renders (echo re-mount / fresh WebView) |
| `onechar` / `readbrowse` | single-char pager / reading quiz → auto-animated browse |

**Demo deck**: import `hanzi-drill-proto.apkg` to try everything in isolation. Never name
a test note type after yours — importing merges same-named note types and clobbers.
After installing, sync (File → Sync Now, or the bridge's `sync` action) and pull on the
phone. On the phone, Settings → Advanced → *"Type answer into the card"* additionally
helps the text field where honored; the picker works regardless.

## Pitfalls learned the hard way

* **Anki substitutes `{{mustaches}}` even inside `<script>`** — build/install assert no
  `{{` in the JS sources.
* **AnkiDroid runs inline scripts before the DOM settles** — the hidden field spans must
  precede the script tag ("no hanzi in card" otherwise).
* **Old reviewer doesn't re-run card JS on reveal and has no `#answer`** — detect flips
  by polling `api.isDisplayingAnswer()`.
* **hanzi-writer ignores synthetic `PointerEvent`s** — drivers dispatch real
  Mouse/TouchEvents.
* **Model-level sync is last-writer-wins**: anything that re-saves the note type (another
  machine's restyler, "Fix HTML") clobbers the widget block. Re-run `install.py` —
  idempotent, takes seconds.
* **`leniency` is a `create()` option** (ignored in `quiz()`); `showHintAfterMisses`
  only *flashes* a hint — keep its threshold high or it spoils free recall.
* **Android IME**: `preventDefault()` on `touchend` kills the keyboard; after drawing,
  wake it with `blur()` + `focus()`.
* **Night mode has no `.night_mode` class on AnkiDroid** — darkness is detected via
  background luminance and colors are inlined, scoped to `#hd-root`.
* **Windows double-binds HTTP ports** (SO_REUSEADDR): an orphaned `http.server` silently
  steals traffic — check `netstat -ano` before debugging a "broken" widget.
* **MCP `store_media_file` refuses `.js`** — hence inlining into templates.

## History

The stroke matcher was validated first as a dependency-free spike against real MMAH
medians: wrong order rejected 0/214 pairs, reversed strokes 32/32, correct strokes
survive ±18px finger jitter. Those numbers remain the acceptance bar for the planned
native Kotlin app (rsdroid + AnkiWeb sync, grader port, CEDICT tap-lookup; telemetry in
the card `data` field so it syncs for free). The deck hack came first because AnkiDroid
has no addon system — and it changed nothing about how cards are made, which is exactly
why it stuck.
