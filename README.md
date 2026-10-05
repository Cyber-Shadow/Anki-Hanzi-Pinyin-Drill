# hanzi-drill

Stroke-order writing practice + pinyin grading **inside AnkiDroid cards** — Anki's SRS
with Pleco/Skritter-style handwriting feedback, added to an existing note type without
changing how cards are made. Works with any AnkiDroid version (its on-card syllable picker
sidesteps the reviewer's known keyboard bug) and any note type that has a characters field
and a pinyin field.

You review a card by **drawing each character** on a quiz canvas that rejects wrong
strokes and wrong stroke order in real time (vibrates + tells you), and by **entering
each character's pinyin** (keyboard or an on-card syllable picker). At the end the widget
grades the card automatically: clean → Good, stroke mistakes → Hard, skipped char or
reading miss → Again.

> **Vibe-coded** by Qwen3.8 Flash Next (via Hermes); human-directed and human-tested,
> not human-reviewed.

Status: **v0.5** — installed in the author's `Mandarin` note type (both card types),
driven by this repo's widget source. Long-term plan (not started): a standalone Kotlin
app with a native port of the grader (its stroke matcher was validated against real
Make Me A Hanzi medians in an earlier spike — 100% pass on clean strokes, 0% on
wrong-order strokes).

---

## In plain English

**What it is.** Anki normally asks "did you get it right?" and you answer with a button.
hanzi-drill adds a third way: it makes your existing cards *interactive*. A small program
("widget") gets embedded into your note type's card templates, so when a card opens,
instead of just reading it, you **trace each character stroke-by-stroke on the screen**
and **type (or tap) its pinyin**. The program knows the correct stroke order for thousands
of characters, so it can tell — as you draw — whether that stroke was the right one in the
right place at the right time, and it beeps/vibrates when you go wrong. When you're done
(or flip the card), it tells Anki how you did (Good / Hard / Again), so your review
schedule stays honest without you having to self-grade.

**Where the pieces live.** Nothing is installed on your phone and no app is modified. The
quiz code is pasted into the *card templates* themselves (a template is the HTML skeleton
every card of a note type is built from). AnkiDroid renders cards in a web view, so
JavaScript inside a template runs at review time — that's the whole trick. Stroke-shape
data downloads once per character and is cached on the device, so reviews work offline
afterwards.

**Why a PC script is involved.** Card templates can only be edited on Anki desktop, and
pasting ~80 KB of code into them by hand is miserable. `install.py` is a throwaway helper:
it talks to your running Anki over a local HTTP API, appends the widget to your templates,
and takes a backup of the originals first. You run it once, on the PC. After that it can
be forgotten — new cards you make (by hand or by LLM) inherit the widget automatically,
and syncing pushes it to your phone like any other template change. `--uninstall` puts
everything back exactly as it was.

## Adding it to your deck (the short version)

1. **PC, once:** install the AnkiConnect add-on in Anki desktop (Tools → Add-ons → Get
   Add-ons → code `2055492159`), restart Anki.
2. **PC, once:** in this folder, `pip install` nothing (pure stdlib), edit
   `hanzi-drill.conf.json` to name your note type and its characters/pinyin fields, then
   run `python install.py --dry` (preview) and `python install.py`.
3. **Sync** Anki, pull on your phone/tablet, review any card from that note type —
   the drawing canvas is just there.
4. To undo any of it: `python install.py --uninstall`, sync again.

The detailed version, including auto-detection rules and what to do when it guesses
wrong, is under "Getting started" below.

---

## Contents

```
media/hanzi-drill.js         THE WIDGET (~600 lines, no deps beyond hanzi-writer)
media/hanzi-writer.min.js    vendored hanzi-writer 3.x (quiz engine)
media/hanzi-data.js          inline stroke data for common chars (offline bootstrap)
hanzi-drill.conf.json        YOUR setup: note type, field names, MCP url (see below)
hd_common.py                 shared config/MCP/detection logic + widget/CSS blocks
install.py                   install/update/uninstall into ANY note type via Anki MCP
build.py                     builds hanzi-drill-proto.apkg (self-contained demo deck)
rendercheck.py               renders a note through the LIVE patched templates, asserts invariants
grader_test.js               61-case unit harness for the pinyin parser/grader (node, exit 0 = pass)
driver.py + test-page.html   browser test rig: synthetic stroke drawing, 12 flow modes
```
Generated artifacts you can delete/regenerate (git-ignored): `hanzi-drill-proto.apkg`,
`hd-backup-<model>.json` (pre-install template snapshot), `mandarin-backup.json`.

## Getting started

1. **Prereqs** — Anki desktop with
   [AnkiConnect](https://foosoft.net/projects/anki-connect/) (code `2055492159` in
   *Tools → Get Add-ons*, default `http://localhost:8765` — the plain HTTP API, no AI
   agent needed) **or** the
   [Anki MCP server add-on](https://github.com/ankimcp/anki-mcp-server-addon)
   (streamable-HTTP MCP bridge, `http://127.0.0.1:3141/`), Python 3, Node.js. On the
   phone: AnkiDroid + the same collection via AnkiWeb.
2. **Configure** — edit `hanzi-drill.conf.json`:

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

   `mcpUrl` points at whichever bridge you installed (AnkiConnect `:8765` or the MCP
   server `:3141`); `backend` may be `"ankiconnect"` / `"mcp"` or `null` to auto-probe
   (recommended — the probe distinguishes the two). Both paths were round-trip tested.

   `model` is your note type; `charsField`/`pinyinField` are the fields holding the
   characters and their pinyin. The widget needs a note type with **two card types**:
   one whose front shows the characters (reading card: guided quiz on its front) and
   one whose front hides them (writing card: free-recall quiz on its front). Templates
   are auto-detected by which front contains `{{charsField}}`; pin them with
   `writingTemplate`/`readingTemplate` if auto-detection guesses wrong. Pinyin may be
   tone-marked (`shāngdiàn`), numeric (`shang1 dian4`) or mixed — spaces optional;
   syllables are matched to characters by position.
3. **Install** — `python install.py --dry` to preview, then
   `python install.py`. Your original templates are snapshotted first
   (`hd-backup-<model>.json`). Sync Anki, pull on the phone, review any card.
4. **Uninstall** is fully reversible: `python install.py --uninstall` restores the
   templates and CSS byte-for-byte (verified by round-trip test).

**Ship a widget change** (when hacking on it yourself):

```bash
node grader_test.js            # parser/grader unit tests
python build.py                # rebuilds proto apkg + syntax/mustache/leak gates
python install.py              # re-patches the live templates (replaces old widget block)
python rendercheck.py          # renders a note through the LIVE templates, asserts invariants
```

## How it works

AnkiDroid can't host Python addons, so the whole experience lives in the **card
templates**: the widget JS is inlined (via install.py) into **both templates' fronts**
(the answer side gets it free through the `{{FrontSide}}` echo):

* **Writing card → Front** (meaning → characters): free-recall quiz *before* the answer.
  The characters exist only in a hidden span; no example, no pinyin, no guide glyph, no
  ▶/no-idea spoilers. The back shows the answer plus a **stroke-order browse panel**:
  one character at a time with ◂ 1/n ▸ paging and ▶ replay.
* **Reading card → Front** (characters → meaning): the characters are already visible,
  so this card carries a **guided quiz**: the same canvas *with the outline glyph shown*
  plus the pinyin field/picker — practice, not a test. On reveal it switches to the
  stroke-order browse (auto-animating each character) and grading is Anki's own buttons.

A hidden `#hd-dir` span stamps which card type is rendering (it echoes through
`{{FrontSide}}`), the quiz markup is `display:none` until the widget boots (so an echoed
block can't render dead input fields), and everything is wrapped in a
`{{#charsField}}` conditional so Anki's "Fix HTML" in the editor can't strip the script.

### Per-character flow (parallel — nothing gates the drawing canvas)

For each character of the word, simultaneously:

1. **Draw it** — hanzi-writer quiz mode on a 260px canvas. Strokes are matched against
   Make Me A Hanzi medians; wrong stroke/order is rejected live (`onMistake` → status +
   vibrate), correct strokes turn green. Matching is strict (`leniency: 1`) and strokes
   are **never auto-accepted** after mistakes (the engine's `markStrokeCorrectAfterMisses`
   stays off) — a wrong stroke can only pass by being drawn correctly. Repeated misses
   eventually *flash* the target stroke as a hint (after 5 misses on the writing card,
   6 on the guided reading card) — a last-resort spoiler, not forgiveness. On the
   writing front ▶/no-idea are hidden (spoilers); the reading card keeps them.
2. **Enter its pinyin** — either the text field (graded live as you type) or — because
   AnkiDroid's stable reviewer can't raise a keyboard for card inputs (issue #18063,
   fixed only in the still-beta new reviewer) — an on-card **🔤 syllables picker**: tap
   initial, final, tone from chip groups → commit. Both paths run the same grader.

When **both** aspects of a character are done, the widget advances to the next character.
`next ▸` force-advances and counts a reading miss if the pinyin isn't ✓ yet (hidden on
single-character cards). A wrong entry you later fix still counts once: the widget
remembers your longest wrong attempt and a final answer that *diverges* from it (rather
than extending it, as normal typing does) is a reading miss — e.g. `shei2` corrected to
`shei4` grades Again.

### Grading → Anki ease

`✓ grade` computes the verdict from the session: any giveup or reading miss → **Again**,
stroke mistakes → **Hard**, clean → **Good** — then calls `ankiAnswerEase1..3` through
every AnkiDroid JS API generation. If the answer was revealed before finishing (or via
the app's own Flip button), it degrades to "self-grade honestly" and never auto-grades.
The quiz canvas is kept hidden until hanzi-writer's initial glyph-fade completes
(`strokeFadeDuration: 1`) so the answer never flashes.

### Pinyin grader (strict, tone-aware)

`syllabify()` parses any mix of digit (`shang1`), tone-mark (`shāng`) or bare (`shang`)
forms — case-insensitively, since Android autocapitalizes — into `[{syl, tone}]` and
compares per syllable:

* tone **must** match when the card's syllable has one: `jiang` ✗ for `jiǎng`, `jiang3`/`jiǎng` ✓.
* neutral-tone targets accept toneless or `5` (`ma1ma` vs `māma` ✓).
* `ü`/`v` compared faithfully (`lu4` ✗ for `lǜ`; `lv4`/`lü4` ✓).
* tone marks are converted to digits placed at the **syllable end** before splitting —
  the earlier mid-syllable split corrupted diphthongs (`hǎo` → `ha`+`o`).
* If you type the actual hanzi (Chinese IME), it's compared as the character directly.

`node grader_test.js` re-extracts the parser from the widget and runs 61 cases.

### Stroke data & offline behavior

Stroke order comes from
[hanzi-writer-data](https://github.com/chanind/hanzi-writer-data), derived from
[Make Me A Hanzi](https://github.com/skishore/makemeahanzi) (stroke vectors + medians for
~9000 characters; its `graphics.txt` data comes from the Arphic fonts — see that project's
COPYING for terms). The quiz engine is vendored
[hanzi-writer v3.7.3](https://github.com/chanind/hanzi-writer) (MIT). Lookup order: inline subset
(`hanzi-data.js`) → `localStorage` cache (`hd:<char>`) → CDN fetch (cached on success).
A character never seen *and* offline degrades to "no stroke data — self-grade" instead of
blocking the review. hanzi-writer itself is inlined in every patched template, with a CDN
fallback script tag as well.

---

## Testing & deeper operations

**Browser-test the flow** without Anki at all:

```bash
python -m http.server 8781 --bind 127.0.0.1     # one server only — see pitfalls
```

then open `http://127.0.0.1:8781/test-page.html` and drive it from the console with
`driver.py`'s `window.__RUN(mode)` (paste the driver block from driver.py first):

| mode | what it proves |
|---|---|
| `mouse` / `touch` | synthetic strokes + typed pinyin → Good, 19/19 strokes on 商店 |
| `picker` | full run via 🔤 chips only (zero keyboard) |
| `sloppy` | every stroke drawn 14px off its median still passes (leniency floor) |
| `wrongorder` / `wrongpin` / `giveup` | rejection paths → Hard/Again semantics |
| `correct` / `correctmid` | corrected wrong pinyin counts as exactly 1 miss → Again |
| `reveal` | early flip → self-grade, never auto-grade |
| `staticback` / `backfresh` | answer-side renders (echo re-mount / fresh answer WebView) |
| `onechar` (`?word=one`) | single-char card: next ▸ hidden, one char → Good |
| `readbrowse` (`?dir=reading`) | reading front quiz → reveal → auto-animated browse |

The demo page also takes `?answering=1` (boot already revealed, like AnkiDroid's old
answer WebView). Expect `ease: 3` (or the mode's verdict) and `okCount: 19` for clean
runs on the 商店 test card. The rig reads the widget from `media/hanzi-drill.js` with a
`?v=` cache buster — bump it after editing the widget.

**Demo deck** (`build.py` → `hanzi-drill-proto.apkg`): a self-contained test deck under
its own note type (`hanzi-drill` — never named after yours, since importing a note type
with an existing name merges into and clobbers it). Useful to try the widget before
touching your real collection.

**Sync** after any install: Anki → File → Sync Now (or the MCP's `sync` action —
fire-and-forget), then pull on the phone.

**Phone setup**: Settings → Advanced → *"Type answer into the card"* helps the text field
where the version still honors it; the picker works regardless. The picker is the primary
entry because the stable reviewer's WebView can't raise a keyboard for card inputs —
don't spend time debugging that; it's upstream, fixed only in the (dev-option) new
reviewer: Settings → About → tap logo 7× → Developer options → new review screen.

## Pitfalls learned the hard way

* **Anki substitutes `{{mustaches}}` even inside `<script>`** — a doc comment mentioning a
  field name leaks answers into rendered cards. build/install assert no `{{` in JS sources.
* **AnkiDroid runs inline `<script>` during render, before the DOM settles** — the hidden
  field spans must precede the script tag or init reads empty fields ("no hanzi in card").
* **The old reviewer doesn't re-run card JS on show-answer and has no `#answer` element**
  (the shell contains only `#content`) — detect the flip by polling `api.isDisplayingAnswer()`.
* **hanzi-writer listens only to `mousedown/move/up` + `touch*` events** — synthetic
  `PointerEvent`s are silently ignored; test drivers must dispatch real Mouse/TouchEvents.
* **Windows double-binds HTTP ports** (SO_REUSEADDR): an orphaned `http.server` will
  answer 200 with empty bodies while you debug a "broken widget". Check `netstat -ano`,
  kill every listener on the port, start exactly one.
* **The Anki MCP add-on refuses non-image/audio/video media files** (`store_media_file`
  media-type allowlist), which is why the widget is inlined in templates instead of
  shipped as `hanzi-drill.js` media.
* **Model-level sync is last-writer-wins**: any tool that re-saves the note type (batch
  restyling from another machine, "Fix HTML", card-type changes) clobbers the widget
  block. Re-run `python install.py` afterwards — it's idempotent and takes seconds.
* **hanzi-writer's `leniency` is a `create()` option** — passing it to `quiz()` is
  silently ignored. `showHintAfterMisses` only flashes a hint (auto-accept is the
  separate `markStrokeCorrectAfterMisses`), but the flash spoils free recall — keep
  its threshold high.
* **Android IME quirks**: `preventDefault()` on the input's `touchend` suppresses the
  soft keyboard, and after canvas drawing `document.activeElement` can still point at
  the input while the IME is down — wake it with `blur()` then `focus()`.
* **Night mode**: the AnkiDroid reviewer page carries no `night_mode` class, so CSS-only
  theming never matches; the widget detects a dark background itself and inlines colors
  on its own elements only (scoped to `#hd-root`).

## History / why it's shaped like this

* **Stroke-matcher spike** (first): ported hanzi-writer's stroke matcher to
  dependency-free JS and proved on real MMAH medians that wrong order is rejected 0/214
  pairs, reversed strokes 32/32, correct strokes survive ±18px finger jitter. That
  validated the whole idea cheaply before touching Anki. (Spike code lived in `spike/`,
  removed once the engine shipped; those numbers are the acceptance bar for any future
  native reimplementation.)
* **Deck hack before native app**: AnkiDroid has no addon system, so v0 went into card
  templates via its JS API — zero changes to any card-generation workflow (LLM-driven or
  manual), since new notes inherit the patched note type automatically.
* **Parallel pinyin+draw** after a mobile regression proved pinyin must never gate the
  canvas (dead keyboard ⇒ undrawable card). **Picker** after confirming the keyboard bug
  is unfixable from template JS in the stable reviewer.
* **Native Kotlin app** (spike plan, not started): rsdroid + AnkiWeb sync, grader port
  reproducing the spike acceptance numbers above, CEDICT for tap-to-lookup; writing
  telemetry goes in
  the card `data` field so it syncs for free. The deck hack is expected to be good enough
  to review with daily; the app is the upgrade if canvas latency or WebView quirks bite.
