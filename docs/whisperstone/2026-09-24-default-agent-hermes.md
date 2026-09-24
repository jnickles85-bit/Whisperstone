# Whisperstone-local default: `hermes`, not `claude`

**Date:** 2026-09-24
**Card:** t_0e87fc4b
**Status:** implemented this commit.

## Decision

A fresh Whisperstone install defaults to **`hermes`** (Ara). Mightie's decision on
2026-09-24 — *"we don't need Claude."* Measured on this machine: `hermes` (and `grok`)
are installed; `claude` and `codex` are **not**. The upstream fork shipped `claude` as
the default agent, so a fresh install's default chat would have answered with an
*"agent not found"* error out of the box.

## What changed

- `bridge/config.example.json`: `"agent": "claude"` → `"hermes"` (the value every fresh
  install copies into `config.json`; `setup.js` and `upgradeConfig` inherit it).
- `bridge/agents.js`: `DEFAULT_AGENT = 'claude'` → `'hermes'` (the code fallback when
  `config.json` has no `agent`).
- `docs/AGENTS.md`, `docs/CONFIGURATION.md`, `README.md`, `docs/INSTALL-WINDOWS.md`,
  `docs/ARCHITECTURE.md`: the documented default flipped to `hermes`, each marked
  Whisperstone-local with a pointer here.
- `addon/WoWAI/WoWAI.lua`: two stale "claude, codex or grok" lists that predate the
  hermes adapter gained `hermes` (the `AgentList()` fallback and the `/wow-ai agent`
  help line). Not default-claims — stale-list fixes, auditable in the diff.
- Optional small improvement: a non-fatal warning, pasted below, when the configured
  default agent is not installed — in `setup.js` output and in the bridge startup
  banner. `setup.js` already listed missing agents without failing; this tells you the
  one that *matters* (the default) before the first in-game message does.

## Why this is ours, not the upstream PR

Whisperstone's plan is to offer the `hermes` **adapter** (arg building, parser, config,
tests) back to `chelinho139/wow-ai` as an additive PR — useful to them. Changing
*their* default agent away from Claude is not. So:

- Keep the upstream PR adapter-only.
- Rebase onto upstream with `-X theirs` on the two default sites (`config.example.json`,
  `agents.js`), or keep the flip as a last commit we can drop on rebase.
- Each default site carries a one-line `Whisperstone-local` comment; this note is the
  canonical record.

## Model — deliberately out of scope

Operator note 2026-09-24: *"the model you use can be handled from the gateway side of
the machine. Should not be hard coded into the addon."* Measured and left alone:

- The addon has zero model references — nothing model-related crosses into the client.
- `agents.hermes.model` ships as `""`, so the adapter passes no `-m` flag and Hermes
  resolves the model from its own profile config (`d4: qwen3.8:27b-unc`,
  `ara: deepseek-v4.1-flash`, `elon: glm-5.3-flash` — per-profile, host-side).
- Bonus property preserved: the bridge spawns a fresh agent per message, so a
  gateway-side model swap lands on the *next* in-game message with nothing to restart.

## Verification (paste-able; see card t_0e87fc4b handoff for full output)

- `npm test`: 49 tests, 47 pass, 2 fail — the same 2 pre-existing
  Windows-path-semantics failures as the untouched baseline. No new failures; no test
  asserted `DEFAULT_AGENT` or the config default, so nothing to update deliberately.
- Fresh install: `node setup.js`, then the bridge `--inject` run with **no `--agent`
  flag** resolves the default and `hermes` answers.
- `grep -rn` for remaining "default…claude" claims: clean, modulo upstream-history and
  per-agent references that do not claim a default.
