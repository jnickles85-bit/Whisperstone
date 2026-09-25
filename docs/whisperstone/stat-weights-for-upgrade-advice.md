# Stat-weight knowledge for upgrade advice — where does "better" live?

**Card:** `t_9de610ae`
**Status:** knowledge/design recommendation. No addon, bridge or test source was modified on this
card; this file is the only thing written.
**Verdict in one line:** **Reason over raw stats, not a weight table** — and the reason is not size
(the losing option is only ~170–303 bytes, which is *small*) but that **the client exposes nothing a
numeric table could key on** (no stat IDs, no armor-proficiency API, mainline-gated comparison
engine), so a table would be built on strings that break on locale and numbers transferred from a
different game version. What the agent needs is not weights but a **five-word vocabulary and the
level-40 armor gate** — 1,272 bytes in the primer, or 170 bytes if squeezed into the live context
slot's remaining 456.

---

## 0. Executive summary

| # | Question | Finding |
|---|---|---|
| 1 | Does the client have a built-in "is this an upgrade" API? | **No, not usable.** `C_Item.GetItemStats` and `C_Item.GetItemStatDelta` appear in `Blizzard_APIDocumentationGenerated/ItemDocumentation.lua` (`:1004`, `:987`) — but that file is a **union registry over game types**, and both have **0 non-doc call sites** in the whole Forever tree, while the ordinary `C_Item.GetItemInfo` has **115**. See §2. |
| 2 | Is there an armor-proficiency check? | **No API exists.** `IsArmorProficient` / `GetArmorProficiency` / `ArmorProficiency` / `CanEquipArmor` / `IsItemInArmorType` → **0 occurrences** in the entire Forever Interface tree. Armor proficiency *is* readable as a **skill line** (`C_SkillInfo`), which is a different mechanism. See §3. |
| 3 | Can a table key on numeric stat IDs? | **No.** `ITEM_MOD_*` constants → **0 occurrences** in the Forever tree *and* **0 in the Classic Era control tree**. The only keys available are localized label strings. See §4. |
| 4 | How big is the losing option, honestly? | **Small.** A bare 9-class order table is **170 bytes**; with a legend, **303**; a 19-spec level-60 numeric table, **1,470**. Size is *not* the argument against it. See §5. |
| 5 | What does a level-10 character's itemisation actually contain? | **5 stat words + Armor, 20 distinct combinations.** Measured over 5,328 Classic-Era records in band. See §6. |
| 6 | Does the agent already have a knowledge channel? | **Yes, but it is switched off for the agent that matters.** `bridge/config.json:81` sets `primerFile` to the 7,734-char primer; `config.json:73` sets `agents.hermes.primerFile = ""` → the default game lane receives **0 primer characters**. Verified against the live run. See §7. |
| 7 | What is the minimum viable knowledge? | **A 1,272-byte facts block containing no weights at all** — vocabulary, armor gate, order, semantics. Degrades to a **170-byte** critical fact if the context slot is the only carrier. See §8. |

**The finding that matters most:** the single highest-value fact is not a weight, it is a **rule the
agent will otherwise get confidently wrong**: in vanilla itemisation, **Mail and Plate are trained at
level 40**. A level-10 character of *any* class cannot wear them. An agent that knows "warriors wear
plate" — true in retail, and true in every general-knowledge source — will tell a level-10 warrior
to equip plate and be wrong. That fact is 170 bytes and fits the context slot's remaining headroom
exactly (§8.3).

---

## 1. Evidence base and method

Everything below is measured against live state, not recalled. The sources:

| Source | What it is | Used for |
|---|---|---|
| `Gethe/wow-ui-source@forever` build **1.60.1.70009** | extracted client UI source, matching the live client | every API claim, every call-site count |
| `Gethe/wow-ui-source@classic_era` | control tree | proving a zero-hit grep means *absence*, not *a missing file* |
| `bridge/state.json` (mtime 2026-09-25 16:24) | the live bridge's context block | the real byte cost of what is already injected |
| `bridge/config.json` + `bridge/bridge.js` | live bridge config and primer resolution | where knowledge can physically live |
| `.hermes/profiles/game/state.db`, session `20260925_145311_071c97` | a real game-lane run | whether the primer actually arrives |
| `StatForge-App/data/item-data.json` + manifest | offline item corpus, 38,294 records | the itemisation vocabulary |
| warcraft.wiki.gg, wowhead | game facts (two primary sources per fact) | the armor gate and stat semantics |

**Method notes.**

- **The control tree is load-bearing.** A zero-hit grep is only evidence if the same grep *can* hit.
  `ITEM_MOD_*` returns 0 in both trees; `C_Item.GetItemInfo` returns 115 call sites in the forever
  tree. Both were run, so the zeros mean absence.
- **Doc entries are not availability.** `Blizzard_APIDocumentationGenerated` is a union registry
  (§2). A doc entry proves an API exists *somewhere*; only a call site in a Camelot-loaded file
  proves it is callable on this client.
- **The corpus is Classic Era, not Forever.** The manifest says `supportedGame: "WoW Classic Era"`,
  `eraMaxItemIdExclusive: 24000`. It contains no `forever`, `camelot` or `1.60` marker. Every item
  count below is therefore **transferred, not verified** for Forever, and is labelled as such.

---

## 2. The third option I looked for, and why it is not available

The card names two options. Before choosing between them I checked for a third: does the client
itself already know an item's stats and its delta against what you wear?

**What I found.** `ItemDocumentation.lua` documents both `GetItemStats` (`:1004`) and
`GetItemStatDelta` (`:987`). warcraft.wiki.gg (`API_C_Item.GetItemStats`) describes `GetItemStats`
as returning a table of stats keyed by **globalstrings** (`ITEM_MOD_INTELLECT_SHORT`,
`ITEM_MOD_STAMINA_SHORT`, `RESISTANCE0_NAME`, …). That would be a real upgrade API and would
supersede both options on the card.

**Why it does not hold up.** Three independent checks, all against the same tree:

1. **The registry is a union.** Forever's `ItemDocumentation.lua` carries **299** name tokens;
   Classic Era's carries **207**. Forever's set is a near-superset — **93 names are forever-only**,
   only **1** is classic-only. Among the forever-only 93 are plainly mainline concepts
   (`IsCorruptedItem`, `IsItemConduit`, `IsAnimaItemByID`, `GetDelvePreviewItemLink`,
   `IsDecorItem`), and the file itself carries **no game-type annotation** on `GetItemStats`
   (compare `Blizzard_SharedXMLGame.toc:11`, which does annotate). A doc entry in this file is a
   statement about *some* client, not this one.
2. **Nothing calls them.** Non-doc call sites in the Forever tree: `C_Item.GetItemStats` **0**,
   `C_Item.GetItemStatDelta` **0**. Control: `C_Item.GetItemInfo` **115**. A union registry will
   list a function that the shipped UI never calls.
3. **Their keys do not exist in this client.** The returned table is keyed by `ITEM_MOD_*`
   globalstrings, and `ITEM_MOD_INTELLECT_SHORT` / `ITEM_MOD_STAMINA_SHORT` have **0 occurrences**
   in the entire Forever Interface tree. Even if the function were callable, its result keys would
   be a vocabulary this client does not carry.

**Corollary that matters more than the API itself.** The client's *own* tooltip-comparison engine —
`Blizzard_SharedXMLGame/Tooltip/TooltipComparisonManager.lua` — is gated
`[AllowLoadGameType mainline]` (`Blizzard_SharedXMLGame.toc:11`), alongside `TooltipUtil.lua` and
`TooltipDataRules.lua`. **Blizzard's comparison machinery does not load on camelot.** There is no
engine to borrow, and no "shift-compare" semantics to ask the client for.

**Conclusion:** there is no third option. The choice is the two on the card. *(This reverses an
intermediate finding on this card — I initially read the `GetItemStats` doc entry as a live API.
The union test in §1 is what refutes it, and it is recorded here rather than quietly dropped.)*

---

## 3. Armor proficiency: no API, but a real skill-line read

An "is this an upgrade" answer is often decided by a rule that has nothing to do with stats: *can
this class wear this at all?* I looked for an API to settle it.

**Absent.** Searching the whole Forever Interface tree for `IsArmorProficient`,
`GetArmorProficiency`, `ArmorProficiency`, `CanEquipArmor`, `IsItemInArmorType` returns **nothing**.

**Two functions exist, with semantics I did not verify.** `ItemDocumentation.lua` documents
`IsUsableItem` (`:1627`) and `IsEquippableItem` (`:1324`), and Camelot's own paper doll calls them
(`Camelot/PaperDollFrame.lua:1818`, `:1793`) — but in the **gamepad bind-item and use-item flows**,
not as a proficiency test. `IsUsableItem` is called on an already-equipped item to mean "can I
right-click use this". **Whether either one enforces armor proficiency is unverified** and is a
probe, not a fact (§9, U3).

**The verified path is skill lines.** Armor proficiency in vanilla is a *skill*, and Camelot's
skills panel reads skills through `C_SkillInfo`:

```
Camelot/SkillsFrame.lua:178   for index = 1, C_SkillInfo.GetNumSkillLines() do
Camelot/SkillsFrame.lua:179       local skillInfo = C_SkillInfo.GetSkillLineInfo(index)
```

with the API documented at `SkillInfoDocumentation.lua:41` (`GetNumSkillLines`), `:59`
(`GetSkillLineInfo`) and `:113` (`SkillLineAttributes` — a named-field table, not positional
returns). So the addon *can* enumerate a character's armor proficiencies today, with no new API. Whether
an armor type the class has not yet trained appears there as an untrained row or is absent entirely
is **unknown** (§9, U4) — and it decides whether this path is usable or merely present.

---

## 4. What a static table would have to key on

This is the crux of the architecture question, so it is worth being precise.

A weight table has two jobs: identify the class, and identify the stats. Class is easy —
`UnitClass` is callable and the Camelot paper doll uses it. **Stats are the problem.**

- **No numeric stat IDs.** `ITEM_MOD_STRENGTH_SHORT` and friends: **0 occurrences** in the Forever
  tree, and **0 in the Classic Era control**. The `LE_UNIT_STAT_*` constants the paper doll uses
  (`Camelot/PaperDollFrameStats.lua:252–290`, `Camelot/PaperDollFrame.lua:131–143`) are the
  *character-sheet* index, a different namespace from item stats, and they are engine constants, not
  serialisable IDs.
- **So a table keys on localized strings.** The stat names arrive inside a rendered tooltip
  (`"+5 Intellect"`), which is what the link-evidence channel already produces. That works — but it
  makes the table's keys **locale-dependent**. A table validated on an `enUS` client silently stops
  matching on any other locale, and the failure mode is not an error: it is a table that finds no
  stat to weight and returns "no opinion" or, worse, an empty comparison read as "no change".
- **Proficiency cannot be filtered inside the table** (§3), so the table can never answer "you
  cannot wear this", only "this has good stats". Those are different answers, and the first is the
  one that prevents bad advice at level 10.

**This, not size, is why the table loses.** A table that cannot name a stat reliably and cannot
reject an item outright is a knowledge base with no reliable join.

---

## 5. The losing option, argued fairly

The static-table option has real merits and I want them on the record, because the recommendation
below deliberately **absorbs** its best idea.

**It is small.** Measured, not estimated:

| Form | Bytes | Lines | % of the 700-byte context cap |
|---|---|---|---|
| 9 classes × order line, bare, no legend | **170** | 9 | 24.3% |
| 9 classes × order line + legend | **303** | 10 | 43.3% |
| 19 specs × 6 weighted stats (level-60 raiding shape) | **1,470** | 20 | 210.0% |

The bare form is **170 bytes**. Any argument that a weight table is "too big to ship" is wrong, and
I would have been wrong to make it.

**Its genuine merits:**

- **Deterministic and auditable.** The same item and class always yield the same verdict, and the
  reasoning can be read by a human in the file. An LLM's judgement varies run to run.
- **No model dependency.** It works on a small local model, or with the model briefly unavailable.
- **Cheap arithmetic.** A verdict is a weighted sum, computed instantly, offline, with no tokens.
- **Testable.** A unit test can assert `score(plate_helm, warrior) > score(cloth_helm, warrior)`.
  A reasoning agent can only be spot-checked.

**Its failure modes, precisely:**

1. **Wrong numbers are confidently wrong, and unverifiable here.** Vanilla-era weights are widely
   published, but they are *classic-era level-60 raid* numbers, and the corpus this project holds is
   Classic Era data, not Forever data (§1). Transferring them is an assumption. The project's own
   stance (`phase-b-l2-scoping.md` §6) is that a confident answer built on bad data is worse than
   "I don't know" — a table is precisely the shape that produces confident wrong answers.
2. **Level 10 is the wrong regime.** §6 shows the entire vocabulary at this level is five words and
   the stat *values* are single digits (`+1 Stamina` on the highest-frequency item shape). Weights
   tuned for a raid gearset have no resolution here; the order is all that survives.
3. **No reliable key** (§4) and **no proficiency filter** (§3).

**What I take from it:** the durable part of a weight table at this level is not the weights, it is
the **order**. So the recommendation ships an order, in prose, and drops the numbers — which is why
the recommended block contains no arithmetic at all.

---

## 6. What a level-10 item actually says

Measured over the offline corpus, band `requiredLevel ≤ 10 and itemLevel ≤ 20`, with the manifest's
own `eraMaxItemIdExclusive: 24000` applied (Classic Era only), and reported both ways so the
transfer assumption is visible:

| Bucket | Era-only | Whole file (no cutoff) |
|---|---|---|
| records in band | 5,328 | 8,769 |
| no stat row at all | 4,319 | 7,569 |
| **Armor line only, no other stat** | **669** | 754 |
| at least one non-Armor stat | **340** | 446 |
| distinct non-Armor stat words | **5** | 5 |
| distinct stat combinations | **20** | 20 |

The five words, by frequency in the Era band: **Stamina (177), Spirit (81), Agility (79), Strength
(71), Intellect (59)**. The maximum number of stat words on any single item in the band is **5**.

Restricted to equippable slots (armor and weapon slots, excluding `Non-equippable`/`Shirt`/`Tabard`),
the decision space is **314 statted items**, of which **193** also carry an Armor line. By slot, the
top of that space is One-Hand (71), Chest (52), Legs (37), Two-Hand (32), Hands (25), Back (21),
Feet (19).

**What this means for the architecture question.** The whole itemisation vocabulary a level-10
character can encounter is **five words**. That is small enough to state in two lines of prose and
small enough that an agent does not need a table to enumerate it — but only if it is *told* the list,
because "the vocabulary is exactly these five" is not derivable from general WoW knowledge (which
also carries Haste, Crit, Mastery, Versatility, spell power, hit rating — none of which appear here;
`ITEM_MOD_MASTERY_RATING_SHORT` and friends have 0 occurrences in this client, §2).

**The corpus caveat, restated because the recommendation depends on it.** This is Classic Era data.
That the five-word vocabulary is identical on Forever is **inferred from the client's absence of any
other stat vocabulary**, not measured in game. §9, U1.

---

## 7. Where the knowledge can physically live — and a live defect

Three carriers exist. One of them is already wired and is switched off.

**Carrier A — the primer file. No addon change, no size pressure.**
`bridge/bridge.js:357` resolves `PRIMER_FILE` from `cfg.primerFile`, `:361-372` reads it, `:499`
passes it into `P.systemPrompt(...)` on every run. The live global value (`config.json:81`) is
`docs/WOW-ADDON-PRIMER.md`, which is **7,734 characters / 7,736 bytes** on disk. Agents `claude`,
`codex` and `grok` all resolve to it correctly (verified by re-running bridge resolution logic:
7,734 chars each).

**Carrier B — the 700-byte context slot. Too small, and it has one real virtue.**
`WoWAI.lua:928` — `CONTEXT_MAX = 700`, truncated at `:1057`, and the live block (measured this run
from `bridge/state.json`) is **244 bytes**:

```
Game: World of Warcraft: Forever (client 1.60.1.70009, interface 16001)
Character: Nous on Classic Beta PvE, level 9 Undead Warlock (Horde)
Location: Tirisfal Glades - Garren's Haunt
Position: 57.4, 38.8 (map 1420)
Money: 31s 25c; XP: 5748/6500
```

That leaves **456 bytes** of headroom, and it is the one carrier that reaches the agent **without
anything being configured** — which matters given Carrier A's state below.

**Carrier C — the addon's link-evidence channel. The item data itself.**
`WoWAI.lua` renders a hidden `GameTooltip` for any item link in a message and appends its lines as a
`"Linked from the game"` block, capped at `LINK_LINES_MAX = 30` (`:929`) and `LINK_BYTES_MAX = 900`
(`:930`, enforced `:1128`). Measured over 1,308 low-level stat-bearing items: full tooltip block
**median 176 bytes, p90 252, max 500** — **0 of 1,308 exceed either cap**. A stats-only reduction is
**median 44 bytes**. This is the channel that delivers *the item in question*, and it is already
shipped.

**The defect.** `config.json:73` sets `"primerFile": ""` for the `hermes` agent, and
`config.json:20` (`"agent": "hermes"`) makes `hermes` the default. In `bridge.js:363` an empty string
means "no primer". So:

- The **default** game lane gets **0 primer characters** — not a truncated primer, not a fallback
  primer, **none**.
- Confirmed against live state, not just the config path: the real game-lane run session
  `20260925_145311_071c97` in `.hermes/profiles/game/state.db` has a first user message of **952
  characters** with the primer marker (`"addon and macro primer"`) **absent** — the message is the
  `[Context from the WoW AI bridge…]` block plus the user's own text.
- The agent that receives this lane also has no compensating knowledge: `.hermes/profiles/game/`
  holds a 667-byte `SOUL.md` that is generic Hermes identity text, an empty `memories/`, and skills
  with **0 occurrences** of `intellect`, `stamina`, `spirit`, `armor proficiency` or `stat weight`.

This is a config value (a filename), not code, and it is not a secret — but it is out of scope on
this card (no-write boundary), so it is a **recommendation**, §10.

**Why this reframes the architecture question.** Whichever option wins, it has to reach *this* lane.
The table option would need a new distribution path (addon data, or the primer that is currently
empty). The reasoning option needs the same primer channel fixed, but only to carry prose — no new
data format, no locale-sensitive keys, no numbers to keep in sync with a beta client's itemisation.

---

## 8. The minimum viable knowledge, defined and measured

### 8.1 The recommendation

Not weights. A **five-word vocabulary, the level-40 armor gate, an order, and the semantics of each
stat** — so the agent can *explain* a verdict rather than assert one, and can reject an item it
cannot see stats for.

The block, as written and measured (28 lines, **1,272 bytes**):

```
## "Is this an upgrade?" - the minimum you need

The entire stat vocabulary below level 20 is five words plus Armor: Stamina,
Agility, Strength, Intellect, Spirit. Nothing else appears.

Armor your class can actually wear (vanilla rule, not retail):
  Cloth only: Mage, Priest, Warlock
  Cloth + Leather: Rogue, Druid
  Cloth + Leather + Mail: Hunter, Shaman
  Cloth + Leather + Mail + Plate: Warrior, Paladin
Mail and Plate are TRAINED AT LEVEL 40. At level 10 no character wears either,
so a mail or plate item is not an upgrade - it cannot be equipped at all.
Never offer one.

Order to favour while levelling (rules of thumb, not simulations):
  Warlock/Mage/Priest int>spi>sta   Druid int>agi>sta   Rogue agi>str>sta
  Hunter agi>sta>int                Shaman/Paladin str>int>sta
  Warrior str>sta>agi

Intellect = mana and spell crit. Spirit = health/mana regen out of combat.
Stamina = health. Strength = melee attack power. Agility = attack power and
dodge for the classes that use it. Armor = physical damage reduction.

Level 10 has no specialisation. Do not ask for a spec, and do not reason about
one.

Say you do not know instead of guessing when the item's stats are not in front
of you, you do not know what is in that slot now, or the class is not listed.
```

### 8.2 Carrier fit, measured

| Carrier | Result |
|---|---|
| Primer file (Carrier A) | **fits** — no cap; 1,272 bytes against a 7,734-byte primer |
| 700-byte context slot (Carrier B) | **fails** — 1,272 bytes = 182% of cap |
| Live context headroom (456 bytes free) | **fails** — 816 bytes over |
| One 3,200-byte strip record (`Codec.lua:15`) | **39.8%** — would fit, but see below |

The strip is not a serious candidate: the agent does not need this per-message, and spending 40% of
a record's payload on static prose that never changes is waste.

### 8.3 If the context slot is the only carrier

The block's most valuable line is the one an agent will otherwise get **confidently wrong**. In
vanilla itemisation **Mail and Plate are trained at level 40**; retail changed this to level 1 in
patch 7.0.3 (warcraft.wiki.gg, *Proficiency*, patch table). "Warriors wear plate" is true in retail
and in every general-knowledge source, and **false for a level-10 warrior on this client**.

That fact, stated alone, is **170 bytes** and **fits the 456-byte headroom** with 286 bytes to
spare. So even in the worst case — no primer at all, exactly the current state — the single most
damaging error is preventable from the context slot with room left for the vocabulary list.

### 8.4 What the agent supplies itself

Everything else in an upgrade decision is *reasoning*, which is the part an LLM is good at and a
table is not:

- Compare this item's stat words against what is in the same slot — the slot contents come from the
  gear snapshot (`phase-b-l2-scoping.md` §5), the item comes from the link-evidence channel
  (Carrier C).
- Apply the order to decide which of two items wins.
- Apply the armor gate to reject an item outright.
- Explain *why*, using the semantics line, instead of asserting a score.

---

## 9. What remains unknown — and the probe that settles each

House format, per `phase-b-l2-scoping.md` §9.

**U1 — Is the level-10 stat vocabulary on Forever the same five words?**
*Claim:* the vocabulary is Stamina, Agility, Strength, Intellect, Spirit, plus Armor, and nothing
else. *Evidence:* measured — 5 distinct words across 5,328 Era-band records, 20 combinations; and 0
occurrences of `ITEM_MOD_*` anywhere in the Forever client tree. *Gap:* the corpus is Classic Era,
not Forever. *Probe:* on the live client, `/dump C_Item.GetItemStats("item:<id>")` for any low-level
item — if it returns anything at all, its **keys** enumerate the real vocabulary directly. If it
returns nothing (expected, §2), shift-click ten items and read the stat lines.

**U2 — Does `C_Item.GetItemStats` work on this client despite the union-registry evidence?**
*Claim:* it is not callable on camelot. *Evidence:* 0 non-doc call sites; 93 forever-only names in a
union registry; its `ITEM_MOD_*` result keys have 0 occurrences in the client. *Gap:* a doc entry is
not proof of *unavailability*, only of non-use. *Probe:* `/run print(type(C_Item.GetItemStats))`
then `/dump C_Item.GetItemStats("item:1009")`. **Type `nil` confirms the finding; a table would make
this API the better answer and partially overturn §2.**

**U3 — Does `IsUsableItem` / `IsEquippableItem` enforce armor proficiency?**
*Claim:* they are called by Camelot's paper doll but not as a proficiency test. *Evidence:*
`Camelot/PaperDollFrame.lua:1818`, `:1793` — gamepad bind/use flows. *Gap:* semantics unverified.
*Probe:* on a level-10 warrior, `/dump C_Item.IsUsableItem(<a cloth chest id>)` and the same for a
**plate** chest id. If the plate one returns `false` while the cloth one returns `true`, this is a
usable armor gate. Cross-check `/dump C_Item.IsEquippableItem(...)` on the same two ids.

**U4 — Do untrained armor proficiencies appear as skill lines?**
*Claim:* armor proficiency is readable via `C_SkillInfo`. *Evidence:* `Camelot/SkillsFrame.lua:178`,
`:179`; `SkillInfoDocumentation.lua:41`, `:59`, `:113`. *Gap:* whether an armor type the class has
**not trained** appears as a row (rank 0 / maxRank 0) or is simply absent decides whether this path
can answer "cannot wear" or only "can wear". *Probe:* on a level-10 warrior,
`/run for i=1,C_SkillInfo.GetNumSkillLines() do local s=C_SkillInfo.GetSkillLineInfo(i) if s then print(i, s.name, s.rank, s.maxRank) end end`
— look for Cloth/Leather/Mail/Plate rows and their rank/maxRank.

**U5 — Is the level-40 Mail/Plate gate unchanged on Forever?**
*Claim:* yes; it is vanilla itemisation, and Forever is vanilla content. *Evidence:* warcraft.wiki.gg
*Proficiency* (level-requirement icons; the 7.0.3 patch note records the *retail* change to level 1),
plus the Classic-era community sources agreeing that Hunters/Shamans train Mail and Warriors/Paladins
train Plate at 40. *Gap:* Forever is a beta on the retail engine — Blizzard may have taken the retail
rule instead. *Probe:* on a level-10 Warrior, try to equip a Mail item; then check
`/run print(select(2, UnitClass("player")))` and the skills list from U4. **This is the highest-value
probe on the card**, because the 170-byte fact in §8.3 is wrong if it comes back the other way.

**U6 — Will the agent's `web` toolset substitute for world knowledge?**
Out of scope here (see the card: the client exposes no quest or resource-node coordinates). Noted
only so it is not re-opened: `C_Map.GetUnitMapPosition` absent, `QuestPOIGetIconInfo` 0 call sites,
`Blizzard_SharedMapDataProviders` gated mainline — the agent's `web` toolset is the answer for world
questions, and that is a deliberate design choice, not a gap.

---

## 10. Recommendations (not applied — no-write boundary)

1. **Fix the primer switch for the game lane.** `config.json:73` sets
   `agents.hermes.primerFile = ""`. Either delete the key so the lane inherits the global primer
   (7,734 chars), or point it at a shorter game-specific primer. **This is the blocking prerequisite
   for any knowledge answer on this lane**, and it is a config value, not code.
2. **Add the facts block (§8.1) to the primer.** 1,272 bytes on top of 7,734. No addon change, no
   new data format, no per-message byte cost.
3. **If the primer lane stays off, put the 170-byte armor gate in the context slot** (§8.3) — the
   highest-value single fact, and it fits the 456-byte headroom today.
4. **Do not ship a weight table.** Not because it is big (it is not — 170 bytes), but because it has
   no reliable key (§4), cannot reject an unwearable item (§3), and would carry level-60 numbers
   into a level-10 regime on a beta client whose itemisation differs from the corpus.
5. **Do not build on `C_Item.GetItemStats`** unless U2 comes back positive. The union registry makes
   it look available; nothing calls it and its result keys do not exist in this client.
6. **Keep the order as prose, not numbers.** If a table is ever wanted, ship it as an order (§5) —
   which is what §8.1 already is.
7. **Re-verify §8.3 (U5) before relying on it**, since it is the one fact where a retail-engine
   beta is most likely to differ from vanilla.

---

## 11. Recommendation, in one paragraph

Choose **reasoning over raw stats**, with a small ordered facts block in the agent's primer. The
losing option is not losing because it is big — a 9-class order table is 170 bytes, and that argument
would have been wrong. It loses because on this client there is **nothing for a table to key on**:
`ITEM_MOD_*` stat IDs do not exist (0 occurrences in both trees), the client's own comparison engine
is gated `mainline` and never loads on camelot, no armor-proficiency API exists anywhere, and
`C_Item.GetItemStats` is a union-registry entry with 0 call sites whose result keys are a vocabulary
this client does not carry. What the agent actually needs is not numbers but knowledge it cannot
infer: the fact that a level-10 character's entire stat vocabulary is **five words**, that **Mail and
Plate are trained at level 40** so they are never an upgrade at level 10, and what each stat does —
**1,272 bytes of prose** in a primer that is already wired at 7,734 characters. The one thing
standing in the way is that the primer is switched off (`config.json:73`,
`agents.hermes.primerFile = ""`) for the very lane the user talks to, verified against a live run
whose first message is 952 characters with no primer in it. Fix that key, add 1,272 bytes of facts,
and ship no table at all — and if the lane must stay off, the 170-byte armor gate fits the context
slot's remaining 456 bytes today.

---

*Recommendation by Maxim 🗡️ — evidence from `Gethe/wow-ui-source@forever` (1.60.1.70009) with
`classic_era` as control, the live `bridge/state.json`, `bridge/config.json` (key names only), the
live game-lane run `20260925_145311_071c97`, `StatForge-App/data/item-data.json`, and two primary
game sources per fact (warcraft.wiki.gg + wowhead/community). No project source was modified on this
card — this file only.*
