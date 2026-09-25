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
| **L2** | The agent knows your **gear, stats and bank** | deferred (Phase B) — **the agent does not see gear today**, see below |
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
written by the addon's own logout handler — its existence is hard proof the addon ran.
Installed addon is byte-current with repo `HEAD`:

```
$ sha256sum addon/WoWAI/WoWAI.lua
73b03c0a894d8a9f56226e17510cdc484baf2affca8e8778ff3132a849fcba6c  addon/WoWAI/WoWAI.lua
$ sha256sum ".../Interface/AddOns/WoWAI/WoWAI.lua"
73b03c0a894d8a9f56226e17510cdc484baf2affca8e8778ff3132a849fcba6c  .../AddOns/WoWAI/WoWAI.lua
$ grep -n Interface addon/WoWAI/WoWAI.toc
1:## Interface: 16001
$ ls -d ".../Interface/AddOns/"WoWAI_S* | wc -l
200
$ grep -l WoWAI ".../WTF/Account/<id>/70"/*/AddOns.txt | wc -l   # enabled characters
8
```

(`Codec.lua` and `WoWAI.toc` also match the installed copies, hashes `ae432db4…` and
`d615ec6f…`. `Inbox.lua` is bridge-owned at runtime and is not compared.)

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
session with no `/reload`. The evidence is a `grep -c` of the bridge's own hello log line over
the whole file:

```
$ grep -c 'hello from session' bridge/bridge.log
1
$ grep -n 'hello from session' bridge/bridge.log
67:[2026-09-25T18:53:00.420Z] hello from session b5db4e4c439d8b
```

The addon sends that hello once at login and again on each `/reload` or **Connect** press
(`WoWAI.SayHello`, throttled to one per 60 s) and the bridge logs one line per hello received.
Exactly one hello appears across the entire session that carried ids #3–#6, so no `/reload` and
no relog happened between them. The load-on-demand slot pool recycled correctly across all
three: `sig`, `ack`, `act` 004, 005 and 006 are all present with the 124-byte payload, and the
`act/` dirs for 004–006 were rebuilt during that window.

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

**Test suite:** `npm test` → **55 tests, 53 pass, 2 fail**. Both failures are **pre-existing
upstream**, Windows-path-semantics assertions running on Linux (`D:\elsewhere` is not
absolute to `path`; `path.basename` does not split on `\`). Upstream targets Windows/NTFS
with Windows-only CI. **Do not "fix" these by editing the tests** — a change there is
untestable against the real target platform. (Baseline before the minimap work was 49 tests /
47 pass / 2 fail; the minimap button added 5 tests and 5 passes, and the professions fix
added 1 test and 1 pass — the two failures are unchanged in count and identity across all
three.)

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
| Addon installed to the Forever beta | done — loads in game, byte-current |
| **In-game round-trip (a message actually travelling)** | **PROVEN in game** (2026-09-25; see above) |
| Transport without `/reload` across several messages | **PROVEN** — three messages, one login session |
| In-game turns pinned to the `game` profile | done — `-p game`, confirmed in the profile's own log |
| Approval boundary | **partially verified** — see *Next steps 2*, still open |
| Real interface number measured | **done** — `16001`, from two sources that agree (below) |
| Gear / stats / bank awareness | deferred (Phase B) — **the agent does not see gear today** |
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

**The agent does not currently see gear.** Worth stating plainly because it is easy to mistake
for a working feature: `L2` is not built, and `WoWAI.GameContext()` sends game, character,
location, position, money and XP — **no equipped items and no stats**. An in-game reply offered
"quest help, a macro, gear advice, or just chatting" because `bridge/protocol.js` tells the
agent in its context block that *"gear advice"* is one of the kinds of request the game context
is for. That is the prompt suggesting a topic, **not** the agent reading your gear. Phase B
scoping is a separate card (`t_18b783f6`); nothing here pre-empts it.

**What the context actually carried, verbatim.** `bridge/state.json` → `context.text`, the
block the bridge handed the agent on run #6, is 234 bytes:

```
Game: World of Warcraft: Forever (client 1.60.1.70009, interface 16001)
Character: Nous on Classic Beta PvE, level 9 Undead Warlock (Horde)
Location: Tirisfal Glades - Brill
Position: 56.1, 46.9 (map 1420)
Money: 30s 5c; XP: 4931/6500
```

Two honest observations about that sample, both of which contradict wider claims in the docs:

- **No `Talents:` line**, which is consistent with `GetNumTalentTabs` being absent from Forever
  — the call is a no-op behind `Try()` and the guard never fires
  (`addon/WoWAI/WoWAI.lua:1014`). The code path exists; it cannot produce output on this client.
  Its own card (`t_481b5951`) owns the fix.
- **No `Professions:` line in this sample — and that absence was a defect, not a character fact.**
  The code called the bare `GetNumSkillLines` / `GetSkillLineInfo` globals (`:1027`), which **do
  not exist on Forever** (skills are `C_SkillInfo.*`, and `C_SkillInfo.GetSkillLineInfo(index)`
  returns one `SkillLineAttributes` table rather than a positional list), so the call returned
  nothing and the line was never built. Fixed by `t_35f44ba8` to use `GetProfessions()` /
  `GetProfessionInfo(index)`, the pair Blizzard's own camelot-only professions UI calls. Proven in
  the harness, not in game: the live character may also have no professions trained, so the line's
  absence was over-determined and **in-game appearance cannot judge this fix.**

`README.md` and this note both previously described the context as carrying "talents and
professions"; the live block shows neither. For professions that was a real defect, now fixed and
covered by a test that fails against the old code. **The `README` line is left as upstream's text**
(it describes the addon's intent and the other clients) and is not touched by this card.

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

- **Inside an instance.** The round-trip is proven in the open world (Tirisfal Glades) only.
  Addon chat can be restricted on addon-restricted maps (dungeons/raids) and this has never been
  tried on Forever. Get into a dungeon, `/wow-ai`, send, and report whether the reply arrives or
  the strip never clears.
- **After a full relog.** A SavedVariables wipe is the other failure mode; a relog is the test
  for it, and it doubles as a clean check of the logout path.

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

**3. Phase B — gear, stats and bank.** The `gameContext` slot carries ~700 bytes; today it
holds game/character/location/position/money/XP — and **no gear is sent at all** (see the
verbatim 234-byte block in *Current state*). The code also *attempts* talents and professions,
but the measured block carried neither, so treat both as unverified rather than present.
Extending this is the L2 step. Open question: what the *minimum* useful snapshot is, given
the byte budget. Scoping lives in `docs/whisperstone/phase-b-l2-scoping.md` (card
`t_18b783f6`) — that document is the authority on what fits; this note only records that the
feature does not exist yet.

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
