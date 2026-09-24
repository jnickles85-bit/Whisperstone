# Whisperstone Phase 1 (Echo) Implementation Plan

> **For agentic workers:** This plan is executed through the Hermes **Kanban** board, not
> **SUPERSEDED 2026-09-24 — design record only, do not execute.** This plan describes the abandoned reload-path design; the project was pivoted to forking `chelinho139/wow-ai`. Retained because the codec work was verified and the reasoning is useful history.
>
> superpowers subagent dispatch. Each task below becomes one card assigned to `d4`, one
> acceptance criterion per card, with the addon files serialized (never two cards editing
> the addon at once). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the SavedVariables round-trip between the Whisperstone addon and the host bridge on the WoW: Forever beta client, with no AI involved.

**Architecture:** The addon writes a Base64(JSON) payload into its own SavedVariables, which WoW flushes to disk on `/reload`. A host-side Python bridge reads that file by regex, decodes it, and writes a Base64(JSON) reply into a plain data file inside the addon's folder. The addon reads that file at load and renders it. Files are the only channel; the sandbox offers nothing else.

**Tech Stack:** Lua 5.1 (WoW addon, mainline API), Python 3 stdlib only (bridge), pytest (bridge tests).

**Spec:** `docs/superpowers/specs/2026-09-24-whisperstone-design.md`

## Global Constraints

- Target client folder: `_classic_beta_` under `C:\Program Files (x86)\World of Warcraft`.
  From WSL that is `/mnt/c/Program Files (x86)/World of Warcraft/_classic_beta_`.
- **This plan covers the reload-path transport only, and it is Phase 1 of four.** The
  two-reload round-trip is a deliberate conservative choice, **not** a sandbox limit — live
  carriers (pixel strip + LoadOnDemand slots) exist and are in production. Phase 2 replaces
  this transport; do not let Phase 1's shape harden into the product's shape. See
  `docs/superpowers/specs/2026-09-24-whisperstone-transport-correction.md`.
- The addon is a **mainline** addon. Forever reports `WOW_PROJECT_ID = 1`. Do not use
  Classic-era globals (`GetItemInfo`, `GetSpellInfo`, `GetTalentInfo`); use `C_Item`,
  `C_Spell`, `C_Traits`.
- **Never touch combat APIs.** No `UnitHealth`, no unit comparison, no arithmetic on unit
  values. Secret values are avoided by not touching them, not by handling them.
- Payloads are Base64(JSON) in **both** directions. Base64's alphabet (`A-Za-z0-9+/=`) needs
  no Lua string escaping, so the SavedVariables value is extractable with a simple regex.
- Inbound file contains **only data, never executable Lua**. No code-injection path.
- No memory reading, no synthetic input. Not negotiable in this phase.
- Bridge is Python **stdlib only** — no pip installs.
- Every task ends with an independently verifiable deliverable and a commit.

---

### Task 1: Payload codec (bridge)

**Files:**
- Create: `bridge/payload.py`
- Test: `bridge/tests/test_payload.py`

**Interfaces:**
- Consumes: nothing
- Produces: `encode_payload(obj: dict) -> str`, `decode_payload(b64: str) -> dict`,
  `PayloadError` exception. Both directions use compact JSON (no spaces) so byte-for-byte
  comparison against the Lua encoder is meaningful.

- [ ] **Step 1: Write the failing test**

```python
import base64, json
import pytest
from payload import encode_payload, decode_payload, PayloadError

def test_encode_is_compact_base64_json():
    out = encode_payload({"q": "hi", "seq": 1})
    assert isinstance(out, str)
    assert json.loads(base64.b64decode(out, validate=True)) == {"q": "hi", "seq": 1}

def test_round_trip_preserves_unicode():
    obj = {"q": "Wróć do obozu — 4/8", "seq": 7}
    assert decode_payload(encode_payload(obj)) == obj

def test_decode_rejects_invalid_base64():
    with pytest.raises(PayloadError):
        decode_payload("not base64!!")

def test_decode_rejects_non_object_json():
    bad = base64.b64encode(b"[1,2,3]").decode()
    with pytest.raises(PayloadError):
        decode_payload(bad)

def test_decode_rejects_truncated_payload():
    good = encode_payload({"q": "hi", "seq": 1})
    with pytest.raises(PayloadError):
        decode_payload(good[: len(good) // 2])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bridge && python3 -m pytest tests/test_payload.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'payload'`

- [ ] **Step 3: Write minimal implementation**

```python
"""Base64(JSON) payload codec shared by both file lanes."""
import base64
import binascii
import json


class PayloadError(Exception):
    """Raised when a payload cannot be decoded as a JSON object."""


def encode_payload(obj: dict) -> str:
    """Encode a dict to compact-JSON, then Base64. Returns ASCII str."""
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def decode_payload(b64: str) -> dict:
    """Decode a Base64(JSON) string back to a dict.

    Raises PayloadError on bad base64, non-UTF8 bytes, invalid JSON, or
    a JSON value that is not an object. WoW SavedVariables writes are not
    atomic, so truncated input is expected in the wild and must not crash.
    """
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PayloadError(f"invalid base64: {exc}") from exc
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PayloadError(f"payload is not utf-8: {exc}") from exc
    try:
        obj = json.loads(text)
    except json.JSONDecodeError as exc:
        raise PayloadError(f"invalid json: {exc}") from exc
    if not isinstance(obj, dict):
        raise PayloadError(f"payload must be a json object, got {type(obj).__name__}")
    return obj
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bridge && python3 -m pytest tests/test_payload.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
cd /home/jnick/Whisperstone
git add bridge/payload.py bridge/tests/test_payload.py
git commit -m "feat(bridge): base64(json) payload codec"
```

---

### Task 2: SavedVariables reader and inbox writer (bridge)

**Files:**
- Create: `bridge/lanes.py`
- Test: `bridge/tests/test_lanes.py`

**Interfaces:**
- Consumes: `payload.decode_payload`, `payload.encode_payload` (Task 1)
- Produces: `read_outbox(sv_path: Path) -> dict | None`, `write_inbox(inbox_path: Path, obj: dict) -> str` (returns the base64 written), and `OUTBOX_KEY` constant.

**Why a regex and not a Lua parser:** the addon stores the payload as a single Base64
string. Base64's alphabet contains nothing Lua must escape, so the value appears in
SavedVariables as `WhisperstoneDB_out = "AAAA..."`. A regex is sufficient and cannot be
confused by nested tables.

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path
import pytest
from lanes import read_outbox, write_inbox, OUTBOX_KEY
from payload import encode_payload, decode_payload

def sv(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "Whisperstone.lua"
    p.write_text(body, encoding="utf-8")
    return p

def test_read_outbox_extracts_payload(tmp_path):
    b64 = encode_payload({"q": "hello", "seq": 3})
    path = sv(tmp_path, f'WhisperstoneDB = {{\n\t["out"] = "{b64}",\n}}\n')
    assert read_outbox(path) == {"q": "hello", "seq": 3}

def test_read_outbox_returns_none_when_key_absent(tmp_path):
    path = sv(tmp_path, 'WhisperstoneDB = {\n}\n')
    assert read_outbox(path) is None

def test_read_outbox_returns_none_on_missing_file(tmp_path):
    assert read_outbox(tmp_path / "nope.lua") is None

def test_read_outbox_returns_none_on_truncated_file(tmp_path):
    b64 = encode_payload({"q": "hello", "seq": 3})
    path = sv(tmp_path, f'WhisperstoneDB = {{\n\t["out"] = "{b64[:6]}')
    assert read_outbox(path) is None

def test_write_inbox_is_data_only_and_readable(tmp_path):
    target = tmp_path / "whisperstone_inbox.lua"
    b64 = write_inbox(target, {"a": "Reply text", "seq": 3})
    text = target.read_text(encoding="utf-8")
    assert "return" not in text
    assert "function" not in text
    assert decode_payload(b64) == {"a": "Reply text", "seq": 3}
    assert b64 in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bridge && python3 -m pytest tests/test_lanes.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lanes'`

- [ ] **Step 3: Write minimal implementation**

```python
"""The two file lanes: SavedVariables outbox (read) and inbox file (write)."""
import re
from pathlib import Path

from payload import PayloadError, decode_payload, encode_payload

#: Key name the addon uses inside its SavedVariables table.
OUTBOX_KEY = "out"

# WoW's SavedVariables serializer always writes table fields as ["key"] = "value",
# so match the assignment as a unit. Searching for a bare quoted string instead
# captures the KEY ("out") rather than the value, and decode always fails.
_OUTBOX = re.compile(r'\["out"\]\s*=\s*"([A-Za-z0-9+/=]*)"')

INBOX_HEADER = (
    "-- Whisperstone inbox. DATA ONLY: no executable Lua is ever written here.\n"
    "-- Written by the host bridge; read by the addon at load time.\n"
)


def read_outbox(sv_path: Path) -> dict | None:
    """Return the newest addon payload, or None if absent/unreadable/truncated."""
    try:
        text = Path(sv_path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    match = _OUTBOX.search(text)
    if not match:
        return None

    try:
        return decode_payload(match.group(1))
    except PayloadError:
        # Truncated or corrupt SavedVariables: treat as no message rather than
        # crashing the bridge. WoW's writes are not atomic.
        return None


def write_inbox(inbox_path: Path, obj: dict) -> str:
    """Write a reply into the addon folder. Returns the base64 string written."""
    b64 = encode_payload(obj)
    Path(inbox_path).write_text(
        f'{INBOX_HEADER}WhisperstoneInbox = "{b64}"\n', encoding="utf-8"
    )
    return b64
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bridge && python3 -m pytest tests/test_lanes.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
cd /home/jnick/Whisperstone
git add bridge/lanes.py bridge/tests/test_lanes.py
git commit -m "feat(bridge): savedvariables reader and inbox writer"
```

---

### Task 3: Determine the Forever interface number and create the addon skeleton

**Files:**
- Create: `addon/Whisperstone/Whisperstone.toc`
- Create: `addon/Whisperstone/Payload.lua`
- Create: `addon/Whisperstone/Core.lua`
- Test: in-client load (manual, evidenced)

**Interfaces:**
- Consumes: nothing
- Produces: global `Whisperstone` namespace table with `Whisperstone.base64Encode(str)`,
  `Whisperstone.base64Decode(str)`, `Whisperstone.jsonEncodeFlat(tbl)`,
  `Whisperstone.jsonDecodeFlat(str)`, and SavedVariables table `WhisperstoneDB` with field
  `out`.

**Prerequisite:** the beta client must have been launched at least once, so that
`Interface/AddOns` and `WTF/Config.wtf` exist.

- [ ] **Step 1: Read the real interface number — do not guess it**

Run:
```bash
grep -oE 'lastAddonVersion[^,]*' "/mnt/c/Program Files (x86)/World of Warcraft/_classic_beta_/WTF/Config.wtf"
```
Expected: a line like `lastAddonVersion "16001"`. Use the numeric value in the `.toc`
below. If the file does not exist, launch the beta client once and log a character in
first. **Record the observed value in the card comment.** An assumed interface number is
not acceptable evidence.

- [ ] **Step 2: Create the .toc**

`addon/Whisperstone/Whisperstone.toc` — replace `<IFACE>` with the value from Step 1:

```
## Interface: <IFACE>
## Title: Whisperstone
## Notes: Talk to your Hermes agent from inside the game.
## Author: Mightie
## Version: 0.1.0
## SavedVariables: WhisperstoneDB
## AllowLoadGameType: mainline

Payload.lua
Inbox.lua
Core.lua
```

`Inbox.lua` is the bridge's write target. It ships as a stub holding an empty
`WhisperstoneInbox` assignment, so the addon still loads cleanly before the first reply
exists. Because the `.toc` lists it, the client parses it at every load — which is exactly
how the reply arrives. **No `io.open` is used anywhere:** listing the inbox in the `.toc`
makes the client read the file for us, so the design does not depend on Lua file I/O being
available in the Forever sandbox.

Create `addon/Whisperstone/Inbox.lua` containing only:

```lua
-- Whisperstone inbox stub. DATA ONLY: the host bridge rewrites this file with a reply.
-- Listed in Whisperstone.toc so the client parses it on every load.
WhisperstoneInbox = ""
```

- [ ] **Step 3: Write Payload.lua**

```lua
-- Whisperstone payload codec: Base64 over compact JSON.
-- Base64's alphabet needs no Lua escaping, so the value round-trips through
-- SavedVariables as a plain quoted string the bridge can regex out.
local ADDON, ns = ...

local B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64_LOOKUP = {}
for i = 1, #B64_CHARS do
    B64_LOOKUP[B64_CHARS:sub(i, i)] = i - 1
end

function ns.base64Encode(s)
    local out, len, i = {}, #s, 1
    while i <= len do
        local b1 = string.byte(s, i)
        local b2 = string.byte(s, i + 1)
        local b3 = string.byte(s, i + 2)
        local n = (b1 or 0) * 65536 + (b2 or 0) * 256 + (b3 or 0)
        local c1 = math.floor(n / 262144) % 64
        local c2 = math.floor(n / 4096) % 64
        local c3 = math.floor(n / 64) % 64
        local c4 = n % 64
        out[#out + 1] = B64_CHARS:sub(c1 + 1, c1 + 1)
        out[#out + 1] = B64_CHARS:sub(c2 + 1, c2 + 1)
        out[#out + 1] = b2 and B64_CHARS:sub(c3 + 1, c3 + 1) or "="
        out[#out + 1] = b3 and B64_CHARS:sub(c4 + 1, c4 + 1) or "="
        i = i + 3
    end
    return table.concat(out)
end

function ns.base64Decode(s)
    s = s:gsub("[^%w%+/=]", "")
    local out = {}
    for i = 1, #s, 4 do
        local c1 = B64_LOOKUP[s:sub(i, i)] or 0
        local c2 = B64_LOOKUP[s:sub(i + 1, i + 1)] or 0
        local c3 = B64_LOOKUP[s:sub(i + 2, i + 2)]
        local c4 = B64_LOOKUP[s:sub(i + 3, i + 3)]
        local n = c1 * 262144 + c2 * 4096 + (c3 or 0) * 64 + (c4 or 0)
        out[#out + 1] = string.char(math.floor(n / 65536) % 256)
        if c3 then out[#out + 1] = string.char(math.floor(n / 256) % 256) end
        if c4 then out[#out + 1] = string.char(n % 256) end
    end
    return table.concat(out)
end

-- Minimal flat-object JSON. Phase 1 payloads hold only string/number values;
-- nested tables are deliberately unsupported so the encoder stays auditable.
local ESCAPES = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }

local function encodeValue(v)
    local t = type(v)
    if t == "number" then
        return tostring(v)
    elseif t == "string" then
        return '"' .. v:gsub('[%c"\\]', ESCAPES) .. '"'
    elseif t == "boolean" then
        return tostring(v)
    end
    error("Whisperstone: unsupported payload value type: " .. t)
end

function ns.jsonEncodeFlat(tbl)
    local parts = {}
    for k, v in pairs(tbl) do
        parts[#parts + 1] = '"' .. k .. '":' .. encodeValue(v)
    end
    table.sort(parts) -- deterministic output makes bridge-side diffs readable
    return "{" .. table.concat(parts, ",") .. "}"
end

-- Flat decode for the bridge's reply payloads: "key":"value" and "key":number.
--
-- Two Lua-specific traps this handles (both caught by the parity harness against
-- a real Lua VM in Step 5 — do not "simplify" this back into one gmatch):
--  1. Lua patterns have NO alternation. A pattern written with `|` treats the
--     pipe as a literal character and silently never matches anything.
--  2. A naive "[^"]*" capture stops at an escaped quote, so escaped sequences
--     are swapped for sentinels before matching and restored afterwards.
local SENTINELS = {
    { "\\\\", "\1" }, -- literal backslash (must run first)
    { '\\"',  "\2" }, -- escaped quote
    { "\\n",  "\3" }, -- newline
    { "\\r",  "\4" }, -- carriage return
    { "\\t",  "\5" }, -- tab
}
local RESTORE = {
    ["\1"] = "\\", ["\2"] = '"', ["\3"] = "\n", ["\4"] = "\r", ["\5"] = "\t",
}

function ns.jsonDecodeFlat(s)
    local out = {}
    local protected = s
    for _, pair in ipairs(SENTINELS) do
        protected = protected:gsub(pair[1], pair[2])
    end

    -- Pass 1: string values.
    for k, v in protected:gmatch('"([^"]+)"%s*:%s*"([^"]*)"') do
        out[k] = v:gsub("[\1\2\3\4\5]", RESTORE)
    end

    -- Pass 2: numeric values. Cannot collide with pass 1: a quoted value never
    -- starts with a digit, because the opening quote is consumed by the pattern.
    for k, v in protected:gmatch('"([^"]+)"%s*:%s*([%-%d%.]+)') do
        out[k] = tonumber(v)
    end

    return out
end
```

- [ ] **Step 4: Write Core.lua**

```lua
-- Whisperstone core: SavedVariables init, slash command, load-time inbox read.
local ADDON, ns = ...

WhisperstoneDB = WhisperstoneDB or {}

local SEQ = 0

function ns.newSeq()
    SEQ = SEQ + 1
    return SEQ
end

-- Queue a question for the bridge by writing it into our own SavedVariables.
-- WoW flushes SavedVariables only on logout/reload, so the caller reloads.
function ns.sendQuestion(text)
    local payload = ns.jsonEncodeFlat({
        q = text,
        seq = ns.newSeq(),
        t = time(),
        v = 1,
    })
    WhisperstoneDB.out = ns.base64Encode(payload)
    WhisperstoneDB.lastQuestion = text
end

-- Read the bridge's reply. There is NO file I/O here on purpose: Inbox.lua is
-- listed in Whisperstone.toc, so the client parses it at every load and leaves
-- the value in the global WhisperstoneInbox. This avoids depending on io.open
-- being present in the Forever sandbox at all.
function ns.readInbox()
    local b64 = WhisperstoneInbox
    if type(b64) ~= "string" or b64 == "" then return nil end
    return ns.jsonDecodeFlat(ns.base64Decode(b64))
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function(_, event, arg1)
    if event == "ADDON_LOADED" and arg1 ~= ADDON then return end
    WhisperstoneDB = WhisperstoneDB or {}
    if event == "PLAYER_LOGIN" then
        ns.pendingInbox = ns.readInbox()
    end
end)

SLASH_WHISPERSTONE1 = "/whisperstone"
SLASH_WHISPERSTONE2 = "/ws"
SlashCmdList["WHISPERSTONE"] = function(msg)
    msg = (msg or ""):match("^%s*(.-)%s*$")
    if msg == "" then
        print("|cff9d7cffWhisperstone|r: Phase 1 build. /ws <text> to send.")
        return
    end
    ns.sendQuestion(msg)
    print("|cff9d7cffWhisperstone|r: queued. Type /reload to flush it.")
end
```

- [ ] **Step 5: Cross-validate the Lua codec against Python — mandatory gate**

Hand-written Lua base64/JSON is the riskiest assumption in this design: if the two codecs
disagree, the round-trip fails silently in-game and nothing upstream catches it. This step
runs the *actual shipped* `Payload.lua` through a real Lua VM and compares it against the
Python codec in both directions.

Create `bridge/tests/parity.py`:

```python
#!/usr/bin/env python3
"""Cross-validate the shipped Whisperstone Lua codec against the Python codec.

Runs the REAL Payload.lua through a Lua VM (lupa) and compares output with
Python's base64/json in both directions. A mismatch here means the in-game
round-trip fails silently, so this is a hard gate, not a nicety.
"""
import base64
import json
import re
import sys
from pathlib import Path

from lupa import LuaRuntime

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from payload import decode_payload, encode_payload  # noqa: E402

LUA_SRC = Path(__file__).resolve().parents[2] / "addon" / "Whisperstone" / "Payload.lua"
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  -- ' + detail) if detail and not ok else ''}")
    if not ok:
        failures.append(name)


def load_codec():
    """Load the shipped Payload.lua, replacing the addon load vararg idiom."""
    src = LUA_SRC.read_text(encoding="utf-8")
    src = src.replace("local ADDON, ns = ...", "ns = {}", 1)
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(src)
    return lua.globals().ns, lua


def norm(d):
    """Normalize a mapping off the Lua VM: lupa yields floats for Lua numbers."""
    if d is None:
        return None
    out = {}
    for k, v in dict(d).items():
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        out[str(k)] = v
    return out


def main():
    ns, lua = load_codec()
    lua_table = lua.table_from

    # 1. Lua base64 encoder must equal Python's across every padding case.
    samples = ["", "a", "ab", "abc", "abcd", "abcde", "hello world",
               "Wrócić do obozu", "Whisperstone — phase 1", "x" * 100]
    for s in samples:
        check(f"base64Encode({len(s)} bytes)",
              ns.base64Encode(s) == base64.b64encode(s.encode("utf-8")).decode("ascii"))
        check(f"base64 round-trip({len(s)} bytes)", ns.base64Decode(ns.base64Encode(s)) == s)

    payload = {"q": "where is the camp", "seq": 4, "t": 1727200000}

    # 2. Lua JSON must be parseable by Python.
    lua_json = ns.jsonEncodeFlat(lua_table(payload))
    try:
        check("jsonEncodeFlat -> Python json.loads", json.loads(lua_json) == payload)
    except Exception as exc:  # noqa: BLE001
        check("jsonEncodeFlat -> Python json.loads", False, f"{exc}: {lua_json!r}")

    # 3. Lua encodes -> Python decodes.
    lua_b64 = ns.base64Encode(ns.jsonEncodeFlat(lua_table(payload)))
    try:
        check("Lua encode -> Python decode_payload", decode_payload(lua_b64) == payload)
    except Exception as exc:  # noqa: BLE001
        check("Lua encode -> Python decode_payload", False, f"{exc}")

    # 4. Python encodes -> Lua decodes.
    got = ns.jsonDecodeFlat(ns.base64Decode(encode_payload(payload)))
    check("Python encode -> Lua decode", norm(got) == payload, f"got={norm(got)!r}")

    # 5. Escape handling both ways: quotes, backslashes, newlines, tabs.
    esc = {"q": 'say "hi" to the \\ camp\nand\ttab', "seq": 9}
    try:
        check("escapes: Lua -> Python",
              decode_payload(ns.base64Encode(ns.jsonEncodeFlat(lua_table(esc)))) == esc)
    except Exception as exc:  # noqa: BLE001
        check("escapes: Lua -> Python", False, f"{exc}")
    check("escapes: Python -> Lua",
          norm(ns.jsonDecodeFlat(ns.base64Decode(encode_payload(esc)))) == esc,
          f"got={norm(ns.jsonDecodeFlat(ns.base64Decode(encode_payload(esc))))!r}")

    # 6. The real SavedVariables shape must be matchable by the bridge regex.
    sv_text = 'WhisperstoneDB = {\n\t["out"] = "%s",\n}\n' % lua_b64
    m = re.search(r'\["out"\]\s*=\s*"([A-Za-z0-9+/=]*)"', sv_text)
    check("bridge regex matches Lua-written SavedVariables", bool(m))
    if m:
        check("bridge regex payload decodes", decode_payload(m.group(1)) == payload)

    print(f"\n{len(failures)} failure(s)" + (f": {failures}" if failures else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Run:
```bash
cd /home/jnick/Whisperstone
python3 -m venv .venv && ./.venv/bin/pip install --quiet lupa
./.venv/bin/python -m pytest bridge/tests/ -q     # unit tests
./.venv/bin/python bridge/tests/parity.py          # codec parity gate
```
Expected: all unit tests pass, and parity reports `0 failure(s)`. Paste both outputs into
the card.

- [ ] **Step 6: Install the addon into the beta client and verify it loads**

Run:
```bash
WOW="/mnt/c/Program Files (x86)/World of Warcraft/_classic_beta_"
mkdir -p "$WOW/Interface/AddOns/Whisperstone"
cp /home/jnick/Whisperstone/addon/Whisperstone/* "$WOW/Interface/AddOns/Whisperstone/"
ls -la "$WOW/Interface/AddOns/Whisperstone/"
```
Expected: four files present (`.toc`, `Payload.lua`, `Inbox.lua`, `Core.lua`).

- [ ] **Step 7: Verify in-client — evidence required**

In the beta client: enable Whisperstone on the addon list, log in, type `/ws hello`. Then
`/reload`. Then run:
```bash
grep -o 'WhisperstoneDB_out[^,]*' "/mnt/c/Program Files (x86)/World of Warcraft/_classic_beta_/WTF/SavedVariables/Whisperstone.lua"
```
Expected: a Base64 string. Paste the actual command output into the card. **A statement
that it loaded is not evidence.** If the key is absent, the beta SavedVariables bug is
live — record that as the finding, because it is exactly what Phase 1 exists to discover.

- [ ] **Step 8: Commit**

```bash
cd /home/jnick/Whisperstone
git add addon/Whisperstone/Whisperstone.toc addon/Whisperstone/Payload.lua addon/Whisperstone/Core.lua
git commit -m "feat(addon): whisperstone skeleton, payload codec, savedvariables outbox"
```

---

### Task 4: Echo bridge (Phase 1 end-to-end)

**Files:**
- Create: `bridge/echo_bridge.py`
- Create: `bridge/config.example.json`
- Test: `bridge/tests/test_echo_bridge.py`

**Interfaces:**
- Consumes: `lanes.read_outbox`, `lanes.write_inbox` (Task 2)
- Produces: `EchoBridge(sv_path, inbox_path)` with `poll_once() -> bool` (True when a reply
  was written), and a `main()` that polls on an interval.

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path
from lanes import read_outbox
from payload import encode_payload, decode_payload
from echo_bridge import EchoBridge

def test_poll_once_echoes_and_dedupes(tmp_path):
    sv = tmp_path / "Whisperstone.lua"
    inbox = tmp_path / "whisperstone_inbox.lua"
    sv.write_text(
        f'WhisperstoneDB = {{\n\t["out"] = "{encode_payload({"q": "ping", "seq": 1})}",\n}}\n',
        encoding="utf-8",
    )
    bridge = EchoBridge(sv, inbox)
    assert bridge.poll_once() is True
    reply = decode_payload(inbox.read_text(encoding="utf-8").split('"')[1])
    assert reply["a"] == "echo: ping"
    assert reply["seq"] == 1
    # Same payload already handled: no second reply.
    assert bridge.poll_once() is False

def test_poll_once_without_payload_writes_nothing(tmp_path):
    sv = tmp_path / "Whisperstone.lua"
    inbox = tmp_path / "whisperstone_inbox.lua"
    sv.write_text("WhisperstoneDB = {\n}\n", encoding="utf-8")
    bridge = EchoBridge(sv, inbox)
    assert bridge.poll_once() is False
    assert not inbox.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bridge && python3 -m pytest tests/test_echo_bridge.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'echo_bridge'`

- [ ] **Step 3: Write minimal implementation**

```python
#!/usr/bin/env python3
"""Whisperstone Phase 1 echo bridge: proves the file round-trip with no AI attached."""
import argparse
import sys
import time
from pathlib import Path

from lanes import read_outbox, write_inbox

DEFAULT_SV = (
    "/mnt/c/Program Files (x86)/World of Warcraft/_classic_beta_/WTF/SavedVariables/Whisperstone.lua"
)
DEFAULT_INBOX = (
    "/mnt/c/Program Files (x86)/World of Warcraft/_classic_beta_/Interface/AddOns/Whisperstone/Inbox.lua"
)


class EchoBridge:
    """Echoes each new addon payload back through the inbox lane."""

    def __init__(self, sv_path, inbox_path):
        self.sv_path = Path(sv_path)
        self.inbox_path = Path(inbox_path)
        self._last = None

    def poll_once(self) -> bool:
        """Handle at most one payload. Returns True if a reply was written."""
        msg = read_outbox(self.sv_path)
        if msg is None:
            return False
        key = (msg.get("seq"), msg.get("q"))
        if key == self._last:
            return False
        self._last = key
        write_inbox(
            self.inbox_path,
            {"a": f"echo: {msg.get('q', '')}", "seq": msg.get("seq"), "t": msg.get("t")},
        )
        print(f"[bridge] echoed seq={msg.get('seq')}: {msg.get('q', '')!r}", flush=True)
        return True


def main() -> int:
    ap = argparse.ArgumentParser(description="Whisperstone Phase 1 echo bridge")
    ap.add_argument("--sv", default=DEFAULT_SV)
    ap.add_argument("--inbox", default=DEFAULT_INBOX)
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--once", action="store_true", help="poll once and exit")
    args = ap.parse_args()

    bridge = EchoBridge(args.sv, args.inbox)
    if args.once:
        return 0 if bridge.poll_once() else 1

    print(f"[bridge] watching {args.sv}", flush=True)
    while True:
        try:
            bridge.poll_once()
        except Exception as exc:  # never die mid-session on a bad read
            print(f"[bridge] poll error: {exc}", file=sys.stderr, flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bridge && python3 -m pytest tests/ -v`
Expected: PASS (12 passed — Tasks 1, 2, and 4 suites)

- [ ] **Step 5: Commit**

```bash
cd /home/jnick/Whisperstone
git add bridge/echo_bridge.py bridge/tests/test_echo_bridge.py bridge/config.example.json
git commit -m "feat(bridge): phase 1 echo bridge"
```

---

### Task 5: End-to-end verification, including in an instance

**Files:**
- Create: `docs/phase1-evidence.md`

**Interfaces:**
- Consumes: everything above
- Produces: a written evidence record, not a claim

- [ ] **Step 1: Run the round-trip in a capital city**

With the beta client open and the bridge running (`python3 bridge/echo_bridge.py`):
`/ws phase one test` → `/reload` → confirm the bridge printed the echo → `/reload` again →
confirm the reply is readable.
Capture the bridge stdout verbatim.

- [ ] **Step 2: Run the round-trip inside a dungeon or raid**

Enter an instance. Repeat Step 1. This tests the chat-messaging lockdown condition the
Forever datamine flagged: guarded chat APIs go secret on addon-restricted maps. Expected
outcome is that a non-combat addon's own SavedVariables are unaffected — **but that is a
hypothesis, and this step is where it becomes evidence either way.** Record the actual
result.

- [ ] **Step 3: Test the beta SavedVariables restore bug**

Log out completely, log back in, and check whether `WhisperstoneDB` still holds its prior
value. Forever beta testers report restore failures with no addons installed; this
determines whether the whole design is viable on this client. Record the observed result.

- [ ] **Step 4: Write the evidence file and commit**

Record: the exact interface number read from `Config.wtf`, verbatim command output for
each step, and a plain statement of what failed. If any step failed, the plan's successor
(Phase 2) does not start until the failure is understood.

```bash
cd /home/jnick/Whisperstone
git add docs/phase1-evidence.md
git commit -m "docs: phase 1 end-to-end evidence"
```

---

## Self-Review

**Spec coverage:** Phase 1 ("Echo, no AI") is covered by Tasks 3–5. The spec's transport,
two-lane, data-only-inbound, and Base64(JSON) constraints are implemented in Tasks 1–4. The
spec's open questions 1–3 are explicitly resolved by Tasks 3 Step 1, 5 Step 2, and 5 Step 3
respectively. Open question 4 (long agent turns) belongs to Phase 3 and is correctly absent
here. The spec's "Explicitly rejected" section is honored by Global Constraints.

**Placeholder scan:** the one `<IFACE>` token is not a placeholder for the implementer to
invent — Step 1 gives the exact command that yields the value, and Step 6 requires the
observed output as evidence. Everything else carries real code.

**Type consistency:** `encode_payload`/`decode_payload` (Task 1) are used unchanged in Tasks
2 and 4. `read_outbox`/`write_inbox`/`OUTBOX_KEY` (Task 2) are consumed as named in Task 4.
The addon's `ns.base64Encode`/`ns.jsonEncodeFlat` (Task 3) produce exactly the compact-JSON
shape Task 1's `decode_payload` parses. SavedVariables field `out` matches `OUTBOX_KEY`.

**Known gap, stated rather than hidden:** the addon's `jsonDecodeFlat` is a flat-object
parser and will not handle nested JSON. Phase 1 and Phase 2 payloads are flat by design; if
Phase 3 needs nesting, the decoder is replaced then, and that is a deliberate deferral
rather than an oversight.
