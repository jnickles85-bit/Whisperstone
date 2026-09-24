# Whisperstone — Hermes agent integration design

**Date:** 2026-09-24
**Status:** Approved in direction (fork wow-ai; add a `hermes` agent entry). Pending a live end-to-end run.
**Repo:** `/home/jnick/Whisperstone` — a fork of `chelinho139/wow-ai` (MIT), `upstream` remote preserved.

## Goal

Talk to **Ara** (the `ara` Hermes profile) from inside World of Warcraft: Forever, using the
wow-ai addon and bridge as-is, by adding Hermes as a fourth agent alongside Claude Code,
Codex and Grok.

Nothing about the transport is ours. The addon, the pixel strip, the LoadOnDemand slot pool,
the empty-wav signals, the transcripts and the post-wipe restore are all upstream work. Our
contribution is the adapter plus the config, docs and tests that make it a first-class entry.

That is deliberately a small, honest scope: the carrier is the hard part, it already exists,
and re-implementing it would be waste. See
`docs/whisperstone/superpowers/specs/2026-09-24-whisperstone-transport-correction.md` for why
the reload-per-message design was abandoned.

## Verified facts this design rests on

- Hermes CLI is at `/home/jnick/.local/bin/hermes`; `hermes chat --help` confirms
  `--query-file`, `--format stream-json`, `-Q`, `--resume SESSION_ID`, `--in DIR`,
  `--no-restore-cwd`, `--max-turns N`, `--source SOURCE`.
- `--query-file -` reads the prompt from stdin: *"nothing is shell-interpreted, so quotes,
  `$(...)`, and backticks are preserved verbatim"* — the correct way to hand over arbitrary
  player text.
- `--source` accepts `tool` for *"third-party integrations that should not appear in user
  session lists."*
- **The real stream shape was captured live**, not assumed. `hermes chat -q … --format
  stream-json -Q` emitted exactly three event types:

```json
{"type":"system","subtype":"init","model":"deepseek-v4.1-flash","session_id":"20260924_153640_4dbe00","timestamp":1790278600489}
{"type":"text","text":"PONG","timestamp":1790278611363}
{"type":"result","session_id":"20260924_153640_4dbe00","exit_code":0,"text":"PONG","tokens":{...},"duration_ms":10957,"timestamp":1790278611447}
```

- `hermes` is installed here; `claude` and `codex` are **not**. So on this machine the fork's
  other three agents will report as not-installed, and `hermes` is the one that works.

### Measured 2026-09-24 — was "Unverified, must be measured, not assumed"

- **`--resume` combined with `--query-file -` IS a continuing conversation.**
  Measured: fresh run (session `20260924_154831_d38c82`) told to remember BANANA; resumed run
  with the same id and `--query-file -` answered "**BANANA** — you asked me to remember it just
  a moment ago … two messages back in this same conversation". Context carries. The design
  (pass `--resume <id>` on later turns) is valid.
- **Tool events DO appear on the stream** (`tool_use`/`tool_result`) whenever the agent calls
  tools — see the resume capture above. The old PONG capture happened to have none because the
  model answered without tools. Parsers must still *tolerate* them (unknown-event ignoring);
  they can't be assumed absent.
- A resumed session's cwd: run with `--no-restore-cwd --in <chat-folder>` and it stayed in the
  chat folder (both turns used the same `--in` value). The recorded-cwd interaction noted
  below did not bite, but the always-pass `--no-restore-cwd` stays as insurance.
- Headless tool-approval: the measured runs (one tool call each) never hung on an approval
  prompt, and `timeoutMs` bounds the risk. If it happens, the answer is a permissive setting
  in the *config*, not `--yolo` sprinkled into argv.

## The adapter contract

An entry in `AGENTS` in `bridge/agents.js`. The interface, read from the file itself:

```js
hermes: {
  name: 'Ara',
  command: 'hermes',
  install: '…',
  windowsPaths: () => [...],
  posixPaths: () => [path.join(os.homedir(), '.local', 'bin', 'hermes')],
  args({ cfg, resume, cwd, system, promptFile }) { … },   // argv, minus the binary
  input: ({ prompt, system, systemShort, resume }) => …,  // how the text is handed over
  env: (env) => env,
  parser: hermesParser,
}
```

### `args`

```
['chat', '--query-file', '-', '--format', 'stream-json', '-Q',
 '--source', 'tool',                       // keep game sessions out of user session lists
 '--no-restore-cwd', '--in', cwd,          // the chat's folder is authoritative
 '--max-turns', String(cfg.maxTurns || 20)]
```
then `cfg.model ? ['-m', cfg.model] : []`, then `resume ? ['--resume', resume] : []`, then
`cfg.extraArgs`.

**Not** `--yolo`. Approval behaviour is a config concern. If headless runs hang on approvals,
that is a finding to report, not something to paper over with a bypass flag.

### `input`

Codex is the precedent for an agent with no system-prompt flag: it prepends
`contextBlock(system)` to the prompt. Hermes has no `--append-system-prompt` either, so:

```js
input: ({ prompt, system, systemShort, resume }) => ({
  stdin: ((resume ? systemShort : system) ? contextBlock(resume ? systemShort : system) : '') + prompt,
})
```

`system` is `protocol.systemPrompt(ctx, primer)` — the player's character/zone context plus
the addon primer. Set `primerFile` in the config to a Whisperstone doc so the agent knows what
this addon is and how `[Name]` links and the "Linked from the game" block read.

### `parser`

Maps the three observed event types onto what `bridge.js` expects
(`{ progress: [], session, denied: [], notes: [], done: { text, error } }`):

- `type: 'system'`, `subtype: 'init'` → `session = ev.session_id`. **This is how resume
  continuity is established.**
- `type: 'text'` → reply text. These arrive as **chunks** that build the reply ("**" + "BAN"
  + "ANA" + …), so the parser *accumulates* them rather than latest-wins. (Measured 2026-09-24.)
- `type: 'tool_use'` → one readable progress line per call, via `describeToolUse`
  (Hermes's names were added there in 2026-09-24): `terminal` → `$ echo WHISPERSTONE_TOOLTEST`,
  `read_file` → `read foo.lua`, `write_file`/`patch` → `write`/`edit <file>`, `search_files`,
  `web_search`, `web_extract`; an unknown name degrades to its bare name (e.g. `fact_store`).
  `type: 'tool_result'` is deliberately **not** a progress line — one line per call, not per
  result.
- `type: 'result'` → `session` if present; authoritative for `done`: `text = ev.text`,
  `error = ev.exit_code !== 0`; if `type: 'error'`, `done = { text: <message>, error: true }`.

## Known limitations, stated up front

1. **No live progress *yet* → implemented 2026-09-24 (card t_92247e8b).** Original claim here
   — "carries no tool events" — was wrong, inferred from a single PONG probe that happened
   to call no tools. A live forcing run produced:
   ```json
   {"type":"tool_use","name":"terminal","input":{"command":"echo WHISPERSTONE_TOOLTEST"}}
   {"type":"tool_result","name":"terminal","output":"{\"output\": \"WHISPERSTONE_TOOLTEST\", ...}","duration_ms":122,"is_error":false}
   ```
   The fix was **adapter-side, not Hermes-side**: `hermesParser` now emits one readable
   progress line per `tool_use` via `describeToolUse`, whose table gained Hermes's names
   (`terminal`, `read_file`, `write_file`, `patch`, `search_files`, `web_search`,
   `web_extract`) alongside Claude's; unknown names degrade to the bare tool name.
   `tool_result` stays silent so each call is one line, not two. Previously "a small
   name-map is needed … tracked as a follow-up card" — that follow-up is this.
2. **This machine has no `claude`/`codex`**, so those entries will report not-installed. The
   fork's default agent should be set to `hermes` in `bridge/config.json` for this install,
   or the in-game default chat will get an error reply.
3. **Forever is beta and unstable.** Upstream's own docs note the client sometimes wipes addon
   saved data; recovery depends on the bridge having been running.

## Phasing

- **Phase A (this work):** `hermes` entry + config + docs + unit test. Prove the command line
  and parser against the *captured* stream, then prove a live end-to-end run with the game.
- **Phase B:** gear/stats awareness. The addon already sends a ~700-byte game context
  (character, zone, talents, professions) into the agent's system prompt. Extending it toward
  equipped gear and stats is additive.
- **Phase C (separate project):** StatForge-level gear analysis in-game. **Requires a
  `StatForge` port to Forever/Mainline** — it currently targets Classic Era (interface 11508)
  and calls `GetNumTalentTabs` / `GetTalentInfo`, both removed on Forever in favour of
  `C_Traits`. Not part of this fork.

## Licence and attribution

Upstream is MIT. Keep `LICENSE` and the upstream credit intact, keep the `upstream` remote,
and offer the `hermes` adapter back as a PR. Our docs live under `docs/whisperstone/` so the
boundary between their work and ours stays legible.
