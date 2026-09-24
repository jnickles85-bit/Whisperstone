# Whisperstone — Design

**Date:** 2026-09-24
**Status:** Approved (design); pending implementation plan
**Target client:** World of Warcraft: Forever (beta, `_classic_beta_`, build 1.60.1)

## Purpose

Let Mightie talk to his Hermes agent from inside World of Warcraft, without alt-tabbing,
in a chat window that is grounded in his live character state.

The differentiator is the far end of the wire: other projects in this space point their
bridge at a generic chat-completions endpoint and get a stateless chatbot. Whisperstone
points at the Hermes Agent API server, so the thing answering in the game window is a real
agent with tools, memory, skills, and the vault.

## Constraints that shape everything

> **CORRECTION — 2026-09-24, after reviewing prior art.** This section originally claimed the
> two-reload round-trip was *inherent to the sandbox*. **That is wrong.** Live carriers exist
> and are in production: an on-screen **pixel strip** outbound plus **LoadOnDemand slot
> addons** inbound, which need no `/reload` per message. See "Transport" below and
> `docs/superpowers/specs/2026-09-24-whisperstone-transport-correction.md`. The reload path
> remains correct and cheap to build, but it is a *choice*, not a limit.

1. **The WoW addon sandbox has no network access.** No sockets, no HTTP, no file I/O, and no
   way to receive input from another process. An addon *alone* can never reach an agent. This
   is not a solvable problem; it is the reason every project in this space is two parts.

2. **WoW reads addons, addon *folders* and SavedVariables only at load**, and flushes
   SavedVariables only on logout or `/reload` — and `ReloadUI()` can only be called from a
   hardware event, never a timer. A pure file round-trip therefore costs two UI reloads per
   exchange. **Live carriers route around this** (see Transport).


3. **Forever runs on Mainline's UI architecture**, sharing "the vast majority of APIs
   available in 12.1.5" (Blizzard WoW UI team). Midnight's addon disarmament applies in
   full, secret values included. The beta client reports `WOW_PROJECT_ID = 1` — the *retail*
   value — so this is written as a **mainline** addon. Classic-era addon patterns
   (`GetItemInfo`, `GetSpellInfo`, `GetTalentInfo`) do not apply; use `C_Item`, `C_Spell`,
   `C_Traits`.

4. **Secret values are a non-issue for this addon by design.** Secret values restrict
   combat math on restricted maps. Whisperstone never reads `UnitHealth`, never compares
   unit values, and never performs combat arithmetic. No combat API is touched at all.

## Architecture

```
┌──────────────────────┐        ┌───────────────────────┐        ┌──────────────────────────┐
│  Whisperstone addon  │ files  │  Bridge (Python)      │  HTTP  │  Hermes API server       │
│  (Lua, in-game)      │◀──────▶│  host process         │◀──────▶│  127.0.0.1:8642          │
│                      │        │                       │        │                          │
│  chat window UI      │        │  watch SavedVariables │        │  YOUR agent: tools,      │
│  writes outbox       │        │  POST to Hermes       │        │  memory, skills, vault   │
│  reads inbox         │        │  write inbox          │        │  (bearer API_SERVER_KEY) │
└──────────────────────┘        └───────────────────────┘        └──────────────────────────┘
```

### Components

**1. Whisperstone addon (Lua)** — one clear purpose: collect a question plus a snapshot of
the player's situation, hand it to the bridge, and render whatever comes back. It knows
nothing about Hermes, models, or HTTP. Interface: a slash command to toggle the window,
a text entry, a Send action, a Fetch action, and a settings table in SavedVariables.

**2. Whisperstone bridge (Python, host)** — one clear purpose: move a message between the
addon's files and the Hermes API server, and own all the trust decisions. It watches the
addon's SavedVariables file for a new question, posts it to Hermes, and writes the reply
into the addon folder. It is the only component that holds a credential or touches the
network.

**3. Hermes API server** — already exists. Verified live: enabled in the default profile at
`display.platforms.api_server`, bound to `127.0.0.1:8642`, bearer-key gated via
`API_SERVER_KEY` (an unauthenticated request returns `401 gateway_auth_failed`). The `ara`
profile's `display.platforms` block lists telegram and discord but has **no** `api_server`,
so ara serves no API server; Phase 2 must confirm which profile Whisperstone targets and
enable the server there rather than assuming.

### Two conflict-free file lanes

- **Outbox (addon → bridge):** the addon writes question plus context into its own
  SavedVariables. WoW owns this file; the bridge only ever reads it.
- **Inbox (bridge → addon):** the bridge writes the reply into a file inside the addon's
  own folder. WoW never writes there (it only writes to `WTF/`), so replies cannot be
  clobbered.

Payloads are Base64(JSON) in both directions. The inbound file contains **only data, never
executable Lua**, so the bridge has no code-injection path into the client.

## Data flow (one exchange)

1. Player types a question in the Whisperstone window and hits Send.
2. Addon stores the question plus context snapshot in SavedVariables, then triggers a
   `/reload` to flush it to disk.
3. Bridge detects the new question, marks it in-flight, POSTs to the Hermes API server.
4. Hermes answers. Bridge writes the reply into the inbox file in the addon folder.
5. Player hits Fetch → `/reload` → the addon reads the inbox at load and renders the answer.

Steps 2 and 5 are the two reloads. Everything else is automatic.

## Trust model

This addon is a remote control for an agent that can run commands. Treated accordingly:

- **In-game text is untrusted data, never instructions to the bridge.** Player and chat
  text is fenced in explicit data delimiters before it reaches the agent, following the
  `<in_game>…</in_game>` pattern that `wow-llm-personas` uses and documents as an
  A/B-proven fix. Prompting raises the bar; it is not a hard guarantee, and the spec says
  so rather than implying safety it cannot deliver.
- **The credential lives only in the bridge**, in a config file outside the addon folder.
  It is never written into SavedVariables.
- **The bridge writes only data into the addon folder.**
- **Outbound scope:** agent turns are full-tool. The blast radius of a successful injection
  is therefore the machine, not just the game. This is accepted deliberately as the Phase 3
  end state, and is the reason Phase 1 ships with no AI attached.

### Explicitly rejected — still rejected

- **Memory reading** (read-only `ReadProcessMemory` against the client) — the "Warden does
  not flag read-only access" claim is an author self-assertion, not a Blizzard statement.
- **Synthetic input** (simulated Ctrl+C/Ctrl+V into the game window) — input automation is
  the pattern that actually gets accounts actioned.

Neither is implemented, and neither is *needed*: the live carriers described in the transport
correction achieve no-reload operation using documented addon APIs plus screen capture and
ordinary file writes, which is strictly less invasive. Both production projects in this space
disclaim DLL injection, memory access, anti-cheat bypass and generated input.

Revisit memory reading or input automation only on an explicit instruction from Mightie, and
only with the risk restated at that time.

**What is genuinely accepted:** in-game text reaches an agent that can run commands, so prompt
injection is the real risk. Mitigated by fencing untrusted text as data (see Trust model) and
by the agent's permission mode / allowlist. Fencing raises the bar; it is not a guarantee.

## Build phases

Each phase is a gate. Nothing proceeds until the prior phase has real evidence.

**Phase 1 — Echo over the file path (no AI).** Addon sends text; bridge echoes it back; addon
displays it. Purpose: prove the round-trip plumbing works on the Forever beta build, settle
whether the beta's SavedVariables restore bug affects a small frequently-written table, and
prove it inside a dungeon or raid where the chat-messaging lockdown may bite. Cheap, and it
de-risks everything downstream.

**Phase 2 — Live carrier.** Replace the reload round-trip with the pixel-strip outbound +
LoadOnDemand slot inbound carrier (see the transport correction doc), so ordinary messages
need no `/reload`. This is the step that makes it usable, and it is deliberately *before* any
model complexity — the carrier is the hard part, not the agent call.

**Phase 3 — Conversation.** Bridge → Hermes, plain conversation, grounded in live character
state (zone, spec, quest log, gear). Establishes how a session is addressed and resumed.

**Phase 4 — Full agent.** Same channel with agent turns unthrottled: long jobs, progress
reporting, turn limits, partial-result handling, and post-wipe transcript restore.

## Error handling

- **Question never flushed** — bridge surfaces nothing; addon keeps the pending question
  visible in the window so it is not silently lost.
- **Hermes unreachable or errors** — bridge writes an explicit error reply into the inbox
  rather than leaving the addon waiting forever. Player sees the failure in-game.
- **No reply yet on Fetch** — addon says so plainly; the pending question stays queued.
- **Malformed or truncated SavedVariables** — WoW's SavedVariables writes are not atomic and
  have a documented history of partial writes. The bridge validates JSON and ignores
  malformed reads instead of crashing, and the addon must never write unbounded data into
  SavedVariables (constant-table overflow is a real failure mode).

## Testing

- **Phase 1 is the test harness.** It is exercised end-to-end by hand in-game, in a city and
  in an instance, and its evidence is captured output, not a claim.
- **Bridge** gets unit tests for payload encode/decode, malformed-input handling, and the
  data-fencing of untrusted text.
- **Addon** is verified by loading it in the live beta client; there is no meaningful
  offline test for WoW Lua UI code.
- **Interface number** for the `.toc` is read from `WTF/Config.wtf` (`lastAddonVersion`)
  after the client has run at least once, rather than guessed.

## Open questions (to resolve during implementation, not by assumption)

1. Which profile's API server Whisperstone targets, and the exact OpenAI-compatible
   endpoint path and auth header shape. Phase 2 confirms against a live server.
2. Whether the beta's SavedVariables restore bug affects a small, frequently-written
   addon table. Phase 1 answers this empirically.
3. How the in-instance chat lockdown behaves for a non-combat addon's own SavedVariables.
   Phase 1 tests in an instance explicitly.
4. Whether a longer agent turn than the reload cadence allows needs a queue with visible
   in-game progress, or whether a single "working…" state is enough.

## Out of scope

- Combat data, rotation assistance, or anything the Forever disarmament restricts.
- Memory reading or input automation (see Explicitly rejected).
- Non-Forever clients. The addon is written mainline-first for Forever; Classic Era is not
  a target.
- Multi-character or multi-account routing.
