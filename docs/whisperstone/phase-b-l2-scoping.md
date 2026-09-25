# Whisperstone Phase B (L2) scoping — gear, stats and bank into the agent

**Card:** `t_18b783f6`
**Status:** design spec, no code. During this card another worker (`t_311fcc43`, the minimap button)
was editing `addon/WoWAI/WoWAI.lua`; they committed `754bf44` mid-card. All line citations below
were re-verified against that commit. This card wrote **only this file**.
**Verdict in one line:** reuse StatForge as the *host-side large-payload source*, reimplement a
*small summary reader* in WoWAI, and fix a real defect in StatForge's bank reader before reuse.

---

## 0. Executive summary

| # | Card claim | Verdict |
|---|---|---|
| 1 | Context slot is 700 bytes and **replaces** | **Confirmed** (`WoWAI.lua:928`, `:1045`; `bridge.js:343`) — but the live figure is **234 bytes**, not 227 |
| 2 | Strip is 3,600 bytes raw / ~3.2 KB shared | **Confirmed** (`WoWAI.lua:33`, `Codec.lua:14-15`) |
| 3 | A 16-slot gear block fits in the 234-byte remainder | **Refuted** — a generated 16-slot listing is **437 bytes** (the card estimated 352), leaving **29 bytes**; add a stats line and it is **OVER the cap by 45**. A full 19-slot listing (503 bytes) does not fit even *alone* (**737**, over by 37). |
| 4 | A bank cannot fit on the strip | **Confirmed, and worse than stated** — see the carrier section |
| 5 | The bridge already reads SavedVariables host-side | **Confirmed** (`bridge.js:101`, `:329-333`) — and it is the right carrier |
| — | PROJECT-NOTES: `GetNumTalentTabs`/`GetTalentInfo` "both **removed in Forever**" | **Half right, badly stated.** `GetNumTalentTabs` is genuinely absent. `GetTalentTabInfo` and `GetTalentInfo` **exist on Forever as load-gated shims — but the gate excludes camelot**, so they are *not callable* on Forever. The practical outcome matches the note; the mechanism does not. |
| — | PROJECT-NOTES: `StatForge` targets `## Interface: 11508` | **Stale** — the on-disk toc is `11509, 16001, 120100` (`StatForge.toc:1`) |
| — | "Is the Professions line absent for the same reason?" | **No.** It is a *character-state* explanation. And the primer is wrong about which API to call. |

**The find that matters most:** StatForge's bank reader is broken on Forever and would silently
report *wrong containers*, not an error. `SF.BANK_BAGS = { -1, 5, 6, 7, 8, 9, 10, 11 }`
(`Constants.lua:38`) assumes the Classic-Era `BagIndex` layout. On Forever `-1` is **Keyring**,
`5` is **ReagentBag**, and the bank lives at **6–14** (character) and **15–23** (account).
Reusing StatForge without fixing this would hand the agent a confident, wrong answer about the
bank — the single most valuable thing in this phase.

---

## 1. Evidence base and method

**Branch pinning (this is the load-bearing methodological step).** "Forever" is not a
reputation, it is a build number. The mirror carries it in `version.txt`:

| Branch | `version.txt` |
|---|---|
| `forever` | `1.60.1.70009` |
| `classic_era` | `1.15.9.69722` |

The live client string in `bridge/state.json` is
`World of Warcraft: Forever (client 1.60.1.70009, interface 16001)`. **Byte-exact match.** So the
`forever` branch I grepped *is* the code the running client ships.
(`classic_era@1.15.9.69722` is used below as a control: the same greps run against it and find
what Forever lacks. A zero-hit grep is only meaningful if the same grep produces hits elsewhere.)

Source: `Gethe/wow-ui-source`, branch `forever`, full tarball extracted and grepped locally
(6,389,217 bytes). GitHub's code-search API returned 401 "Requires authentication"; the tarball
grep is the workaround and is stronger anyway — it covers the whole tree.

**Mirror caveat, stated plainly.** There is no `git` history in the tarball, so I cannot date a
change; I can only report the state of `1.60.1.70009`. And the *live installed client* ships no
loose Blizzard Lua — `_classic_beta_/Interface/AddOns/` contains **0** `Blizzard_*` directories
(201 entries, all third-party plus the user's own). Blizzard's UI there lives in CASC archives.
So "the mirror is the client" is an inference from the exact version-string match, not a direct
read of the client's own files. It is a very strong inference; it is not proof. See §9.

**A methodological trap that cost me time, flagged so a verifier avoids it.** Grepping
`Blizzard_APIDocumentationGenerated/` alone gives false negatives — that tree covers only part
of the API surface. And grepping for a bare name counts *call sites*, not *definitions*. Both
mistakes produce a confident wrong answer here. Every claim below is grounded in either a
definition site, a `.toc` load gate, or a `Blizzard_*` call site, and each is cited.

---

## 2. The talent question — answered

### 2.1 What the docs claim, verbatim

`docs/whisperstone/PROJECT-NOTES.md:191-193`:

> **5. Phase C — StatForge → Forever** (separate project). `StatForge` targets Classic Era
> (`## Interface: 11508`) and calls `GetNumTalentTabs` / `GetTalentInfo`, both **removed in
> Forever**. That is a port, not a config change.

`docs/WOW-ADDON-PRIMER.md:9`:

> Vanilla-era systems (talent tabs, skill lines, weapon skills) keep the classic functions:
> `GetTalentTabInfo`, `GetTalentInfo(tab, i)`, `GetNumSkillLines`, `GetSkillLineInfo(i)`;
> verify in game.

**These two documents contradict each other**, and the card is right that one of them is
misleading the agent. The primer is the wrong one.

### 2.2 What is actually true

Three separate facts, which the docs collapse into one:

**Fact A — `GetNumTalentTabs` is genuinely absent from Forever.** Zero occurrences in the entire
tree, including generated docs:

```
grep -rIn "GetNumTalentTabs" wow-ui-source-forever | wc -l   →  0
```

Control, same grep on `classic_era` → **46** hits, in real UI code:
`Blizzard_TalentUI/Classic/Blizzard_TalentUI.lua:515`,
`Blizzard_FrameXML/Classic/TalentFrameBase_Shared.lua:327`,
`Blizzard_InspectUI/Classic/InspectTalentFrame.lua:46`.

So `WoWAI.GameContext()`'s `Try(GetNumTalentTabs)` (`WoWAI.lua:1014`) is a **dead call on
Forever**. It returns `nil` from `Try` (`WoWAI.lua:933-937`), the `type(tabs) == "number"` guard
fails, and the Talents line is never appended. The note is right about this one.

**Fact B — `GetTalentTabInfo` *is* defined on Forever, as a deprecated shim.**
`Blizzard_DeprecatedSpecialization/Deprecated_Specialization_Vanilla.lua:10`:

```lua
GetTalentTabInfo = function(specializationIndex, isInspect, isPet, groupIndex)
    ...
    local specId, name, description, icon, role, primaryStat, pointsSpent, ... =
        C_SpecializationInfo.GetSpecializationInfo(...)
    return specId, name, description, icon, pointsSpent, background, previewPointsSpent, isUnlocked;
end
```

and `:38` defines `GetTalentInfo` the same way, over `C_SpecializationInfo.GetTalentInfo`
(`:45`). Note the return list is a **re-pack**, not a passthrough: position 5 is `pointsSpent`,
where the old signature had different neighbours.

**Fact C — but the shim's addon does not load on camelot.** This is the fact that resolves
everything. `Blizzard_DeprecatedSpecialization/Blizzard_DeprecatedSpecialization.toc:3`:

```
## AllowLoadGameType: classic, standard
```

Forever's game type is **camelot**. `camelot` is not in that list, so
`Blizzard_DeprecatedSpecialization` — the only thing in the tree that would define
`GetTalentTabInfo` — **never loads on Forever**.

### 2.3 Therefore

`GetNumTalentTabs`, `GetTalentTabInfo`, `GetTalentInfo` and `GetNumTalents` are all effectively
**unavailable on Forever**. PROJECT-NOTES' conclusion is correct; its stated reason
("both removed in Forever") is imprecise, because two of the three are present in the source
tree and merely gated out. The distinction matters for the fix (§2.5): "removed" suggests
nothing to call, whereas the truth is "there is a modern namespace to call instead."

Supporting evidence that `GetNumTalents` is likewise gone as a global: exactly **one**
occurrence in the tree, and it is inside a Cata-era file —
`Blizzard_FrameXML/Cata/TalentFrameBase.lua:67`. Nothing loads that on camelot.

### 2.4 Was the talent line absent because the character is level 9?

**The card's hypothesis is wrong, and this is the useful part.** Forever grants the first talent
point at **level 10** (warcraft.wiki.gg, *Talent*: "One talent point is earned each level
starting at level 10"; corroborated by wowclassic/zockify: "at level 10 you'll receive your
first talent point") — so a level-9 warlock *should* have no talents to report, and you might
expect the line to be absent for that benign reason.

But the API is **also** absent (Fact A + Fact C). Level 9 and API removal are *both* true, and
they are **indistinguishable from the live context alone**. The card is right to distrust the
absence as evidence either way.

The two are trivially separable, and I resolved it without a client by checking the source of
the code that *would* define it. No in-game probe is needed for the API half of this question.

### 2.5 Consequence for the addon (for the implementation card, not this one)

`WoWAI.lua:1013-1024` is dead code on the product it targets. It should read the spec instead of
the tab list. On Forever the live path is `C_SpecializationInfo`:

- `SpecializationInfoDocumentation.lua:5` — `Namespace = "C_SpecializationInfo"`
- `:237` `GetSpecialization`, `:254` `GetSpecializationInfo`, `:316` `GetTalentInfo`

and there is **no** `GetNumTalentTabs` equivalent in that namespace
(`SpecializationInfoDocumentation.lua:41-316`): the modern API does not expose a tab count at
all. A talent summary on Forever should therefore be built from `GetSpecialization()` →
`GetSpecializationInfo(specIndex)` → active spec name/points, not from a tab loop. This is a
real signature change, not a rename — the same trap that makes StatForge's talent section
(`Snapshot.lua:563-570`, which requires `GetNumTalentTabs`, `GetNumTalents` **and**
`GetTalentInfo` and `error()`s if any is missing) unsalvageable on Forever as written.

---

## 3. The professions question — answered

### 3.1 What the docs claim

`WoWAI.lua:1026-1042` calls the **legacy globals** `GetNumSkillLines` / `GetSkillLineInfo`, per
`WOW-ADDON-PRIMER.md:9` ("Vanilla-era systems … keep the classic functions: `GetNumSkillLines`,
`GetSkillLineInfo(i)`").

### 3.2 What is actually true

**The primer is wrong here too — and this is a bug, not a style preference.** Forever has no
bare `GetNumSkillLines` or `GetSkillLineInfo`. Both exist **only** as `C_SkillInfo.*`
(`SkillInfoDocumentation.lua:5` — `Namespace = "C_SkillInfo"`; `:41` `GetNumSkillLines`;
`:59` `GetSkillLineInfo`; `:74` `GetSkillLineInfoByID`). The only non-namespaced occurrences of
those names anywhere in the tree are those three *documentation entries* — i.e. zero call sites
and zero definitions of the bare form.

Blizzard's own Forever UI uses the namespaced form, in the Camelot skills frame:
`Blizzard_UIPanels_Game/Camelot/SkillsFrame.lua:178,179,201,202,244` →
`C_SkillInfo.GetNumSkillLines()` / `C_SkillInfo.GetSkillLineInfo(index)`.

There is **no** skill shim: `Blizzard_Deprecated*` contains no SkillInfo addon, and the one
ungated shared deprecation file defines exactly one global —
`Blizzard_Deprecated/Shared/Deprecated_12_1_0.lua:75`:
`GetInspectSpecialization = C_SpecializationInfo.GetInspectSpecialization;` — nothing else
talent/skill/inventory related.

So `WoWAI.lua:1027` `Try(GetNumSkillLines)` is a **second dead call on Forever**, for a
different reason than talents: the function exists, but only under a namespace. Unlike the
talent case, this one is **fixable by a rewrite**, and should be fixed.

**Second defect in the same block — a return-shape change.** `WoWAI.lua:1032` destructures:

```lua
local sname, isHeader, _, rank, _, _, maxRank = Try(GetSkillLineInfo, i)
```

The classic global returned ~13 positional values. `C_SkillInfo.GetSkillLineInfo(i)` returns a
**single table** (`SkillInfoDocumentation.lua:59-71`; `SkillLineAttributes` at `:113` with
fields `name`, `isHeader`, `rank`, `maxRank`, `skillID`, `parentSkillLineID`,
`skillLineCategoryID`, …). Even after fixing the name, this destructure would read the whole
field list into `sname` and nothing into `isHeader` — silently producing garbage rather than an
error. The card's instinct to distinguish "API fault" from "character fact" was right, and the
answer is *both*: an API fault **and** a character fact.

### 3.3 Is the Professions line absent because the character has no professions?

**Yes — this half is a character-state explanation.** Professions require level 5 to learn
(warcraft.wiki.gg, *Profession* proficiency table: "Classic proficiency | Min level **5**";
corroborated by wowhead's Classic professions guide and zockby: "Apprentice: requires character
level 5"). The live character is **level 9**, so they *could* have trained one but may simply
never have. Either way, a level-9 character legitimately reporting no professions is a
character fact, not an API fault.

But the line would be absent **regardless**, because of §3.2: the call is dead. The honest
summary is:

> The Professions line is absent for *two* independent reasons — the character may genuinely
> have no professions, **and** the API is called wrong. Fixing the API will not make the line
> appear on this character unless the character actually has a profession.

### 3.4 The correct implementation (for the next card)

Follow Camelot's own filter rather than inventing one — `SkillsFrame.lua:162-164`:

```lua
local function ShouldShowSkillLine(skillInfo)
    return (not skillInfo.isHeader and not HIDDEN_SKILL_LINE_CATEGORIES[skillInfo.skillLineCategoryID]) or
                            (skillInfo.isHeader and not HIDDEN_SKILL_LINE_CATEGORIES[skillInfo.skillID]);
end
```

with `HIDDEN_SKILL_LINE_CATEGORIES = { [7] = true } -- Class Skills` (`:30-32`) and
`DEFENSE_SKILL_ID = 95` (`:34`). Camelot distinguishes professions by
`skillLineCategoryID` on the `SkillLineAttributes` table — **not** by comparing a header string
to `TRADE_SKILLS` / `SECONDARY_SKILLS` as `WoWAI.lua:1030` does. Header-string matching is
locale-fragile; category-id matching is not.

---

## 4. Carrier decision — which payload goes where

**Decision: two carriers, split by size and churn.**

| Payload | Carrier | Why |
|---|---|---|
| **Summary** (equipped count, core stats, freshness stamp, bank size) | the existing `gameContext` slot | Fits, and it is the thing an agent needs *without* a round trip |
| **Full detail** (every equipped item with stats, full bank, full bags) | host-side SavedVariables read | No strip cost, no `/reload`, unbounded size |

### 4.1 Why not put everything in the context slot

Three reasons, in order of severity:

1. **It replaces, it does not merge.** `bridge.js:343`:
   `state.context = text ? { text, at: Date.now(), session: ... } : null;` Anything not
   resent disappears. Confirmed exactly as the card suspected.

2. **It can be silently deferred, and then the agent sees stale data.** `WoWAI.lua:1052-1057`:

   ```lua
   local function ContextToSend(room)
       local ctx = db.settings.context and WoWAI.GameContext() or ""
       if ctx == (run.contextSent or "") then return nil end
       if room and #ctx > room then return nil end
       return ctx
   end
   ```

   The context only rides a record if there is `room` for it next to the message; the comment at
   `:1049-1051` says it "goes with a later one." So **a bigger context is sent less often.** Grow
   the context from 234 to ~400 bytes and a large outgoing message no longer leaves room for it,
   the context is deferred, `run.contextSent` still holds the *old* text, and the bridge keeps
   serving the older context. The agent then answers confidently about gear the player already
   replaced — precisely the failure mode the card calls out in its freshness question. **This is
   the strongest argument for keeping the context block small**, and it is stronger than the raw
   700-byte cap.

3. **Truncation fails silently.** `WoWAI.lua:1045`:
   `if #s > CONTEXT_MAX then s = s:sub(1, CONTEXT_MAX) end`. It chops the tail with no marker.
   Because `GameContext()` appends in order (`:958` game, `:976` character, `:982` location,
   `:1001` position, `:1011` money/XP, `:1023` talents, `:1041` professions), any new lines
   appended at the end are **exactly** what dies first — the agent then silently loses gear or
   stats while still looking like it has a context. A truncated context must carry a marker.

### 4.2 The host-side lane, precisely

`bridge.js:101`:

```js
const SAVED_VARS = String(cfg.savedVariablesFile || '').replace(/WoWClaude\.lua$/, 'WoWAI.lua');
```

resolved from `bridge/config.json` `savedVariablesFile` =
`/mnt/c/Program Files (x86)/World of Warcraft/_classic_beta_/WTF/Account/635366#4/SavedVariables/WoWAI.lua`.

The read is already implemented and already polled: `readOutbox()` at `bridge.js:329-333`
(`fs.readFileSync`, `catch { return null }`), called by `pollSavedVariables()` at `:611-616`,
driven on `cfg.pollMs || 750` (`:687`, config `pollMs: 750`). It currently parses the
**outbox** via `P.parseOutbox` and is gated on `fs.statSync(SAVED_VARS)` mtime (`:613`).

**So the carrier exists and is polled every 750 ms. It is the right home for the bank.** Exactly
which file and key:

- **File:** the same `SAVED_VARS` path — `WTF/Account/635366#4/SavedVariables/WoWAI.lua`.
  (Not a new path: adding a second file means a second path in config and a second
  Windows/WSL path-translation surface. Reuse the one that already works.)
- **Key:** a new top-level SavedVariables table written by WoWAI, sibling to the existing
  outbox data — e.g. `WoWAI_DB_*["snapshot"]`. **One file, two readers**: `parseOutbox` keeps
  the prompt lane, a new reader takes the snapshot lane. They must not share a key, or one
  parser's schema change breaks the other.
- **Write trigger:** `BANKFRAME_CLOSED` and `PLAYER_EQUIPMENT_CHANGED`, plus a manual
  `/wow-ai snapshot` — the same shape of trigger StatForge already uses (its bank cache is
  wired to `BANKFRAME_OPENED`/`BANKFRAME_CLOSED` at `Core.lua:23,24,33-46`, with the
  live-vs-cached decision on `SF.bankOpen` at `Snapshot.lua:225`).

**Absent or stale file — required behaviour.** `readOutbox` already returns `null` on a missing
or unreadable file (`bridge.js:331`). The snapshot reader must do the same and must **not**
invent an empty bank. The bridge should pass the snapshot's own timestamp into the prompt so the
agent can say "as of 14:11" rather than assert present tense. A missing snapshot must degrade to
*no bank section*, never to *an empty bank*.

---

## 5. The minimum useful snapshot — with byte arithmetic

### 5.1 Principle

The card asks for what an agent can *reason* with. Ranking, highest value per byte:

1. **Item name + slot** beats a raw item id — the agent cannot reason about `2140`.
2. **A stat total** beats a full sheet.
3. **A freshness stamp** beats both, because it decides whether the other two are usable.

### 5.2 Measured arithmetic

Measured, not estimated (`python3`, see scratch harness). Current live context, 5 lines,
**234 bytes** — re-read from `bridge/state.json` during this card, with values that had moved
since the card was written (`Position: 56.1, 46.9`, `Money: 30s 5c; XP: 4931/6500`), which
independently proves the lane is live and re-sending:

```
 1: [ 71] Game: World of Warcraft: Forever (client 1.60.1.70009, interface 16001)
 2: [ 67] Character: Nous on Classic Beta PvE, level 9 Undead Warlock (Horde)
 3: [ 33] Location: Tirisfal Glades - Brill
 4: [ 31] Position: 56.1, 46.9 (map 1420)
 5: [ 28] Money: 30s 5c; XP: 4931/6500
    → 230 line bytes + 4 newlines = 234
```

Proposed additions, worst case, 19 slots (StatForge uses 19 equipment slots —
`SF.EQUIPMENT_SLOTS = 19`, `Constants.lua:16`; its `SLOT_NAMES` at `:40-59` is the canonical
19-entry slot list) and real vanilla-plausible low-level item names:

| Line | Bytes |
|---|---|
| `Stats: HP 340, Mana 210, Armor 96, Str 18, Agi 16, Sta 22, Int 19, Spi 21` | 73 |
| `Gear: 7 of 19 slots filled (12 empty)` | 37 |
| `Snapshot: gear+stats 15:02; bank 14:11 (cached)` | 47 |
| **Proposed total** = 234 + 74 + 38 + 48 | **394** |
| vs cap 700 | **slack 306 (56% of cap)** |
| share of `Codec.MAX_PAYLOAD` 3200 | **12.3%** |

### 5.3 Refuting card claim #3

The card estimated a 16-slot `"Slot=Name(id)"` listing at ~352 bytes. I generated the listing
instead of estimating it (`Slot=Name`, one newline-terminated line per filled slot, plausible
vanilla low-level names averaging 18.7 bytes each — reproducible via the scratch harness in §9):

```
  16 filled slots:  437 bytes  (312 name bytes + 125 of "Slot=" + newline)
  19 filled slots:  503 bytes  (355 name bytes + 148 overhead)
```

That is **85 bytes over the card's estimate for 16 slots**, and the estimate was optimistic in
the direction that mattered — the card used it to argue the remainder was comfortable.

Consequences (all against the measured current context, **234 bytes**):

- 16 slots alone — `234 + 437 = 671` — leaves **29 bytes**. Not the comfortable margin implied.
- adding the stats line — `234 + 437 + 74 = 745` — is **OVER the 700 cap by 45**. At that point
  `WoWAI.lua:1045` silently truncates and the *stats* (or the tail of the gear list) dies.
- a full 19-slot character is worse: `234 + 503 = 737`, over the cap with **no stats line at all**.
- and per §4.1(2), a 671-byte context rarely fits next to a real message, so it gets deferred and
  the agent reads stale gear.

**Therefore the recommendation: do not put the itemised gear list in the context slot.** Put in
the context only the compact form above (394 bytes), and put the itemised list on the host lane.

### 5.4 The two encodings, concretely

**Context slot (394 bytes, ~12% of payload) — stable, low-churn, no item names:**

```
Stats: HP 340, Mana 210, Armor 96, Str 18, Agi 16, Sta 22, Int 19, Spi 21
Gear: 7 of 19 slots filled (12 empty)
Snapshot: gear+stats 15:02; bank 14:11 (cached)
```

Deliberate choices: counts and totals rather than names (names are in the host lane); an
explicit empty-slot count, which tells the agent something actionable ("you have 12 empty slots")
in 37 bytes; and a timestamp on each half, because gear and bank go stale at different rates
(§6).

**Host lane (unbounded, full detail):** JSON, one object per item, the StatForge shape already
proven — StatForge writes `StatForgeDB.exports[SF.CharKey()] = json` (`Snapshot.lua:812`) with
per-section `pcall` isolation across sections `meta, identity, talents, stats, equipped, bags,
bank` (`Snapshot.lua:274-280`). Reuse that section vocabulary so the two projects stay legible
against each other.

---

## 6. Freshness and staleness

**Split the refresh by churn rate, not by convenience.**

| Section | Churn | Refresh trigger | Acceptable age |
|---|---|---|---|
| equipped + stats | every equip / level / buff | `PLAYER_EQUIPMENT_CHANGED`, `PLAYER_LEVEL_UP`, manual | seconds |
| bank | rare (deposit/withdraw) | `BANKFRAME_CLOSED`, manual | hours |

**What the agent gets when data is 20 minutes old:** the timestamp, in the prompt, adjacent to
the data — `Snapshot: gear+stats 15:02; bank 14:11 (cached)`. The card's premise is exactly
right — "a confident answer built on stale gear is worse than 'I don't know your gear'" — and
the fix is not to hide stale data but to **label** it. Per-section stamps, because a single
global stamp is wrong when the bank is hours old and the gear is seconds old.

Two specific staleness traps already present in the code that the implementation must respect:

1. **`ContextToSend`'s equality gate.** `WoWAI.lua:1054`: `if ctx == (run.contextSent or "") then
   return nil end`. Because the proposed context contains a timestamp, it *always* differs from
   the last one, so it will be sent on every record it fits next to — which is a cost increase
   the current 234-byte context does not have today. If that cost matters, drop the timestamp
   from the context line and keep it only in the host snapshot; the tradeoff is real and should
   be decided by measurement.
2. **StatForge's closed-bank fallback is correct and worth copying.**
   `Snapshot.lua:236-237`: if a live scan yields zero items while a cache exists, it keeps the
   cache (`if #items == 0 and StatForgeDB.bankCache[SF.CharKey()] then return end`); and
   `:244-252` prefers the cache when the bank frame is open, explicitly to avoid "a bank that
   disagrees with what the player is looking at." That is the right instinct — a live read that
   disagrees with the screen is worse than a labelled cached read.

---

## 7. Degradation on an unverified client

Follow StatForge's precedent: **per-section isolation, never let one absent API cost the whole
payload.** StatForge's design notes that "Forever's client profile is unverified" so a missing
API is expected (`Snapshot.lua:300`, `:376-382`: "*ABSENCE is deliberately not recorded: an
absent `UnitDefense` or AP getter*"). On Forever specifically, the APIs that need care:

- `UnitDefense` is **not** the right name on Forever. Forever's own character sheet calls
  `UnitDefenseSkill(unit)` → `(base, modifier)`:
  `Camelot/PaperDollFrameStats.lua:50`, `Camelot/PaperDollFrame.lua:747`,
  `Camelot/SkillsFrame.lua:207`, and mainline `Mainline/PaperDollFrame.lua:724`. The doc entry is
  `UnitDocumentation.lua:1069 Name = "UnitDefenseSkill"`. `UnitDefense` appears in
  `UnitDocumentation.lua:4198` **only as an event** (`UNIT_DEFENSE`), not a function — so
  StatForge's `UnitDefense("player")` call (`Snapshot.lua:376-377`, `Probe.lua:132`,
  `Diagnostics.lua:70`) is a **second Forever defect**. It is guarded
  (`if UnitDefense then`, `Snapshot.lua:376`) so it degrades rather than throws — the guard is
  the reason this is a quality bug and not a crash.
- **Restricted stats is a Forever-specific hazard the primer does not mention.** Eleven Forever
  unit functions carry `SecretWhenUnitStatsRestricted = true`
  (`UnitDocumentation.lua`, e.g. `:1069` on `UnitDefenseSkill`): `GetUnitSpeed`, `UnitArmor`,
  `UnitAttackPower`, `UnitAttackSpeed`, `UnitDamage`, `UnitDefenseSkill`,
  `UnitRangedAttackPower`, `UnitRangedDamage`, `UnitSpellHaste`, `UnitStat`,
  `UnitWeaponAttackPower`. StatForge requires `UnitStat`, `UnitArmor`, `UnitAttackPower` as
  **hard** requirements (`Snapshot.lua:317,321,322` — `required(...)`). On a restricted map
  those can return a *secret* value rather than a number. **Any stats read must be wrapped in
  `pcall` and must `type()`-check its returns as numbers before formatting them into a string** —
  a secret value interpolated into the context text would be at best noise and at worst a
  payload-corrupting surprise. This is a concrete, Forever-specific requirement.

**What the agent sees when a section is missing:** the section is simply absent from the
snapshot, and the prompt says so if any section is missing — e.g. a `Stats:` line omitted
entirely rather than emitting `Str nil`. Never emit a formatted line built from `nil`; the
current `Money()` helper (`WoWAI.lua:939-945`) is the right pattern (it coerces and defaults),
and `Try` (`:933-937`) is the right guard. Where a section is missing, prefer silence plus a
one-line note over plausible-looking zeros. **Zeros are worse than absence** because the agent
will reason on them.

---

## 8. Reuse vs reimplement — the decision, argued

**Decision: split it. Reuse StatForge's *approach and JSON vocabulary* on the host lane;
reimplement a small summary reader in WoWAI for the context slot; and fix two StatForge defects
before either is relied on.**

The tradeoff, named honestly:

- **Reuse means** a third-party dependency and a coordination problem: StatForge is a separate
  project with its own card lane, its own install, and its own SavedVariables
  (`StatForgeDB`). Depending on it means two addons must both be installed and both be working
  for the agent to know anything, and a StatForge refactor can silently break Whisperstone.
- **Reimplement means** duplicating Forever-fragile API work that StatForge has already paid
  for and hardened — the per-section isolation and the degradation discipline in
  `docs/DEGRADATION.md` are genuinely good and not free to reproduce.

**Why the split resolves it:**

1. **The context slot cannot be served by StatForge at all.** It needs 394 bytes of summary text
   inside WoWAI's own Lua, generated in-process on an equipment-change event. StatForge's
   `exports` are JSON written to SavedVariables on an explicit action
   (`ExportTab.lua` manual export; `Snapshot.lua:812`). Reading a JSON export to build a context
   string would mean a `/reload` or a file round-trip for data the addon can read directly. So
   the summary reader must live in WoWAI regardless — the question is only whether the *large*
   payload is reused, and for that, see 2 and 3.

2. **For the large payload, reuse is right — but it must be the *file*, not the *addon*.**
   The host lane reads WoWAI's own `SAVED_VARS`. Making the bank ride there means WoWAI writes a
   compact item list at bank-close, which is ~30 lines of `C_Container` iteration against a
   proven API. It does **not** require depending on StatForge being installed. StatForge's value
   here is its *hard-won knowledge* (which APIs, what breaks, which sections to isolate), not its
   runtime presence. Reusing the knowledge and reimplementing the 30 lines is cheaper and safer
   than a runtime dependency.

3. **The decisive argument: StatForge's bank reader is currently wrong on Forever, so "reuse"
   without a fix would import a silent correctness bug.** See §0 and §8.1. A dependency that is
   confidently wrong about the highest-value payload is worse than no dependency.

**Therefore: do not add a StatForge runtime dependency. Instead (a) fix StatForge's two defects
under their own card, and (b) have WoWAI read what it needs directly, using StatForge's
degradation discipline and JSON section vocabulary as the template.**

### 8.1 The StatForge defects, precisely — for a separate card

**Defect 1 — bank reader targets the wrong containers (silent, high impact).**
`Constants.lua:37-38`:

```lua
-- container -1 = fixed bank slots; bags 5-11 = bank bags
SF.BANK_BAGS = { -1, 5, 6, 7, 8, 9, 10, 11 }
```

That is the Classic-Era layout. Compare the two `BagIndex` enums (both read in full from source):

| Name | `classic_era` | `forever` |
|---|---|---|
| `Accountbanktab` | -5 | **-3** |
| `Bankbag` | -4 | *does not exist* |
| `Reagentbank` | -3 | *does not exist* |
| `Keyring` | -2 | **-1** |
| `Bank` | -1 | *does not exist* |
| `Backpack` | 0 | 0 |
| `ReagentBag` | 5 | 5 |
| bank bags | `BankBag_1..7` = **6..12** | `CharacterBankTab_1..9` = **6..14** |
| account bank | `AccountBankTab_1..5` = **13..17** | `AccountBankTab_1..9` = **15..23** |
| `NumValues` / `MinValue` / `MaxValue` | 23 / -5 / 17 | **27 / -3 / 23** |

Sources — `forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/BagIndexConstantsDocumentation.lua`:
`:20-22` (`NumValues = 27`, `MinValue = -3`, `MaxValue = 23`); `:25` `Accountbanktab = -3`;
`:26` `Characterbanktab = -2`; `:27` `Keyring = -1`; `:28` `Backpack = 0`; `:33` `ReagentBag = 5`;
`:34-42` `CharacterBankTab_1..9 = 6..14`; `:43-51` `AccountBankTab_1..9 = 15..23`.
`classic_era/Interface/AddOns/Blizzard_APIDocumentationGenerated/BagIndexConstantsDocumentation.lua`:
`:20-22` (`NumValues = 23`, `MinValue = -5`, `MaxValue = 17`); `:25-27` `Accountbanktab = -5`,
`Bankbag = -4`, `Reagentbank = -3`; `:28-30` `Keyring = -2`, `Bank = -1`, `Backpack = 0`;
`:35-42` `ReagentBag = 5`, then `BankBag_1..7 = 6..12`; `:43-47` `AccountBankTab_1..5 = 13..17`.

Note there is no Forever enum member named `Bank` **at all** — the fixed-bank-slots container that
StatForge's first entry targets simply does not exist as a `BagIndex` on this client.

*Caveat a verifier should hold:* I did **not** verify StatForge's list against a live Classic-Era
client, and I am not claiming it is right there — `classic_era` also carries
`ITEM_INVENTORY_BANK_BAG_OFFSET = 4` ("Number of bags before the first bank bag",
`Blizzard_FrameXMLBase/Classic/Constants.lua:201`), which is not obviously consistent with the
enum's `ReagentBag = 5`. That inconsistency is a Classic-Era question, out of scope here. **What
is decidable from source is that the list is wrong on Forever**, which is the case that matters.

The authoritative id for a Forever bank container is **not** a hard-coded list at all — Blizzard
asks the client. Forever's own bank frame does, at `Camelot/BankFrame.lua:91,98`:

```lua
local bankTabData = C_Bank.FetchPurchasedBankTabData(bankType);
...
totalSlots = totalSlots + C_Container.GetContainerNumSlots(tabData.ID);
```

i.e. *enumerate the purchased tabs, read each tab's `.ID`, then read that container.* That is the
pattern the implementation should copy — it survives tab-count changes, which any hard-coded list
cannot (and this enum has already changed shape once between branches).

On Forever, `SF.ScanContainers(SF.BANK_BAGS)` (`Snapshot.lua:166-181`, driven from
`Snapshot.lua:217`) therefore scans:

- `-1` → **Keyring** (not the bank),
- `5` → **ReagentBag** (a player bag, not the bank),
- `6..11` → the first six character bank tabs (correct by accident, and incomplete: `12..14`
  are missed, as is the entire account bank at `15..23`).

StatForge would report a bank that is part keyring, part reagent bag, part bank, and missing the
account bank — **and report no error at all**, because `NumSlots()` returning 0 for an empty
container is indistinguishable from a valid empty container.

**Defect 2 — talent section cannot work on Forever.**
`Snapshot.lua:563-570` requires all three of `GetNumTalentTabs`, `GetNumTalents`,
`GetTalentInfo` and `error()`s if one is missing. Per §2.2 all three are unavailable on Forever
(`GetNumTalentTabs` absent entirely; `GetNumTalents` present only in an unloaded Cata file;
`GetTalentInfo` gated out with `camelot`). The section is already `pcall`-isolated so it degrades
instead of crashing — but it will always be *absent* on Forever, which means StatForge's talent
data is permanently empty there. That is a known-limitation to document or a section to rewrite
against `C_SpecializationInfo`.

**Also stale, worth correcting in the docs:** PROJECT-NOTES says StatForge "targets Classic Era
(`## Interface: 11508`)" — the on-disk toc is `## Interface: 11509, 16001, 120100`
(`StatForge.toc:1`), so 16001 (Forever) is already declared, as the card noted. Installing it in
the beta is viable from a *toc* standpoint; the §8.1 defects are what make it wrong in practice.
(For completeness: StatForge is **not installed** in any WoW install on this machine — checked
`_classic_beta_`, `_classic_era_`, `_anniversary_`, `_retail_`; no `StatForge*` dir, no
`StatForge*` SavedVariables. That is a deliberate absence, not a defect.)

---

## 9. What remains unknown — needs a live client

Named deliberately. A spec that pretends to be complete is worse than one that names its gaps.

1. **Whether the `forever` mirror matches the installed beta byte-for-byte.** The version string
   matches exactly (`1.60.1.70009`), but the installed client ships no loose Blizzard Lua (0
   `Blizzard_*` dirs), so this is inference from a version number, not a read of the client's
   files. **Settles it:** `/dump GetBuildInfo()` and compare all four returns; then
   `/dump type(GetTalentTabInfo)`, `/dump type(C_SkillInfo.GetNumSkillLines)`,
   `/dump type(GetNumTalentTabs)`.
2. **Whether `loadDeprecationFallbacks` is on in the live client.** Every `Blizzard_Deprecated*`
   file returns immediately if not (`Deprecated_Specialization_Vanilla.lua:4-6`;
   `Shared/Deprecated_12_1_0.lua:5-7`). If a shim *were* loaded and this CVar on, some legacy
   globals could exist that the source tree says are gated out — this is exactly the "temporary
   shim" the primer warns about, and it is the one path by which my talent conclusion could be
   wrong. **Settles it:** `/dump GetCVarBool("loadDeprecationFallbacks")` and
   `/dump type(GetTalentTabInfo)` together.
3. **The character's actual professions.** Level 9 with or without a profession is
   indistinguishable from the context block. **Settles it:** open the Skills tab, or
   `/dump C_SkillInfo.GetNumSkillLines()`.
4. **The real byte cost of a genuine gear string on this character.** Measured here from
   generated plausible names: **437 bytes for 16 filled slots**, **503 for all 19**. Real names
   vary around an 18.7-byte mean. **Settles it:** build the real string in game and print `#s`,
   then compare against the 234-byte context baseline.
5. **Whether `UnitStat`/`UnitArmor`/`UnitAttackPower` return secrets on the maps this character
   plays.** The `SecretWhenUnitStatsRestricted` flags (`UnitDocumentation.lua`, 11 functions at
   `:337, 647, 666, 684, 1049, 1071, 2946, 2964, 3134, 3200, 3427`) describe a capability; only
   the live client says whether it bites in open world. **Settles it:** `/dump UnitStat("player", 1)`
   on a restricted map (instance/dungeon) versus in the open world.
6. **Bank tab count and whether the account bank is reachable at level 9.** Forever has tabbed
   banks (`C_Bank`, `BankDocumentation.lua:3,5`; `Enum.BankType.Character/Guild/Account`,
   `ItemConstantsDocumentation.lua:24-26`), and purchase state is per-character
   (`C_Bank.FetchPurchasedBankTabData`, `:241`). Whether a level-9 character has any bank tabs at
   all is unverified. **Settles it:** open the bank, or
   `/dump C_Bank.FetchNumPurchasedBankTabs(Enum.BankType.Character)`.
7. **Whether the whole-tree grep missed dynamically-created globals.** I searched source text; a
   global created at runtime by `setglobal(var, val)` (`Shared/Deprecated_12_1_0.lua:15-19`) from
   a string would not appear as a definition site, though it would appear as a call site. I found
   no such pattern for the talent/skill names, but a runtime probe is the only proof.

---

## 10. Boundaries — still holding

- **No memory reading, no synthetic input, no combat/protected APIs.** Everything proposed is
  plain addon API: `UnitStat`/`UnitArmor`/`UnitAttackPower`/`UnitDefenseSkill`, `GetItemInfo`/
  `C_Item.GetItemInfo`, `GetInventoryItemLink`/`GetInventoryItemID`, `C_Container.*`, `C_Bank.*`,
  `C_SkillInfo.*`, `C_SpecializationInfo.*`, plus file reads on the host side of a SavedVariables
  file the addon itself writes. No write to game state beyond SavedVariables.
- **`GetInventoryItemLink` is a bare global on Forever — confirmed, with call sites.** Unlike the
  talent/skill cases this one *is* bare: 15 bare call sites, 0 namespaced, e.g.
  `Camelot/PaperDollFrame.lua:2140,2179,2187`, `Mainline/ContainerFrame.lua:1478,2019`,
  `Mainline/PaperDollFrame.lua:1913,1952,1960`, and — the clearest tell, because the modern
  *inspect* UI uses it too — `Blizzard_ChatFrameBase/Shared/ChatFrameUtil.lua:1208`. So
  `GetInventoryItemLink` (equipped)
  and `GetContainerItemLink` (bags/bank, **namespaced**: `C_Container.GetContainerItemLink`,
  5 call sites + doc at `ContainerDocumentation.lua:209`, 0 bare) are a legitimate, asymmetric
  pair — the implementation must not assume symmetry. StatForge's wrapper already handles this
  correctly: `ItemLinkAt` tries `C_Container` first then `_G.GetContainerItemLink`
  (`Snapshot.lua:86-95`), and `NumSlots` likewise (`:75-84`).
- **Some unit/aura reads can be restricted on restricted maps in Forever** — see §7. This is a
  *read* restriction, not a boundary violation, but it must be handled by `pcall` + type checks.

---

## 11. Recommended doc corrections (not applied — no-write constraint)

The repo's Lua is being edited by another worker (`t_311fcc43`), and this card must not write
code. These are *documentation* corrections for whichever card owns the docs:

1. `WOW-ADDON-PRIMER.md:9` — the sentence "Vanilla-era systems (talent tabs, skill lines, weapon
   skills) keep the classic functions: `GetTalentTabInfo`, `GetTalentInfo(tab, i)`,
   `GetNumSkillLines`, `GetSkillLineInfo(i)`" is **wrong for Forever** and is actively misleading
   the agent. Replace with: talent/skill globals are **not** available on Forever
   (`GetNumTalentTabs` absent; `GetTalentTabInfo`/`GetTalentInfo` gated out by
   `AllowLoadGameType: classic, standard`); use `C_SpecializationInfo` and `C_SkillInfo`
   (which return **tables**, not multiple values).
2. `PROJECT-NOTES.md:191-193` — replace `## Interface: 11508` with the on-disk
   `11509, 16001, 120100`, and restate the talent mechanism (gated shim, not removal) so a
   future reader does not conclude there is nothing to call.
3. `PROJECT-NOTES.md:188-189` — the "minimum useful snapshot" open question is answered by §5;
   link to this document.

---

## 12. Recommendation, in one paragraph

Add a **compact summary** (three lines, 160 bytes of additions → **394 total**, 56% of the
700-byte cap) to the existing context slot: stat totals, an equipped/empty slot count, and
per-section freshness stamps — but keep it small, because `ContextToSend` defers an oversized
context and the agent then reads stale gear. Put the **itemised** gear, full bags and the bank on
the **host-side SavedVariables lane** (`bridge.js:101`, `:329-333`, already polled at 750 ms),
under a new WoWAI SavedVariables key with its own timestamp, degrading to *no bank section* —
never an empty bank — when absent. **Do not take a StatForge runtime dependency**: reimplement the
~30 lines of `C_Container` iteration inside WoWAI and borrow StatForge's per-section isolation
discipline instead. Fix `SF.BANK_BAGS` (`Constants.lua:38`) and the `UnitDefense` call before
anything relies on StatForge on Forever — the current bank reader silently scans the keyring and
a reagent bag.

---

*Spec by Maxim 🗡️ — evidence from `Gethe/wow-ui-source@forever` (1.60.1.70009), the live
`bridge/state.json`, `StatForge` on disk, and two primary game sources per fact
(warcraft.wiki.gg + wowhead/zockify). No project source was modified on this card.*
