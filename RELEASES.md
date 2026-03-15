# Release Notes

This file is the manual release log for `codexbox`.

## Release Workflow

When creating a new git tag:

1. Add a new section for the tag in this file.
2. Summarize user-facing features, behavioral changes, and breaking changes.
3. Keep entries short and manual-friendly.
4. Move relevant notes from `Unreleased` into the tagged section.

Recommended format:

```md
## v0.2.0

- Added ...
- Changed ...
- Fixed ...
```

## Unreleased

- Added workspace-scoped model/provider controls with `!codex model`, `!codex models`, `!codex provider`, and `!codex providers`, including local Ollama model discovery.
- Added safer provider switching by clearing stale model overrides, resetting threads on provider changes, and showing selected-vs-thread model/provider state in `!codex status`.
- Added an Ollama-local `web_search` dynamic tool path with PubMed routing for biological queries and Unpaywall-based open-access PDF downloads by DOI.
- Added an Ollama cloud rate-limit hint for `429 Too Many Requests` errors when a `*-cloud` model is selected.
- Added admin-only `!codex workspace` to change the next startup `CODEX_WORKSPACE` safely.
- Added access hardening with Discord allowlists, admin-only sensitive commands, and tighter app-server env filtering.
- Added traceable Discord error references with `!codex error <error-id>`.
- Added session binding helpers with stored session listing and manual thread binding commands.
- Added reply mode controls for dedicated bot channels and threads.
- Expanded `!codex status` to show workspace, cwd, reply mode, model, provider, and thread runtime status.
