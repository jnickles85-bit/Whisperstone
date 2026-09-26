# Whisperstone — project notes

**Status:** Phase A complete and verified. **The in-game round-trip is proven** — a message typed
in the game reached the bridge and a real agent reply was rendered back in the addon window
(2026-09-25). What remains open is verification of the approval boundary, not transport.

**What this is:** a fork of [`chelinho139/wow-ai`](https://github.com/chelinho139/wow-ai) (MIT)
that adds a **Hermes** agent entry, so the in-game chat window talks to a local Hermes
profile instead of Claude Code / Codex / Grok.

**Target client:** World of Warcraft: **Forever** beta, `_classic_beta_`, build 1.60.1,
`## Interface: 16001`. Forever is **mainline** (`WOW_PROJECT_ID = 1`) — it uses the modern
`C_Item` / `C_Spell` / `C_Traits` API surface. Do **not** reach for classic globals; they
are gone. Verify any API against Blizzard's `forever` branch of
[wow-ui-source](https://github.com/Gethe/wow-ui-source).

---

## What we are trying to accomplish

Talk to a Hermes agent **from inside the game**, without alt-tabbing. The end goal is not
just a chat box — it is a doorway to a full agent:

| Level | Capability | State |
|---|---|---|
| **L0** | Door: type in game, get a reply from a real agent | **proven in game** (2026-09-25) |
| **L1** | The agent knows *who* you are (character, zone, position) | **built and confirmed live** (context block) |
| **L2** | The agent knows your **gear, stats and bank** | **partly built** — stat totals + filled/empty slot count ride the context block (`t_52c484cb`); the **itemised** gear, bags and bank are still deferred, see below |
| **L3** | Two-way: the addon pushes a full snapshot the agent can reason over | design only |

Real gain is **L2** — not "the agent knows my pants," but *"the agent knows my bank."*
That turns it from a novelty into a tool.

**Design principles that hold, and are load-bearing:**

1. **The model is the host's business, not the addon's.** The addon never names a model.
   No model string exists anywhere in `addon/`. The model resolves per Hermes profile,
   host-side. Swapping models must never require touching the addon.
2. **In-game text is untrusted data, never instructions to the agent.** This addon is a
   remote control for a full agent; the bridge treats game text as input to reason *about*,
   not commands to obey.
3. **Plain addon API only.** No memory reading, no synthetic input, no DLL injection.
4. **The carrier is upstream's; our additions stay separable** so they can be offered back
   as a PR without dragging our local choices along.

---

## What is actually proven (evidence, not claims)

Everything below was measured. Raw output, not summaries.

**The bridge half is done — proven end-to-end offline, with a real agent.**

```
$ npm run test:live
slot 1..5: replies=1 id=1 status=done agent=hermes text="PONG" ok
sig/001.wav=124B  ack/001.wav=124B  act/001/01.wav=124B
>>> INJECT TEST PASS      (exit 0)
```

This runs the **real** `hermes` CLI through the real bridge into a 5-slot sandbox. It needs
no game client, so it is a repeatable regression gate for the whole
*bridge → slots → signal* chain.

**The addon loads in the real client.** `WTF/Account/<id>/SavedVariables/WoWAI.lua` is
written by the addon's own logout handler — its existence is hard proof the addon ran. The
addon and the slot pool are installed:

```
$ grep -n Interface addon/WoWAI/WoWAI.toc
1:## Interface: 16001
$ ls -d ".../Interface/AddOns/"WoWAI_S* | wc -l
200
$ grep -l WoWAI ".../WTF/Account/<id>/70"/*/AddOns.txt | wc -l   # enabled characters
8
$ grep -n lastAddonVersion ".../_classic_beta_/WTF/Config.wtf"
132:SET lastAddonVersion "16001"
```

**"Installed" is not "live" — the drift check, and why it exists.** An earlier version of this
note said the installed addon was *byte-current with repo `HEAD`*. That was true when written
and is **not** safe to assume: an addon change needs **both** a reinstall **and** a client
reload, and this client had been logged in since 15:41 — hours older than the change. So a
`done` card did **not** imply the fix was running. The check is cheap, and it caught a real
false-live (the professions fix was committed and absent from the installed copy). Compare each
file's sha256 against its installed copy, and the client's process start time against the
install mtime:

```
$ sha256sum addon/WoWAI/WoWAI.lua addon/WoWAI/WoWAI.toc addon/WoWAI/Codec.lua
4ddcc9a701d570f1e918f54807b3da9ce0f93832fc944933866e08d580dc5c86  addon/WoWAI/WoWAI.lua
d615ec6f58e7981c760db8fde0584e6be15e40ab8aeeb523cc4fc906d6314894  addon/WoWAI/WoWAI.toc
ae432db4505e60dc3cefbb8d33e180c66c6800fafce0bedf1e69929a2bff1ec8  addon/WoWAI/Codec.lua
$ sha256sum ".../AddOns/WoWAI/WoWAI.lua" ".../AddOns/WoWAI/WoWAI.toc" ".../AddOns/WoWAI/Codec.lua"
d6c44e16244c278b751a1def63a5939be05c33abd967171126a5ed62014af630  .../WoWAI.lua   ← DIFFERS
d615ec6f58e7981c760db8fde0584e6be15e40ab8aeeb523cc4fc906d6314894  .../WoWAI.toc   ← MATCH
ae432db4505e60dc3cefbb8d33e180c66c6800fafce0bedf1e69929a2bff1ec8  .../Codec.lua   ← MATCH
$ diff <(git show d531eee:addon/WoWAI/WoWAI.lua) ".../AddOns/WoWAI/WoWAI.lua" | wc -l
0
```

`WoWAI.lua` only, and the drift is **exactly one commit deep**: the installed copy is
byte-identical to `HEAD~1` (`d531eee`), i.e. the bags work is committed but **not yet
installed**. **`Inbox.lua` is deliberately excluded from every comparison** — the bridge
rewrites it at runtime, so a mismatch there is expected and is **not** drift. Read the two
hashes as "what is on disk" and "what the client loaded", never as one claim.

**The in-game round-trip is PROVEN.** A message typed in the addon window reached the bridge
over the pixel strip, ran a real agent, and the reply rendered back in the game. Verbatim from
`bridge/bridge.log` — this is the whole of that session, with nothing elided:

```
[2026-09-25T18:49:44.978Z] capture: attached to 'World of Warcraft' (pid 13184)
[2026-09-25T18:52:58.853Z] strip #3: 1 message(s)
[2026-09-25T18:52:58.854Z] #3@b5db4e4c439d8b game context updated: Character: Nous on Classic Beta PvE, level 9 Undead Warlock (Horde)
[2026-09-25T18:53:00.420Z] hello from session b5db4e4c439d8b
[2026-09-25T18:53:09.399Z] strip #4: 2 message(s)
[2026-09-25T18:53:09.400Z] #4@b5db4e4c439d8b game context updated: Character: Nous on Classic Beta PvE, level 9 Undead Warlock (Horde)
[2026-09-25T18:53:09.962Z] #4@b5db4e4c439d8b (pixel) Ara starting in /home/jnick/Whisperstone (new session) [game context]
[2026-09-25T18:53:15.769Z] #4@b5db4e4c439d8b done (140 chars)
[2026-09-25T18:59:41.010Z] strip #5: 1 message(s)
[2026-09-25T18:59:41.010Z] #5@b5db4e4c439d8b game context updated: Character: Nous on Classic Beta PvE, level 9 Undead Warlock (Horde)
[2026-09-25T18:59:41.662Z] #5@b5db4e4c439d8b (pixel) Ara starting in /home/jnick/Whisperstone (resume 20260925) [game context]
[2026-09-25T19:02:26.017Z] #5@b5db4e4c439d8b error (1621 chars)
[2026-09-25T19:07:50.708Z] strip #6: 1 message(s)
[2026-09-25T19:07:50.709Z] #6@b5db4e4c439d8b game context updated: Character: Nous on Classic Beta PvE, level 9 Undead Warlock (Horde)
[2026-09-25T19:07:51.289Z] #6@b5db4e4c439d8b (pixel) Ara starting in /home/jnick/Whisperstone (resume 20260925) [game context]
[2026-09-25T19:08:32.710Z] #6@b5db4e4c439d8b done (2006 chars)
```

A reply rendered in the addon window, verbatim: *"Hey! Nous the level 9 Undead Warlock,
hanging out in Tirisfal Glades. What do you need — quest help, a macro, gear advice, or just
chatting?"* The same text is in `bridge/transcripts.json` (chat `b5db4e78a8`) and in the
addon's own `SavedVariables/WoWAI.lua`, so the round-trip is corroborated on both sides of the
channel, not just in a log the bridge wrote about itself.

**Count the ids carefully — the split is not a clean sweep.** Four strips were read in that
login session: **#3 was the addon's hello** (no text, no agent run — `#3` has no "Ara starting"
line and `bridge.js` logs `hello from session` for exactly that kind of record), and #4, #5, #6
were the three real chat messages. So:

| | transport (strip read → bridge received) | agent run |
|---|---|---|
| #4 "Hey there" | **yes** | **yes** — `done (140 chars)` |
| #5 "Not just yet…" | **yes** | **no** — `error (1621 chars)` |
| #6 "Good catch…" | **yes** | **yes** — `done (2006 chars)` |

**Transport succeeded for all three; the agent run succeeded for two.** #5 is not a carrier
fault: the `game` profile's approval layer blocked its `execute_code` and its `node -e`
(see *Next steps 2*), the run exited non-zero, and the bridge correctly labelled it `error`.
The agent's own text still came back — that is why the bridge prefixes such a reply with
`Bridge error:`. **Do not blur the two facts together**: "the transport works" and "the agent
run exits clean" are different claims with different evidence.

**No `/reload` was needed between them — PROVEN.** Three chat messages travelled in one login
session with no `/reload`. The evidence is a `grep -c` of the bridge's own hello log line,
**scoped to the window that carried ids #3–#6** (`18:52:58Z`–`19:08:32Z`):

```
$ awk '$0>="[2026-09-25T18:52:58" && $0<="[2026-09-25T19:08:33"' bridge/bridge.log | grep -c 'hello from session'
1
$ grep -n 'hello from session' bridge/bridge.log | head -3
67:[2026-09-25T18:53:00.420Z] hello from session b5db4e4c439d8b
659:[2026-09-25T19:42:04.287Z] hello from session b5db4e4c439d8b
670:[2026-09-25T20:50:48.750Z] hello from session b5db4e4c439d8b
```

**Do not repeat an earlier form of this proof that said `grep -c` over the whole file returns
`1`.** It did when written; the file has kept growing and the same command now returns **9**.
An unqualified whole-file count is a snapshot, not an invariant — scope it to the window, as
above, or it will read as a falsehood to the next person who runs it.

The addon sends that hello once at login and again on each `/reload` or **Connect** press
(`WoWAI.SayHello`, throttled to one per 60 s) and the bridge logs one line per hello received.
Exactly one hello falls inside the #3–#6 window, and the next one is 34 minutes after #6
finished, so no `/reload` and no relog happened between those three messages. The
load-on-demand slot pool recycled correctly across all three: `sig`, `ack`, `act` 004, 005 and
006 are all present with the 124-byte payload, and the `act/` dirs for 004–006 were rebuilt
during that window.

**A hello logged with no reply is by design, not a failure.** Later in the same session,
messages **#10** and **#12** each logged `hello from session …` with **no** `Ara starting` line
and no `done`/`error` line under them:

```
669:[2026-09-25T20:50:47.166Z] #10@b5db4e4c439d8b game context updated: Character: Longhairs on Classic Beta PvE, level 8 Windshaper Skyborne Rogue (Horde)
670:[2026-09-25T20:50:48.750Z] hello from session b5db4e4c439d8b
675:[2026-09-25T20:52:40.441Z] #12@b5db4e4c439d8b game context updated: Character: Longhairs on Classic Beta PvE, level 8 Windshaper Skyborne Rogue (Horde)
676:[2026-09-25T20:52:42.038Z] hello from session b5db4e4c439d8b
```

That shape looks exactly like a message the bridge dropped. It is not. `bridge.js:409-419`
acks a hello, may offer a restore, refreshes the slots and **returns before any agent run** —
so a hello record *cannot* produce a reply. Recorded here so the next reader does not file it
as a bug.

---

## Two characters, two zones — and a third that has since appeared

**Multi-character operation is demonstrated, not just single-character.** Every record below
travelled through the same addon session `b5db4e4c439d8b`. Counted over
`bridge/bridge.log` at the time of writing (`grep -o 'game context updated: Character:
[A-Za-z]*' bridge/bridge.log | sort | uniq -c`):

```
      8 game context updated: Character: Nous
      8 game context updated: Character: Longhairs
      1 game context updated: Character: Mightie
```

| Character | Reported as | Level in the log | Cite |
|---|---|---|---|
| `Nous` | Undead Warlock (Horde) | **9 ×7 → 10 ×1** | level 9: `bridge.log:66,69,74,78,658,661,665`; level 10: `bridge.log:672` |
| `Longhairs` | Windshaper Skyborne Rogue (Horde) | **8 ×6 → 10 ×2** | level 8: `:669,675,678,681,685,689`; level 10: `:692,695` |
| `Mightie` | Undead Paladin (Horde), level 17 | 17 ×1 | `bridge.log:700` |

**`Nous` levelled 9 → 10 mid-session**, and the change is visible only as the Character line
itself — `#11` at `20:52:01.092Z` (`bridge.log:672`) is the first record that says `level 10`
where the seven before it said `level 9`. `Longhairs` went **8 → 10**, first at `#17`
(`bridge.log:692`, `22:03:20.514Z`). Both characters therefore levelled inside **one addon
session with no relog** — the strongest multi-character evidence this project has.

**A second zone, and a second map id.** `Location: Zephras Isle - Falaath Village` with
`Position: 49.0, 57.2 (map 2521)` — verbatim from the context block the bridge actually handed
the agent (the addon's own text, stored as `context.text`):

```
Game: World of Warcraft: Forever (client 1.60.1.70009, interface 16001)
Character: Longhairs on Classic Beta PvE, level 8 Windshaper Skyborne Rogue (Horde)
Location: Zephras Isle - Falaath Village
Position: 49.0, 57.2 (map 2521)
Money: 22s 47c; XP: 3608/5400
```

For contrast, **Tirisfal Glades is map `1420`** (`PROJECT-NOTES.md`, the pre-change block) and
The Barrens is `1413`; Zephras Isle is a map id this project had not seen. Note that
`bridge/state.json` is **gitignored** (`.gitignore:3`) and is overwritten in place — a citation
to it is a point-in-time reading, not something a reader can reproduce from git. The durable
copy of the same string is the `[Context from the WoW AI bridge…]` block in the `game`
profile's own message store (session `20260925_155203_6dfedb`).

**The character the bridge holds as current moves, and it has moved again since this card was
written.** At the time the card was drafted, `bridge/state.json` held `Longhairs` at Zephras
Isle; by the time the card ran, it held a **third** character:

```
Character: Mightie on Classic Beta PvE, level 17 Undead Paladin (Horde)
Location: The Barrens - The Crossroads
Position: 52.0, 29.9 (map 1413)
Money: 2g 27s 75c; XP: 9470/17700
Stats: HP 422, Mana 564, Armor 1128, Str 43, Agi 29, Sta 45, Int 34, Spi 46
Gear: 10 of 19 slots filled (9 empty)
Talents: Paladin 0
Professions: Blacksmithing 52/75, Mining 97/150, First Aid 42/75, Cooking 7/75
```

So the correct statement of scope is **three characters, three zones, one addon session** —
`Nous` (Tirisfal Glades), `Longhairs` (Zephras Isle), `Mightie` (The Barrens). Treat the
"current character" as a moving value and always read it from the live context, never from
this note.

### Corrections: three claims from an in-game summary that measurement refutes

An in-game agent summarised the bridge state and got three things wrong. They are recorded
here in the same shape as the Phase B "Recommended doc corrections" (`phase-b-l2-scoping.md:697`)
— claim, then the measurement that refutes it — because the summary was persuasive and would
otherwise be repeated.

| Its claim | Measured reality |
|---|---|
| "Nous: **5** context updates" | **8** — `grep -cE 'game context updated: Character: Nous' bridge/bridge.log` → `8` |
| "5711 to 5748 XP … **read from `bridge.log`**" | `5711` and `5748` each appear **0 times in `bridge.log`**. They are in `bridge/transcripts.json`, in the *agent's own prose* — not a log line the bridge wrote. |
| "then a **level-up line**" | **No level-up line exists anywhere.** `grep -niE 'level.?up\|leveled\|ding' bridge/bridge.log` returns nothing. The level change shows up only as the Character line. |

```
$ grep -cE 'game context updated: Character: Nous' bridge/bridge.log
8
$ grep -c '5711' bridge/bridge.log; grep -c '5748' bridge/bridge.log
0
0
$ grep -c '5711' bridge/transcripts.json; grep -c '5748' bridge/transcripts.json
1
1
$ grep -niE 'level.?up|leveled|ding' bridge/bridge.log
(no output)
```

**The load-bearing part is the third row for the XP one — the `bridge.js` line that logs the
context logs *only* the Character line.** `bridge.js:346` builds `who` from the first
`Character:` line of the context and nothing else:

```
$ sed -n '346p' bridge/bridge.js
  log(`#${job.id}${job.session ? '@' + job.session : ''} game context ${text ? 'updated: ' + who : 'cleared'}`);
```

So `bridge.log` **never** contains Location, Position, Money, XP, Stats, Talents or
Professions. Any claim of the form "I read the XP out of `bridge.log`" is false by
construction, however the numbers were actually obtained. Location/zone/map and everything
after the Character line live in `bridge/state.json` (and in the `game` profile's stored
prompt); the counts live in `bridge/bridge.log`; the agent's *prose about* them lives in
`bridge/transcripts.json`. Three different files — cite the right one.

### Is `Windshaper Skyborne` / `Zephras Isle` real Forever content? — settled by Blizzard, not by the UI tree

**This project's source-grep route cannot answer it, and earlier attempts to answer it from
source went wrong in both directions.** Recorded because two separate over-reads happened here:

- `Zephras`, `Falaath` and `Windshaper` return **0 files** in the Forever UI tree — **but so
  does `Tirisfal`**, a definitely-real zone (`Tirisfal → 0`, `Skyborne → 4`, `SLASH_DUMP → 0`
  in both local `wow-ui-source@forever` clones, `version.txt` = `1.60.1.70009`). The tree is
  **not** where zone or race names live: the addon reads them from the client via
  `UnitRace("player")`, `UnitClass("player")`, `GetZoneText()`, `GetSubZoneText()`
  (`addon/WoWAI/WoWAI.lua:1248,1249,1263,1264`). So a tree grep proves **nothing** either way.
- `Skyborne` **does** appear (4 files) — but only as `Enum.Bc26Experience.Skyborne` in
  `Blizzard_Kiosk/BlizzCon2026/` (`Glue.lua`, `Utils.lua`, `ColdSwap.lua`,
  `BlizzCon2026Documentation.lua`). That is a **kiosk experience label**; on its own it neither
  confirms nor contradicts a Skyborne race. An earlier claim in this conversation that Skyborne
  was "just a BlizzCon kiosk enum" was an **over-read and is not repeated**.

**What actually settles it: Blizzard's own announcement, which is first-party and says both
names outright.** The card expected this to stay *pending confirmation*; it does not, and the
evidence is a published Blizzard article rather than an inference from this repo:

> **Home/Starting Location: Zephras Isle  Level Range: 1-12  Faction: Horde (Windshaper
> Skyborne) or Alliance (High Order Skyborne)**
> — *WoW: Forever Meet the New Skyborne*, `news.blizzard.com/en-us/article/24302071/wow-forever-meet-the-new-skyborne`

```
$ web_extract https://news.blizzard.com/en-us/article/24302071/wow-forever-meet-the-new-skyborne
→ "Zephras Isle serves as a new level 1–12 starting experience…"
→ "#### (Horde) Windshaper Skyborne"  /  "#### (Alliance) High Order Skyborne"
→ "Windshaper Skyborne: Druid, Hunter, Rogue, Shaman, Warrior"
```

`Longhairs` being a **Rogue** is consistent with that class list. Corroborated off Blizzard's
own site too (`worldofwarcraft.blizzard.com/en-us/news/`, the article's forum thread, and a
third-party write-up at `mmos.com`). So:

| Question | Status |
|---|---|
| Are `Zephras Isle` and `Windshaper Skyborne` real Forever content? | **YES — first-party Blizzard announcement** (URL above). Not an inference from this repo. |
| Did *this* client actually report them? | **Reported by the client, unverified by the `/wow-ai context` probe** — see below. |
| Is the tree-grep "0 hits" meaningful? | **No.** `Tirisfal` is also 0. Retired as evidence. |

**The probe has still never been run, and its output is not on disk.** `/wow-ai context` prints
`WoWAI.GameContext()` verbatim (`addon/WoWAI/WoWAI.lua:3300-3313`; help text `:3175`), needs no
bridge connection, and is the cheap way to confirm what the client itself reports. It was
searched for and **not found** anywhere: no `Game context is ON` reply exists in
`bridge/`, in the `game` profile's message store (`SELECT count(*) … LIKE '%Game context is
ON%'` → `0`), in the agent's own store, or in the vault. **Do not describe the client's report
as probe-confirmed.**

**`/dump` and `/run` — an earlier statement that Forever defines neither is wrong, and the
primer must not be edited on that basis.** Forever registers **both**: `SLASH_COMMAND.DUMP`
via `SlashCommandUtil.CheckAddSlashCommand(... DEBUG_COMMAND ...)`
(`Blizzard_ChatFrameBase/Shared/SlashCommands.lua:1385`) and `SLASH_COMMAND.SCRIPT` (= `/run`)
at `:1180`. What is true is narrower and is why the probe route was chosen:

- **Neither resolves by the alias-global route.** `SLASH_DUMP1` / `SLASH_RUN1` / `SLASH_SCRIPT1`
  / `SLASH_ETRACE1` are **absent from the entire tree** (`→ 0`), and command resolution works by
  `hash_SlashCmdList[command]` (`ChatFrameEditBox.lua:265`), built from the `SlashCmdList`
  *keys* (`ImportListToHash`, `ChatFrameUtil.lua:794-813`, called at `:817`). So
  `SLASH_DUMP = "DUMP"` never existed to find — **the absence of the `SLASH_*` global is not
  evidence the command is absent.**
- **Both are gated, not missing.** They are `DEBUG_COMMAND`-category, whose inclusion depends on
  the active game mode (`SlashCommands.lua:274-276`: only `IsGMClient()` inserts
  `DEBUG_COMMAND` into every mode's set). `/dump` additionally requires `AreDangerousScriptsAllowed()`
  (it raises `DANGEROUS_SCRIPTS_WARNING`) and is skipped under `Kiosk.IsEnabled()` or
  `C_AddOns.GetScriptsDisallowedForBeta()`; `/run` is skipped under `Kiosk.IsEnabled()`.

The operational conclusion stands — **use `/wow-ai context`, since it needs no bridge and no
gated command** — but the reason is *"debug commands are game-mode-gated and `/dump` needs
dangerous scripts allowed"*, **not** *"Forever defines no `/dump`/`/run`"*. The primer
(`docs/WOW-ADDON-PRIMER.md:80`) currently tells the agent to use `/dump` and `/run`; **that line
was left untouched**, because the claim that would justify removing it did not survive
measurement.

**`--resume` carries context.** Measured, not assumed: a fresh session was told a word, then
resumed, and recalled it. Session ids are stored per chat in `state.json`, so resuming
survives an addon data reset. In the live session above, #4 ran as `(new session)` and #5 and
#6 ran as `(resume 20260925)` — i.e. resume was exercised **in game**, not only in a test rig.

**In-game turns run as the `game` Hermes profile.** `bridge/config.json` carries
`agents.hermes.extraArgs: ["-p", "game"]`, the `game` profile exists at
`/home/jnick/.hermes/profiles/game`, and the profile's own session log records the run against
session `20260925_145311_071c97`:

```
$ grep -n '20260925_145311_071c97' /home/jnick/.hermes/profiles/game/logs/errors.log
51:2026-09-25 14:59:48,559 WARNING [20260925_145311_071c97] agent.tool_executor: Tool execute_code returned error …
52:2026-09-25 15:00:52,543 WARNING [20260925_145311_071c97] agent.tool_executor: Tool terminal returned error …
53:2026-09-25 15:02:08,104 WARNING [20260925_145311_071c97] agent.chat_completion_helpers: ⚠️  Reached maximum iterations (20). Requesting summary...
```

The adapter builds the flag correctly in both the fresh and resumed shapes — checked by calling
the adapter directly, not by reading it:

```
$ node -e "… A.AGENTS.hermes.args({cfg:{maxTurns:20,extraArgs:['-p','game']}, …})"
["chat","--query-file","-","--format","stream-json","-Q","--source","tool",
 "--no-restore-cwd","--in","/home/jnick/Whisperstone","--max-turns","20","-p","game"]
has -p game: true
RESUME ARGS: [… "--resume","20260925_145311_071c97","-p","game"]
has -p game (resume): true
```

**The approval boundary enforces — partial evidence only.** `game`'s `config.yaml` has
`command_allowlist: []` (verified: `grep -n command_allowlist /home/jnick/.hermes/profiles/game/config.yaml`
→ `12:command_allowlist: []`), and run #5 was in fact blocked, twice, with the block reported
by name in the profile's own log:

```
Tool execute_code returned error: BLOCKED: execute_code runs arbitrary local Python (including
  subprocess calls that bypass shell-string approval checks). Single-query mode (-q) runs
  without a user present to approve it.
Tool terminal returned error: BLOCKED: Command flagged as dangerous (script execution via
  -e/-c flag) but single-query mode (-q) runs without a user present to approve it.
```

That is real, live evidence the boundary acts on a message that came in from the game. It is
**not** the canary test described under *Next steps 2* — that test needs the same command blocked
in the game profile **and** unchanged behaviour in a normal profile, using a throwaway canary
file, with the canary deleted afterwards. Two blocked tools in one run is partial evidence, and
it is recorded as partial. **Next step 2 stays open.**

**Tool-progress lines work.** A live run produced
`progress: ["$ echo WHISPERSTONE_TOOLTEST"]` and a real reply. `tool_use` events are surfaced
as one readable line each; `tool_result` is deliberately silent.

**Test suite:** `npm test` → **58 tests, 56 pass, 2 fail** (measured this run). Both failures
are **pre-existing upstream**, Windows-path-semantics assertions running on Linux (`D:\elsewhere`
is not absolute to `path`; `path.basename` does not split on `\`). Upstream targets Windows/NTFS
with Windows-only CI. **Do not "fix" these by editing the tests** — a change there is
untestable against the real target platform. (Baseline before the minimap work was 49 tests /
47 pass / 2 fail; the minimap button added 5 tests and 5 passes, the professions fix added 1
test and 1 pass, and the stat/bags work added 3 more — the two failures are unchanged in count
and identity across all of them.) An earlier version of this note said **55 tests / 53 pass**;
that was true when written and is now stale, because later cards added tests. Re-run `npm test`
rather than trusting a count copied from this file.

---

## How it works (the part that is not obvious)

The addon cannot write files. WoW's Lua sandbox gives addons **no file-writing API** —
there are zero `io.open`/`io.write` calls in the addon, and there cannot be. So the two
directions use completely different mechanisms:

```
IN  → load-on-demand addons  (files work)
      The bridge writes replies into a pool of pre-made slot addons, each of which reads
      its own file from disk at the moment it loads. Each slot is single-use per session;
      /reload frees them all back.

OUT → the pixel strip  (files don't work, so: pixels)
      The addon draws its message as a grid of pure on/off colored cells. The bridge
      screen-captures one fixed 800x192 px rectangle at the window's top-left corner
      (200 cells x 4px wide, 48 rows x 4px tall) and decodes it back to text.
```

Why pixels: Blizzard disarms addons in combat and gates sensitive APIs, so the durable
channels are the boring ones. The alternatives — memory reading, synthetic input — are
exactly what we refused (see *Boundaries*). A pixel strip is dull, legal, and uninteresting.

**Fallback ("reload" mode):** SavedVariables + `Inbox.lua` with a `ReloadUI()` per step.
Slower, used when the slot pool is unavailable.

**The window also opens from a minimap button** (2026-09-25), so the door is not slash-command
only. It is a hand-rolled `Button` parented to Blizzard's `Minimap`, placed on an angle around
the minimap's centre using the same quadrant/clamp scheme LibDBIcon uses; the angle persists in
`db.settings.mapAngle`. Deliberately **not** a vendored `LibDBIcon-1.0` — that library needs
`LibStub`, `LibDataBroker-1.1` and `CallbackHandler-1.0` beside it, three more files for
`setup.js` to copy, to draw one button. No `.toc` change, so a `/reload` picks it up.
**Unit-tested, not clicked in game** — an agent has no way to press a button, so in-game
visibility, tooltip, drag and persistence remain the player's check.

**Capture is a fixed small rectangle, not a screenshot of the desktop.** It is sized once,
so it cannot widen. `capture.processName` is `WowB` — **if the client binary is ever
renamed, capture stops.** That is config (`capture.enabled`), not code.

---

## Current state

| Piece | State |
|---|---|
| `hermes` agent adapter (`bridge/agents.js`) | done, verified |
| Tool-progress lines (`bridge/protocol.js`) | done, verified; Claude output asserted byte-identical |
| Shipped default agent → `hermes` | done, verified |
| Live test hardened into a real gate | done, verified |
| Addon installed to the Forever beta | done — loads in game; **installed vs repo is a checked value, not an assumption** (see the drift check above) |
| **In-game round-trip (a message actually travelling)** | **PROVEN in game** (2026-09-25; see above) |
| Transport without `/reload` across several messages | **PROVEN** — three messages, one login session |
| In-game turns pinned to the `game` profile | done — `-p game`, confirmed in the profile's own log |
| Approval boundary | **partially verified** — see *Next steps 2*, still open |
| Real interface number measured | **done** — `16001`, from two sources that agree (below) |
| Gear / stats / bank awareness | **mostly built** — stat totals + filled/empty slot count (`t_52c484cb`), then what is **worn item-by-item** and the **wearable items in the bags** with the slot each competes for (`t_351dc648`), all riding the context; the **bank** is still deferred |
| StatForge port to Forever | separate project |

**The interface number is resolved, and by two sources that agree.** Only one of them is an
independent record; the other is the client's own read relayed by the addon, and it is labelled
that way rather than dressed up as a second independent measurement.

- **The client's own record.** `WTF/Config.wtf` now carries the key the earlier note asked for:

  ```
  $ grep -n lastAddonVersion "…/_classic_beta_/WTF/Config.wtf"
  125:SET lastAddonVersion "16001"
  ```

  It was absent when this note was first written; it appears once a login has reached the
  character screen, which is exactly what the old note predicted. Control, same key in the
  Classic Era client on this machine: `…/_classic_era_/WTF/Config.wtf:101:SET lastAddonVersion "11508"` —
  so the key is real and per-client, not a constant.
- **`GetBuildInfo`, via the addon's context block.** `WoWAI.GameContext()` reads
  `GetBuildInfo()` (`addon/WoWAI/WoWAI.lua:950`) and the live context the bridge holds carries
  the number: `bridge/state.json` → `context.text` →
  `Game: World of Warcraft: Forever (client 1.60.1.70009, interface 16001)`. That is the addon's
  read of the client, relayed — the provenance is **GetBuildInfo via the context block**, not a
  fresh independent measurement by the bridge, and not `Config.wtf`.

Both agree with `addon/WoWAI/WoWAI.toc` (`## Interface: 16001`), so the `.toc` no longer rests on
upstream's word alone. Do **not** describe the number as "read from `Config.wtf`" as if that were
the only channel, and do not describe the context block as an independent read — it is the
addon's own reading passed along.

**`["history"]` is no longer empty — that open item has closed itself.** The earlier note
flagged it as unverifiable while logged in, because WoW only flushes SavedVariables on logout or
`/reload`. The client has since logged out, and the file now holds the conversation:

```
$ grep -n '\["role"\]' "…/WTF/Account/<id>/SavedVariables/WoWAI.lua"
41:["role"] = "user",      42:["id"] = 4      (id 4 assistant reply at :47)
54:["role"] = "user",      55:["id"] = 5      (id 5 system "Bridge error:" reply at :60)
66:["role"] = "user",      67:["id"] = 6      (id 6 assistant reply at :72)
```

So the addon's own saved data now corroborates the round-trip from the client side, including
the `Bridge error:` prefix on #5. This also pins the timing: the flush happened at
`2026-09-25 15:12:12 EDT` (`ls -l` mtime), *after* the last run ended at `19:08:32Z`, i.e. on
logout rather than mid-session. A mid-session `/reload` would have written earlier.

**The agent does not currently see gear — no longer true of stats and slot counts, still true of
items.** Worth stating precisely, because both halves are easy to mistake: until `t_52c484cb`,
`WoWAI.GameContext()` sent game, character, location, position, money and XP — **no equipped items
and no stats** — and an in-game reply offered "quest help, a macro, gear advice, or just chatting"
because `bridge/protocol.js` tells the agent in its context block that *"gear advice"* is one of the
kinds of request the game context is for. That was the prompt suggesting a topic, **not** the agent
reading your gear.

As of `t_52c484cb` the block also carries **two compact summary lines** — stat totals from the
character sheet and a filled/empty equipment-slot count — measured at 444 bytes against the 700-byte
cap on the test harness (see the test named *"the game context sends stat totals and a filled/empty
slot count…"*, which prints its own byte count when it runs). **No item names and no bag or bank
contents reach the agent yet**: the itemised gear list is 437 bytes for a 16-slot character
(`phase-b-l2-scoping.md` §5.3), which does not fit beside a real message, and belongs on the
host-side SavedVariables lane — a later card. So *"do I have an upgrade in my bags?"* is still not
answerable; *"what are my stats and how many slots are empty?"* is.

**What the context carried before that change, verbatim.** `bridge/state.json` → `context.text`,
the block the bridge handed the agent on run #6, was 234 bytes:

```
Game: World of Warcraft: Forever (client 1.60.1.70009, interface 16001)
Character: Nous on Classic Beta PvE, level 9 Undead Warlock (Horde)
Location: Tirisfal Glades - Brill
Position: 56.1, 46.9 (map 1420)
Money: 30s 5c; XP: 4931/6500
```

Two honest observations about that sample, both of which contradict wider claims in the docs:

- **No `Talents:` line in this sample — and that absence was over-determined, not evidence.** The
  code called the vanilla tab loop (`GetNumTalentTabs` / `GetTalentTabInfo`,
  `addon/WoWAI/WoWAI.lua:1014`), which cannot run on this client: `GetNumTalentTabs` appears
  nowhere in the Forever UI tree, and `GetTalentTabInfo` / `GetTalentInfo` are defined only by
  `Blizzard_DeprecatedSpecialization`, whose `.toc` carries
  `## AllowLoadGameType: classic, standard` — `camelot` is not in that list, so that addon never
  loads here. The character was also **level 9**, and Forever grants the first talent point at 10,
  so the line could not have appeared either way. The two causes are indistinguishable from the
  live block alone, which is why this was judged in the harness and not in game. Fixed by
  `t_481b5951` to use `C_SpecializationInfo.GetSpecialization()` →
  `GetSpecializationInfo(specIndex)`, the pair Blizzard's own camelot-only `PaperDollFrame.lua`
  calls (there is no tab count to walk: the namespace has no `GetNumTalentTabs` equivalent).
- **No `Professions:` line in this sample — and that absence was a defect, not a character fact.**
  The code called the bare `GetNumSkillLines` / `GetSkillLineInfo` globals (`:1027`), which **do
  not exist on Forever** (skills are `C_SkillInfo.*`, and `C_SkillInfo.GetSkillLineInfo(index)`
  returns one `SkillLineAttributes` table rather than a positional list), so the call returned
  nothing and the line was never built. Fixed by `t_35f44ba8` to use `GetProfessions()` /
  `GetProfessionInfo(index)`, the pair Blizzard's own camelot-only professions UI calls. Proven in
  the harness, not in game: the live character may also have no professions trained, so the line's
  absence was over-determined and **in-game appearance cannot judge this fix.**

`README.md` and this note both previously described the context as carrying "talents and
professions"; the live block shows neither. Both were real defects, and both are now fixed and
covered by tests that fail against the old code: professions by `t_35f44ba8`, talents by
`t_481b5951`. **The `README` line is left as upstream's text** (it describes the addon's intent
and the other clients) and is not touched by these cards.

**Both lines are now PROVEN IN GAME — the harness-only caveat above is discharged.** The block
the agent was actually handed at `#18` (`2026-09-25T22:03:29.974Z`) carries both, read from the
`game` profile's stored prompt (session `20260925_180335_efe40f`):

```
Game: World of Warcraft: Forever (client 1.60.1.70009, interface 16001)
Character: Longhairs on Classic Beta PvE, level 10 Windshaper Skyborne Rogue (Horde)
Location: Zephras Isle - Gustberry Lowlands
Position: 55.2, 75.8 (map 2521)
Money: 41s 18c; XP: 262/7600
Talents: Rogue 0
Professions: Fishing 4/75, Cooking 1/75
```

These two lines had **never** appeared in this project's history before that run. Provenance is
the two committed fixes: `068f21f` (professions, via `GetProfessions()` /
`GetProfessionInfo(index)`) and `2bab866` (talents, via `C_SpecializationInfo`). The card's
addendum recorded `Fishing 2/75` at ~17:3x; it reads **`4/75`** here, i.e. the value moved
between readings — itself corroboration that this is a live client read and not a constant.

- **`Talents: Rogue 0` is correct, not a fault — do not file it as a bug.** The code omits the
  line only when the spec *index* is 0, the guard being
  `if type(spec) == "number" and spec > 0 then` (`addon/WoWAI/WoWAI.lua:1401`, read at `:1402`).
  Here the client **did** describe the spec — the name came back as `Rogue` — and returned
  `pointsSpent = 0`, so the line was produced legitimately. The character has simply spent no
  talent points yet. It is a genuine client read, not a fallback.
- **OPEN QUESTION (not asserted): why the spec *name* is the CLASS name (`Rogue`) rather than a
  tree name.** A class-specialization frame does exist at
  `Blizzard_PlayerSpells/Camelot/ClassSpecializations/`, but the name source was not traced.
  *Measured*: the client returned `Rogue` with 0 points. *Inference, do not assert*: Forever
  names single specs after the class. **What settles it is a point spent** — the number should
  then tick up past 0, and the name should be re-read at the same time.
- **Fishing and Cooking are SECONDARY skills, and the old approach would have mishandled them.**
  The retired code matched header strings against `TRADE_SKILLS` / `SECONDARY_SKILLS`, which is
  locale-fragile; the category-based read (`GetProfessions()` → `GetProfessionInfo(index)`) got
  both right on a client whose skill names are not the ones those tables assume. That is a point
  in favour of the new approach, and it is why these two lines are evidence for the fix rather
  than decoration.

---

## Next steps

**1. The in-game round-trip is done — it is no longer a next step.**

Kept here only as the runbook, because it is what you do before a live test:

```bash
bash bridge/start-wsl.sh        # from WSL (see the launcher note below)
# or, on Windows:  npm start   # in the repo root, BEFORE logging in
# in game:  /wow-ai   →  type a message  →  Send
```

The bridge must be running while the client is logged in. Success = `/wow-ai` shows the
message and a reply arrives with the whisper sound. Both halves of that have now been
observed, and the two "read it out of a file afterwards" checks below have both been satisfied:

- ~~read the real interface number out of `WTF/Config.wtf` (`lastAddonVersion`)~~ — **done**:
  `SET lastAddonVersion "16001"` is now present and agrees.
- ~~confirm `["history"]` is non-empty in `SavedVariables/WoWAI.lua`~~ — **done**: it holds the
  id 4–6 conversation.

**Still worth running, because they are different situations and neither has been tested:**

- **Inside an instance.** The round-trip is proven in the open world only — and as of this
  note in **three** open-world zones (`Tirisfal Glades` map 1420, `Zephras Isle` map 2521,
  `The Barrens` map 1413). Addon chat can be restricted on addon-restricted maps
  (dungeons/raids) and this has never been tried on Forever. Get into a dungeon, `/wow-ai`,
  send, and report whether the reply arrives or the strip never clears.
- **After a full relog.** A SavedVariables wipe is the other failure mode; a relog is the test
  for it, and it doubles as a clean check of the logout path.

**1b. Run the two settling probes — both are cheap, in-game, and neither has been done.** The
first closes the open question above; the second confirms what the client reports. Both need
the game window and nothing else — no bridge connection.

- **`/wow-ai context`** — prints `WoWAI.GameContext()` verbatim (`WoWAI.lua:3300-3313`). Record
  its output as the confirmation of what the client reports (it is currently **unverified by
  this probe** — see the Windshaper/Zephras section). Prefer this over `/dump`/`/run`, which are
  game-mode-gated debug commands, not absent ones.
- **Spend one talent point**, then re-read the `Talents:` line. The number should tick up past
  `0`, and the spec *name* should be read at the same time. That single observation settles both
  halves of the talents open question: whether the counter is live, and whether the name really
  is the class name.

**2. Verify the approval boundary with canaries — still OPEN.** Configuring is not verifying,
and partial evidence does not close this. The test that settles it: a destructive command
attempted in the game profile's context must be **blocked**, while the same command in a normal
profile still behaves as before. Use a throwaway canary file, inspect the result, delete the
canary.

What has been observed so far, and why it is not the test: run #5 was blocked from
`execute_code` and from `node -e` by the `game` profile's approvals (verbatim block messages in
*What is actually proven*). That is one side of the test — blocked in the game profile — from a
single in-game run. The control half (**unchanged behaviour in a normal profile**) has not been
run, and no canary file was used. Treat it as partial.

**3. Phase B — gear, stats and bank.** The `gameContext` slot carries ~700 bytes. As of
`t_52c484cb` it carries game/character/location/position/money/XP plus **stat totals and a
filled/empty equipment-slot count** (444 bytes measured on the harness, 9 lines) — the compact
half of L2. **Itemised gear, bags and the bank are still not sent**, and the pre-change block
(234 bytes, in *Current state*) is quoted above for comparison; the earlier version of this note
said the code *attempted* talents and professions and that the measured block carried neither,
which was true at the time and is now fixed (`t_35f44ba8`, `t_481b5951`). What the *minimum*
useful snapshot is, given the byte budget, is answered by `docs/whisperstone/phase-b-l2-scoping.md`
(card `t_18b783f6`) — that document is the authority on what fits, including its measurement that a
16-slot itemised listing is 437 bytes and does **not** fit.

**4. Phase C — StatForge → Forever** (separate project). `StatForge` is on this machine at
`/home/jnick/StatForge` and its `.toc` reads
`## Interface: 11509, 16001, 120100` — so the older "targets Classic Era (`11508`) only" claim
in this note was **stale**, and the port is partly moot already. It still calls
`GetNumTalentTabs`, which is genuinely absent from Forever. See
`docs/whisperstone/phase-b-l2-scoping.md` for the measured detail, including a real defect in
StatForge's bank reader (`SF.BANK_BAGS` assumes the Classic-Era `BagIndex` layout; on Forever
`-1` is Keyring and the bank lives at 6–14 / 15–23). That is a port, not a config change.

---

## Boundaries (deliberate refusals, still in force)

- **No memory reading.** The "Warden doesn't flag read-only" claim is an author assertion,
  not Blizzard's words.
- **No synthetic input / Ctrl+V automation.** Input synthesis is what actually gets accounts
  actioned.
- **No combat or protected APIs.** Verified absent: the addon registers only
  `ADDON_LOADED`, `PLAYER_LOGIN`, `PLAYER_REGEN_ENABLED`, `CHAT_MSG_WHISPER`,
  `CHAT_MSG_BN_WHISPER`. Its entire outbound vocabulary is `PlaySoundFile`,
  `SetColorTexture`, `C_AddOns.LoadAddOn` — it **cannot** cast, move, target, loot or
  trade. That containment is by construction, not by discipline.
- **It does not read general game chat.** No `CHAT_MSG_SAY` / `YELL` / `PARTY` / `GUILD` /
  `CHANNEL`. The whisper handler uses only the *event*, never the message body (it exists so
  `/r` keeps working).
- **The addon folder is the only thing the bridge writes** into the game directory; nothing
  touches game binaries, `Data/`, or the client executable.

**The real risk is not a ban — it is the agent's own reach.** The addon is contained; the
agent behind it is not. It has a real shell. Game text is isolated, but an instruction that
reaches that agent (including one relayed from a whisper) is an instruction. The governing
control is the host's approval layer, and that layer must be verified, not assumed — see
*Next steps 2*, which is still open. What is measured so far is that the layer **does** fire on
a message that arrived from the game (two tools blocked in run #5); what is not yet measured is
the control half, that an ordinary profile is unaffected.

---

## Running the bridge from WSL

**On Windows, `npm start` is unaffected — nothing here changes the documented Windows path.**
This section is only for starting the bridge from *inside WSL*.

`bridge/start-wsl.sh` starts the bridge from WSL and is **required** there. What it is for, and
what it actually fixes, measured rather than assumed:

```
$ node -e "…spawnSync('powershell.exe', …); spawnSync('taskkill', …)…"   # PATH with the WSL defaults only
spawn(powershell.exe) status: null  err: ENOENT
spawn(taskkill)       status: null  err: ENOENT

$ …same probe, with start-wsl.sh's four dirs appended to PATH
spawn(powershell.exe) status: 0     err: none   out: "INTEROP_OK"
spawn(taskkill)       status: null  err: ENOENT      ← still ENOENT
```

So, precisely:

- **What the launcher fixes: `powershell.exe`.** `bridge.js:625` spawns `powershell.exe` bare to
  run `capture.ps1`. On a PATH without the Windows interop directories that dies with
  `Error: spawn powershell.exe ENOENT`, and the supervisor (`bridge/supervisor.js`) restarts
  `bridge.js` every 3 s — a crash loop that **still prints a healthy-looking banner**, because
  the banner is printed before the capture spawn.
- **What it does not fix: bare `taskkill`.** `bridge.js:221` spawns `taskkill` (no `.exe`).
  Under WSL the interop layer only exposes Windows executables under their full `*.exe` names —
  `spawn('taskkill.exe')` resolves and runs (`status: 128, "ERROR: The process … not found."`,
  i.e. it executed and reported normally), while `spawn('taskkill')` is `ENOENT` **on any PATH**,
  including the launcher's. The launcher's own guard does not catch this because it checks
  `command -v taskkill.exe`, which *does* resolve.

  Consequence, scoped honestly: `killTree` is only reached on Windows (`process.platform` is
  `linux` under WSL, so the whole `if` is skipped) — it is the path that kills a timed-out agent
  **and its children**. On WSL, a run that hits `timeoutMs` therefore falls back to
  `child.kill()`, which may leave a grandchild agent process behind. **Not observed in practice**
  — no WSL run has hit the 30-minute timeout — so this is a known gap, not a measured failure.
  Fixing it means passing the `.exe` name on the WSL path; that is a code change and out of
  scope for a docs card.

Usage:

```bash
bash bridge/start-wsl.sh          # Ctrl+C to stop
```

It `cd`s to the repo root, appends the four Windows directories to `PATH`, checks both binaries
resolve, and `exec`s the supervisor. **Verified running right now**: the live supervisor's
environment carries exactly those four appended entries, and its parent is
`/bin/bash -lic set +m; cd /home/jnick/Whisperstone && bash bridge/start-wsl.sh`.

Worth knowing when you compare notes with a *fresh* WSL shell: this machine's WSL **does**
normally export the Windows directories onto `PATH` (checked through `wsl.exe` — 17 `/mnt/c`
entries, `powershell.exe` resolves), so a plain `npm start` from a normal WSL terminal may well
work. The launcher's value is that it does not depend on that: a shell started without the
Windows `PATH` — a service, a nested `bash -c`, a cron job, a container-style invocation — has
neither binary, and the launcher makes the bridge start anyway. `appendWindowsPath` is not
disabled in `/etc/wsl.conf` here (the file has only `[boot]` and `[user]` sections), which is
why the plain shell works.

---

## Files worth knowing

| Path | What it is |
|---|---|
| `docs/whisperstone/2026-09-24-hermes-integration.md` | the adapter contract + measured stream-json event list |
| `docs/whisperstone/2026-09-24-default-agent-hermes.md` | why the shipped default is `hermes` |
| `bridge/agents.js` | agent table; the `hermes` entry |
| `bridge/protocol.js` | codec, slot/signal tables, `describeToolUse` |
| `bridge/bridge.js` | the loop: read strip, run agents, write slots |
| `bridge/capture.ps1` | the read-only screen capture (one fixed rectangle) |
| `bridge/supervisor.js` | keeps `bridge.js` alive; restarts it 3 s after any exit |
| `bridge/start-wsl.sh` | starts the supervisor from WSL with the Windows interop dirs on `PATH` |
| `addon/WoWAI/WoWAI.lua` | the whole addon (Lua sandbox side) |
| `docs/whisperstone/phase-b-l2-scoping.md` | Phase B (L2) scoping: gear/stats/bank carrier, byte budget, StatForge reuse |
| `docs/WOW-ADDON-PRIMER.md` | what the agent is told about the in-game context |

## Credit

Transport, addon, slot/signal machinery and the agent-adapter pattern are
[`chelinho139/wow-ai`](https://github.com/chelinho139/wow-ai), MIT. Our additions are the
`hermes` adapter, its config, docs and tests. `upstream` is kept as a git remote so we can
sync and offer the adapter back.
