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

- Added admin-only `!codex workspace` to change the next startup `CODEX_WORKSPACE` safely.
- Added access hardening with Discord allowlists, admin-only sensitive commands, and tighter app-server env filtering.
- Added traceable Discord error references with `!codex error <error-id>`.
- Added session binding helpers with stored session listing and manual thread binding commands.
- Added reply mode controls for dedicated bot channels and threads.
- Expanded `!codex status` to show workspace, cwd, reply mode, model, provider, and thread runtime status.
