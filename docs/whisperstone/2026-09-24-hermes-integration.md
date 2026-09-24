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

### Unverified — must be measured, not assumed

- **Whether `--resume` combined with `--query-file -` behaves as a continuing conversation.**
  A fresh session per message would work but be poor (no continuity, no memory of the last
  thing you said in-game). Task 4 of the plan is exactly this measurement.
- Whether a resumed session's recorded cwd interacts badly with the chat's folder. Mitigated
  by always passing `--no-restore-cwd`; confirm in the same test.
- Hermes's own tool-approval prompts in a headless/pipe context. A prompt with no TTY will
  hang until `timeoutMs`. If it happens, the answer is a permissive setting in the *config*,
  not `--yolo` sprinkled into argv.

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
- `type: 'text'` → `done = { text: ev.text, error: false }` (latest wins). No progress line:
  Hermes's `--format stream-json` does not emit per-tool events, so there is nothing to
  report mid-run. That is a known limitation of this integration, and the honest thing is to
  document it rather than fake progress.
- `type: 'result'` → `session` if present; authoritative for `done`: `text = ev.text`,
  `error = ev.exit_code !== 0`; if `type: 'error'`, `done = { text: <message>, error: true }`.

## Known limitations, stated up front

1. **No live progress.** The Claude/Grok parsers show `$ npm test`, `edit file.lua` and so on
   while a run is in flight. Hermes's stream-json carries no tool events, so an in-game
   "working…" will show elapsed time and nothing else. Adding it would mean a Hermes-side
   change (emit tool events on the stream), not an adapter workaround.
2. **`--resume` semantics unverified** (above).
3. **This machine has no `claude`/`codex`**, so those entries will report not-installed. The
   fork's default agent should be set to `hermes` in `bridge/config.json` for this install,
   or the in-game default chat will get an error reply.
4. **Forever is beta and unstable.** Upstream's own docs note the client sometimes wipes addon
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
