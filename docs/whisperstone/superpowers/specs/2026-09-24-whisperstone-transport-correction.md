# Transport correction — live carriers (prior-art review)

**Date:** 2026-09-24
**Status:** Correction to `2026-09-24-whisperstone-design.md`
**Trigger:** Review of `chelinho139/wow-ai` and `0xInuarashi/wow-forever-codex`

## What was wrong

The design doc stated that a two-`/reload` round-trip per exchange was *inherent to the WoW
addon sandbox*. **It is not.** Two production projects on the exact target client (WoW:
Forever beta) operate with no `/reload` per ordinary message. The claim was mine, based on
incomplete research, and treating a conservative design choice as a hard constraint would
have capped this project at "consultation tool" for no reason.

## The live carriers, as actually implemented

### Outbound — the pixel strip

The addon draws a grid of `SetColorTexture` squares; a host process screen-captures the
region and decodes it. This is the only outbound channel, and both projects use it.

- Colour discipline: **pure 0/255 channels only.** Pure primaries survive any gamma or
  contrast setting; intermediate levels do not. (`wow-ai` tried 4 levels/channel first and
  had misreads under some display settings.)
- `wow-ai`: 200 cells/row × 48 rows, 4×4 px cells, 3 bits/cell → **≈3.2 KB per frame**,
  captured at 4 Hz from the client area's top-left 800×192 px.
- `wow-forever-codex`: 128 × 4 binary cells → **64 bytes per frame**.
- Frame scaled to `768 / physicalScreenHeight` so one UI unit is exactly one screen pixel.
- Packets carry magic, length, sequence and a checksum (Adler-32 / Fletcher-16). Ambiguous
  or bad-checksum frames are **rejected, not guessed**.
- **Exclusive fullscreen blocks capture.** Windowed or borderless only.

### Inbound — LoadOnDemand slots

WoW discovers addon **folders and `.toc` files only at startup** (documented behaviour). But
a `## LoadOnDemand: 1` addon's **Lua file is read when `LoadAddOn(name)` is called** and
re-read on each `/reload` (documented). So: pre-create N slot addons at install time; the
host writes slot content to disk; the addon loads a fresh slot on a schedule after each send.

- `wow-ai` uses **200 slots** (`WoWAI_S001`…`S200`), each loaded once per UI session,
  `/reload` freeing them all. Because the bridge can't know which slot the game will load
  next, **every publish writes the same content to all 200** (atomic rename per file, ~1 MB —
  cheap).
- Slot content is the latest status of *every* chat, so one slot serves all chats.
- Trigger: a readiness signal (below) or a backoff schedule —
  5, 10, 16, 24, 34, 46, 60, 80, 100, 130, 160, 200, 240, 300 s, then every 60 s.

### Inbound, variant — font metrics

`wow-forever-codex` instead encodes bytes into **glyph advance widths** of a pre-created,
unused font file, and reads them back in Lua via `SetFont` + `GetStringWidth` (documented
APIs). 512 glyphs at U+E000, advance `(16 + byte) * 16` font units, calibrated against
reference glyphs for 0 and 255, trailing glyph appended so its contribution cancels. One
512-byte packet per font file, across a **65,535-file bank** (`fontreply0001.ttf`…`65535`)
created at install, hard-linked in groups of 512 → ~2.81 MB of underlying payload.

Notable design details worth stealing:

- The addon **never reads the font file as raw bytes** — the game loads an ordinary font
  resource and Lua reads measurable properties. Generated fonts contain no TrueType bytecode.
- Each slot's packet is **frozen for that attempt**: a newer reply waits for a later slot
  rather than changing a file the game may already be loading. "Writing a file is not proof
  of delivery."
- The receiver re-requests a fragment if a *new revision* arrives mid-assembly, and discards
  the partial assembly (revision = checksum of the complete preview text + state).

### Cheap readiness flags — the empty-wav trick

`PlaySoundFile(path)` returns whether the file will play. An empty wav won't; a valid one
will; a file never loaded before is read fresh. A pre-made empty `.wav` is therefore a
one-shot flag the host raises and the addon polls **for free** — no slot consumed.

`wow-ai` uses this for: reply-ready (`sig/NNN.wav`), message ack (`ack/NNN.wav`), per-action
heartbeats (`act/NNN/kk.wav`), and a presence heartbeat (`presence/kkkk.wav`) that drives an
in-game "bridge alive" status light.

**Caveat each consumer must handle:** a raised file stays valid for the rest of the client
process even after being emptied again, so an unexpected "already valid" is treated as
unreliable and the addon falls back to slot polling. The addon self-tests at login
(empty ⇒ unplayable, valid ⇒ playable) and disables the whole mechanism if that fails.

## The empirical rules all of this rests on

Measured on a live Forever client (`0xInuarashi/wow-forever-codex`), *not* Blizzard-documented.
The source itself hedges: first-use file loading is "an empirical result from the tested
build, not a guaranteed general-purpose file/IPC API."

1. A **file or folder that did not exist at client startup is never discovered.** New *files
   inside an existing addon folder* and new LoadOnDemand *Lua* are read fresh; new addon
   *folders* are not.
2. A loaded non-Lua resource (font, sound) **keeps returning cached content** for the rest of
   the process, even across `/reload`.
3. A filename **not yet used in this process** is read fresh on first use.
4. On a **full client restart**, previously-used filenames can deliver new bytes again —
   verified live 2026-09-21. This is what makes a font bank recyclable *in principle*;
   automatic recycling is not implemented in either project.

Consequence for install: **restart WoW once after installing**, because the pool has to exist
before the client scans. Both projects say so explicitly.

## How this changes Whisperstone

Phase 1 (echo, file-only) is still worth building — it is cheap, and it settles the
SavedVariables-restore question and the in-instance behaviour. But it is now **phase 1 of
four**, not the shape of the product:

1. **Echo over the file path** — prove round-trip plumbing. (unchanged from the current plan)
2. **Live carrier** — pixel strip outbound + LoadOnDemand slot inbound, so ordinary messages
   need no `/reload`. This is the step that makes it usable.
3. **Conversation** — bridge → Hermes, grounded in character state.
4. **Full agent** — long jobs, progress, session resume.

## Security posture: what the prior art does and does not do

Both projects explicitly disclaim: no DLL injection, no game-process memory access, no
anti-cheat bypass, no generated keyboard/mouse input, no executable payloads. `wow-ai` uses
documented addon APIs plus screen capture and ordinary file writes; `wow-forever-codex` is
explicit that documented APIs "does not imply Blizzard endorsement."

**This resolves the grey-zone question from the original spec:** a no-reload transport does
*not* require the two things it explicitly rejected (memory reading, synthetic input).
Pixel-out + documented file-loading is strictly less invasive than either, and is what the
working projects run. The original spec's rejection of memory reading and input automation
stands; what changes is that the reload cost is no longer the price of staying out of the
grey zone.

Both are also explicit about the real remaining risk — prompt injection from in-game text
into an agent that can run commands — and both bound it by construction:

- `wow-llm-personas` fences player text in `<in_game>…</in_game>` and instructs the model to
  treat instruction-shaped content inside as in-character dialogue, and documents that moving
  personas from the **user message to the system message** was an A/B-proven fix for models
  leaking `assistant Name says:` scaffolding.
- `wow-ai` runs agents with an explicit `permissionMode` (default `acceptEdits`: edits inside
  the project are fine, commands need a rule) and an allowlist, plus an in-game **Allow &
  retry** button for a refused tool.

## Reusable prior art — build vs. reuse

| Project | Stars | What it is | Reusable for us? |
|---|---|---|---|
| `chelinho139/wow-ai` | 76 | MIT. Forever-targeted. Pixel strip ↔ LoadOnDemand slots + empty-wav signals. Bridge is Node with **zero dependencies**, unit tests, CI on Windows. Drives Claude Code / Codex / Grok by CLI with sessions, permissions, progress, transcripts and post-wipe chat restore. | **Yes, directly.** Node 22+ is present on this host. Gaps for us: it drives CLIs, not raw APIs; no Hermes target; it is a coding-agent UI rather than a character-aware companion. |
| `0xInuarashi/wow-forever-codex` | — | The measured origin of the file-loading rules and the pixel channel; adds the font-metrics return path. Codex-only. | Reference for the empirical rules and the font-bank design. |
| `Nardo86/azeroth-companion` | 0 | MIT, Python+Lua, WotLK 3.3.5a → retail, generic OpenAI-compatible endpoint. | Concept reference only — it is the reload-per-exchange design we started from. |

## Hermes as a bridge target — verified

`hermes chat` already exposes exactly what a bridge needs:

```
hermes chat --query-file - --format stream-json -Q [--resume SESSION_ID] [--max-turns N]
```

- `--query-file -` reads the prompt from stdin with **no shell interpretation** ("safe for
  arbitrary text: nothing is shell-interpreted, so quotes, `$(...)`, and backticks are
  preserved verbatim") — the correct way to hand over untrusted player text.
- `--format stream-json` gives a parseable stream; `--resume` gives session continuity.

So a Hermes-backed bridge is a peer of the Claude/Codex/Grok entries in `wow-ai`'s agent
table, not a new architecture.
