# codexbox

Discord bot that maps Discord conversations to Codex app-server threads.

Documentation is split by audience, setup depth, and language.

- [Release Notes](RELEASES.md)

## English

- [User Manual](docs/en/user-manual.md)
- Installation
  - [Quick Setup](docs/en/installation-quick.md)
  - [Advanced Setup](docs/en/installation-advanced.md)
- [Developer Guide](docs/en/developer-guide.md)

## 한국어

- [사용자 매뉴얼](docs/ko/user-manual.md)
- 설치 가이드
  - [Quick Setup](docs/ko/installation-quick.md)
  - [Advanced Setup](docs/ko/installation-advanced.md)
- [개발자 가이드](docs/ko/developer-guide.md)

## Command Overview

The bot command prefix is `!codex`.

### Core

- `!codex help`: Show the command summary
- `!codex status`: Show workspace, session, tool, and workflow status
- `!codex tools`: Show the injected tool set for the selected provider
- `!codex stop`: Interrupt the active turn in this conversation
- `!codex reset`: Reset the current conversation binding
- `!codex restart`: Restart the bot process

### Models

- `!codex models`: List available models for the current provider
- `!codex model`: Show the selected model
- `!codex model <name|reset>`: Set or clear the model override
- `!codex providers`: List available providers
- `!codex provider`: Show the selected provider
- `!codex provider <name> [model]`: Set the provider and optionally the model
- `!codex provider reset`: Clear the provider override

### Background Work

- `!codex work`: List workflows for this conversation
- `!codex work [--reuse-thread|--dedicated-thread] <goal>`: Queue a background workflow
- `!codex work show <workflow-id>`: Show workflow details and artifact paths
- `!codex work note <workflow-id> <prompt>`: Queue an operator note for the next workflow step
- `!codex work pause <workflow-id>`: Pause a workflow
- `!codex work resume <workflow-id>`: Resume a paused or failed workflow
- `!codex work cancel <workflow-id>`: Cancel a workflow
- `!codex work stop <workflow-id>`: Stop a workflow without queueing a new goal
- `!codex work all`: List all workflows (admin)
- `!codex work dashboard`: Show activity and hotspot summaries (admin)
- `!codex work retry <workflow-id> [delay-seconds] [keep-thread|reuse-thread|dedicated-thread]`: Retry a failed workflow (admin)

### Workspace

- `!codex cwd`: Show the current workspace-relative cwd
- `!codex cwd <path>`: Set the cwd
- `!codex cwd reset`: Reset cwd to the workspace root
- `!codex access`: Show the sandbox mode
- `!codex access workspace-write|read-only|full-access|reset`: Set the sandbox mode
- `!codex network`: Show network access mode
- `!codex network on|off|reset`: Set network access mode
- `!codex mode`: Show reply mode
- `!codex mode <mention|auto|reset>`: Set reply mode (admin)
- `!codex workspace`: Show the bound workspace (admin)
- `!codex workspace <path|reset>`: Set or reset the workspace binding (admin)
- `!codex init <cwd> <mention|auto>`: Initialize workspace cwd and reply mode (admin)

### Admin

- `!codex sessions`: List bound conversations and threads (admin)
- `!codex bind <thread-id>`: Rebind the conversation to an existing thread (admin)
- `!codex error <error-id>`: Show a stored error report (admin)
