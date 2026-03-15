# Background Workflows

## Purpose

This feature adds a durable workflow layer for work that should continue across multiple Codex turns instead of relying on a single long-running reply.

The design goal is to keep progress alive even when:

- a single turn finishes before the whole task is done
- the model context changes or compacts
- the bot needs to pause and resume later
- the same Discord conversation must not run foreground chat and background work at the same time

## Current Contents

### Durable workflow state

- `src/workflow-store.ts`
- `src/state/workflow-service.ts`

Background jobs are stored separately from normal conversation session data.

Each workflow records:

- workflow id
- conversation and workspace keys
- Discord routing context
- goal
- cwd / model / provider
- bound thread id and tool profile
- per-workflow thread policy
- status
- timestamps
- step count
- failure count
- handoff summary
- last assistant message
- last error

Workflow state is also mirrored into dedicated artifact files under `.data/workflows/<workflow-id>/`, including:

- `status.md`
- `handoff.md`
- `plan.md`
- `plan-warnings.md`
- `pending-prompts.md`
- `last-assistant-message.md`
- `events.jsonl`

This gives the system durable workflow memory outside the live model context.

### Background runner

- `src/background/background-workflow-runner.ts`

The runner:

- finds due workflows
- serializes execution per conversation
- resumes or creates a Codex thread
- uses a dedicated workflow thread by default, with per-workflow override support
- runs one workflow step at a time
- parses machine-readable `<workflow_plan>`, `<workflow_state>`, and `<workflow_outputs>` blocks
- repairs partially malformed workflow state/plan blocks when possible, including loose next-step/checklist recovery from plain text
- stores current-step / next-step / checklist planning state
- stores planner repair warnings so recovered workflow plans are inspectable later
- stores the next handoff summary
- schedules the next run
- retries transient failures with backoff
- sends declared workflow output files back to Discord when available
- auto-uploads only allowlisted workflow artifact types within a size limit, and reports skipped outputs
- validates workflow artifact URLs, checks allowlisted URL extensions, and inspects local content signatures plus JSON / Markdown / CSV / TSV / YAML / HTML / XML shape before auto-upload

### Shared conversation locking

- `src/lifecycle/conversation-lock-manager.ts`

Foreground chat and background workflow execution now share the same per-conversation lock model so they do not overlap inside one Discord conversation.

### Discord commands

- `!codex work`
- `!codex work [--reuse-thread|--dedicated-thread] <goal>`
- `!codex work show <workflow-id>`
- `!codex work note <workflow-id> <prompt>`
- `!codex work pause <workflow-id>`
- `!codex work resume <workflow-id>`
- `!codex work retry <workflow-id> [delay-seconds] [keep-thread|reuse-thread|dedicated-thread]` (admin)
- `!codex work cancel <workflow-id>`
- `!codex work all` (admin)
- `!codex work dashboard` (admin)

These commands allow users to:

- queue a background workflow
- inspect workflows for the current conversation
- inspect a workflow in detail, including artifact paths and recent events
- inject an operator prompt for the next workflow step while work is already queued or running
- pause and resume queued workflows
- cancel a workflow
- list all workflows as an admin
- reject duplicate active goals inside the same conversation
- retry failed workflows with overridden scheduling/thread parameters

### Status visibility

- `!codex status` now shows background workflow count
- `!codex status` shows workflow runner stats and thread policy
- admin/startup surfaces now include recent 1h / 24h / 7d workflow activity summaries
- admin dashboard surfaces now include overdue / stalled / paused / failed / high-failure / recent-active workflow snapshots, top providers, and workspace / conversation hotspots
- `!codex tools` continues to show injected dynamic tools

## Artifact Follow-ups

Future artifact ideas and file-level modification points are tracked in:

- `dev-log/artifact-followups.md`

### Runtime configuration

Workflow polling and retry behavior can now be configured with env vars:

- `WORKFLOW_STORE_PATH`
- `WORKFLOW_ARTIFACTS_PATH`
- `CODEX_WORKFLOW_POLL_INTERVAL_MS`
- `CODEX_WORKFLOW_RETRY_BASE_DELAY_MS`
- `CODEX_WORKFLOW_RETRY_MAX_DELAY_MS`
- `CODEX_WORKFLOW_MAX_FAILURES`
- `CODEX_WORKFLOW_REUSE_CONVERSATION_THREAD`

## TODO

- Improve the planner further beyond the current block repair so the runner can validate and recover richer multi-step workflow plans.
- Add richer artifact classification beyond the current extension, size, URL safety, signature checks, and lightweight text/JSON/Markdown/CSV/TSV/YAML/HTML/XML validation.
- Add richer admin/startup dashboards beyond the current activity windows and overdue/stalled/paused/failed snapshots.
