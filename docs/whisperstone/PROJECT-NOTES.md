# Whisperstone — project notes

**Status:** Phase A complete and verified. The bridge half is done and proven offline.
The in-game round-trip has one step left (see *Next steps*).

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
| **L0** | Door: type in game, get a reply from a real agent | **built, needs one live round-trip** |
| **L1** | The agent knows *who* you are (character, zone, position) | **built** (context block) |
| **L2** | The agent knows your **gear, stats and bank** | deferred (Phase B) |
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
sha256 WoWAI.lua   installed 0dc64f9c479e073e…  =  repo 0dc64f9c479e073e…
WoWAI.toc          identical          (## Interface: 16001)
slot dirs          WoWAI_S001…S200 present; enabled on all 8 characters
```

**`--resume` carries context.** Measured, not assumed: a fresh session was told a word, then
resumed, and recalled it. Session ids are stored per chat in `state.json`, so resuming
survives an addon data reset.

**Tool-progress lines work.** A live run produced
`progress: ["$ echo WHISPERSTONE_TOOLTEST"]` and a real reply. `tool_use` events are surfaced
as one readable line each; `tool_result` is deliberately silent.

**Test suite:** `npm test` → **49 tests, 47 pass, 2 fail**. Both failures are **pre-existing
upstream**, Windows-path-semantics assertions running on Linux (`D:\elsewhere` is not
absolute to `path`; `path.basename` does not split on `\`). Upstream targets Windows/NTFS
with Windows-only CI. **Do not "fix" these by editing the tests** — a change there is
untestable against the real target platform.

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
| **In-game round-trip (a message actually travelling)** | **NOT PROVEN** |
| Real interface number independently measured | **not yet** |
| Gear / stats / bank awareness | deferred (Phase B) |
| StatForge port to Forever | separate project |

**Two things deliberately left open:**

- **The real interface number is still unconfirmed.** `WTF/Config.wtf` has no
  `lastAddonVersion` (that key needs a login that reaches the character screen). The `.toc`
  carries `16001`, which is **upstream's value, never independently measured here.** Do not
  report it as measured.
- **`["history"]` is empty.** The client has been logged into with the addon loaded, and
  the character was moved around, but **no message has yet travelled through the addon.**
  That is the single remaining unproven link.

---

## Next steps

**1. Prove the in-game round-trip (the only blocker).**

```bash
npm start                      # in the repo root, BEFORE logging in
# in game:  /wow-ai   →  type a message  →  Send
```

The bridge must be running while the client is logged in. Success = `/wow-ai` shows the
message and a reply arrives with the whisper sound. Then:

- read the real interface number out of `WTF/Config.wtf` (`lastAddonVersion`) and correct
  the `.toc` if it disagrees with `16001`
- confirm `["history"]` is non-empty in `SavedVariables/WoWAI.lua`

**2. Decide which profile answers in-game — and pin it.**

**This is an open gap, not a finished decision.** The bridge spawns
`hermes chat --query-file - …` with **no `-p` and no `HERMES_HOME`**, so it inherits the
shell and currently lands on the **`default` profile**. Whichever profile answers is the one
whose approvals and allowlist actually govern the agent.

Recommended shape (untested, not yet built):

- create a dedicated profile (e.g. `game`). A **new profile starts with an empty
  `command_allowlist`** — so it is correct by construction, rather than requiring entries to
  be stripped out of an existing profile (where they can silently be re-added by a later
  "[a]lways" click).
- pin it without touching code: `agents.hermes.extraArgs: ["-p", "game"]` in
  `bridge/config.json` (`extraArgs` already exists in the adapter).
- choose its model deliberately. This is the moment to decide whether game context
  (character name, realm, guild, live map coordinates) is allowed to reach a remote
  provider or should stay on a local model.

**3. Verify the approval boundary with canaries.** Configuring is not verifying. The check
that settles it: a destructive command attempted in the game profile's context must be
**blocked**, while the same command in a normal profile still behaves as before. Use a
throwaway canary file, inspect the result, delete the canary.

**4. Phase B — gear, stats and bank.** The `gameContext` slot carries ~700 bytes; today it
holds game/character/location only. Extending it is the L2 step. Open question: what the
*minimum* useful snapshot is, given the byte budget.

**5. Phase C — StatForge → Forever** (separate project). `StatForge` targets Classic Era
(`## Interface: 11508`) and calls `GetNumTalentTabs` / `GetTalentInfo`, both **removed in
Forever**. That is a port, not a config change.

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
control is the host's approval layer, and that layer must be verified, not assumed.

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
| `addon/WoWAI/WoWAI.lua` | the whole addon (Lua sandbox side) |
| `docs/WOW-ADDON-PRIMER.md` | what the agent is told about the in-game context |

## Credit

Transport, addon, slot/signal machinery and the agent-adapter pattern are
[`chelinho139/wow-ai`](https://github.com/chelinho139/wow-ai), MIT. Our additions are the
`hermes` adapter, its config, docs and tests. `upstream` is kept as a git remote so we can
sync and offer the adapter back.
