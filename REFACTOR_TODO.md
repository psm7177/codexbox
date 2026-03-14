# Refactor Strategy

This file is the source of truth for the ongoing refactor.
Work should proceed by checking this TODO list, updating statuses, and keeping scope explicit.

## Goals

- Reduce the amount of application logic concentrated in `src/index.ts`
- Separate transport/protocol handling from Discord application behavior
- Make conversation/session/workspace state easier to reason about
- Improve testability around message handling and turn orchestration
- Keep behavior stable while refactoring in small, reviewable steps

## Current Findings

### Main Structural Issues

1. `src/index.ts` owns too many responsibilities:
   - Discord bootstrap
   - admin startup DM logging
   - message routing
   - command dispatch
   - conversation serialization
   - Codex turn orchestration
   - progress rendering
   - local image delivery
   - final response delivery

2. `src/codex-app-server-client.ts` mixes:
   - child process lifecycle
   - JSON-RPC transport
   - approval policy behavior
   - app-server protocol mapping
   - turn state tracking

3. Session/workspace state is exposed at a low level:
   - `src/session-store.ts` persists raw maps directly
   - callers compose state rules themselves
   - command handling and chat handling both know too much about storage layout

4. Discord presentation logic is spread across utilities instead of a clear presentation layer:
   - progress formatting
   - image extraction and validation
   - chunking
   - channel sending/editing

5. `scripts/setup-linux.sh` is carrying multiple operational concerns in one file:
   - env bootstrapping
   - dependency installation
   - service registration
   - user/system scope handling
   - linger handling

## Refactor Principles

- Do not change product behavior unless explicitly intended
- Prefer extract-and-move over rewrite
- Keep each step small enough to test independently
- Land seams first, then move logic behind those seams
- Expand tests around orchestration before major structural changes

## Phased Plan

### Phase 1: Slim the entrypoint

Target:
- Move orchestration logic out of `src/index.ts`

Planned modules:
- `src/startup/admin-startup-log.ts`
- `src/discord/message-sender.ts`
- `src/chat/turn-runner.ts`
- `src/chat/message-router.ts`

Expected result:
- `src/index.ts` becomes mostly wiring and event registration

### Phase 2: Split Codex transport from protocol

Target:
- Separate process/JSON-RPC transport from app-server semantics

Planned modules:
- `src/codex/jsonrpc-transport.ts`
- `src/codex/app-server-client.ts`
- optional approval responder helper

Expected result:
- transport can be tested independently
- protocol behavior becomes easier to evolve

### Phase 3: Introduce state/domain services

Target:
- stop exposing raw persistence shape throughout the app

Planned modules:
- `src/state/conversation-service.ts`
- `src/state/workspace-service.ts`

Expected result:
- commands and chat flow consume domain methods instead of storage primitives

### Phase 4: Modularize commands

Target:
- break `src/commands.ts` into per-command modules

Expected result:
- easier to extend and test command behaviors

### Phase 5: Refactor installer/service scripts

Target:
- split shell logic into reusable pieces

Expected result:
- lower operational risk
- clearer systemd behavior

## Test Strategy

Existing tests cover utilities and storage only.
The biggest missing coverage is orchestration.

Add integration-style tests around:

- command path handling
- normal Codex turn flow
- placeholder/progress updates
- image marker delivery flow
- startup admin logging
- restart authorization

## TODO

- [x] Document the refactor strategy in markdown and store it in the repository
- [x] Create a lightweight progress/update discipline using this file as the refactor checklist
- [x] Extract startup admin logging from `src/index.ts`
- [x] Extract Discord send/edit/image delivery helpers from `src/index.ts`
- [x] Extract turn execution/progress rendering into a dedicated runner
- [x] Extract message routing into a dedicated router
- [x] Reduce `src/index.ts` to bootstrap and wiring only
- [x] Split `src/codex-app-server-client.ts` into transport and protocol layers
- [x] Introduce domain services for conversation/workspace state
- [x] Break `src/commands.ts` into command modules
- [x] Add orchestration-focused tests
- [x] Split `scripts/setup-linux.sh` into smaller operational units

## Update Rule

When working on refactoring:

1. Check this file first
2. Pick one unchecked item
3. Update the checkbox/status as work progresses
4. Keep changes scoped to the selected item unless a prerequisite is required
5. Record any newly discovered follow-up work by adding a new TODO item
