# Artifact Follow-ups

## Purpose

This note tracks artifact-related improvements that can be implemented later without blocking the rest of the background workflow system.

The current code already validates extension, size, URL safety, file signatures, and lightweight content shape for several text and binary formats.

This document focuses on:

- what additional artifact features are worth adding
- why they matter
- which code paths should be updated

## Current Touch Points

Artifact handling is currently centered in:

- `src/background/background-workflow-runner.ts`
- `test/background-workflow-runner.test.ts`

The runner currently decides:

- whether a declared workflow output should be auto-uploaded
- whether a local path is safe enough to send
- whether a remote URL is safe enough to share
- whether to send a file attachment, image attachment, or a skip message

Supporting state and operator visibility live in:

- `src/state/workflow-service.ts`
- `src/commands/work.ts`
- `src/commands/status.ts`
- `src/startup/admin-startup-log.ts`
- `src/startup/ready-handler.ts`
- `BACKGROUND_WORKFLOWS.md`

## Future Work List

### 1. MIME-aware classification

Idea:

- Inspect MIME types for local files when available.
- Compare MIME, extension, and signature before auto-upload.
- Flag suspicious mismatches like `.pdf` with HTML content.

Why:

- Current checks are good but still mostly extension/signature driven.
- MIME-aware checks would reduce false positives for renamed or templated files.

Where to modify:

- `src/background/background-workflow-runner.ts`
  - file classification helpers
  - auto-upload gate before `AttachmentBuilder`
- `test/background-workflow-runner.test.ts`
  - add renamed/mismatched content fixtures

### 2. Safer Office document validation

Idea:

- Inspect OOXML zip entries more deeply for `docx`, `xlsx`, `pptx`.
- Reject files with suspicious embedded scripts, macros, or unexpected active content markers when possible.

Why:

- `pptx` now checks basic OOXML structure, but the same idea can be expanded to a richer Office policy.

Where to modify:

- `src/background/background-workflow-runner.ts`
  - OOXML package inspection helpers
  - allowlist decisions for Office files
- `test/background-workflow-runner.test.ts`
  - add valid and malformed OOXML cases

### 3. Image integrity and metadata policy

Idea:

- Parse dimensions for PNG/JPEG/WebP.
- Reject zero-dimension or obviously broken image payloads.
- Optionally strip or report sensitive metadata before upload.

Why:

- Signature checks catch corruption, but not obviously malformed or privacy-sensitive images.

Where to modify:

- `src/background/background-workflow-runner.ts`
  - image signature and metadata helpers
  - image upload path
- `test/background-workflow-runner.test.ts`
  - malformed image dimension cases

### 4. Markdown link policy

Idea:

- Distinguish trusted documentation markdown from generated markdown with risky outbound links.
- Optionally rewrite or summarize raw links before sharing.

Why:

- Current markdown checks reject `<script>` and `javascript:` but do not classify link trust levels.

Where to modify:

- `src/background/background-workflow-runner.ts`
  - markdown content validation helper
  - remote URL extraction policy
- `test/background-workflow-runner.test.ts`
  - add suspicious markdown link cases

### 5. PDF sanity checks beyond header/footer

Idea:

- Inspect basic PDF object structure.
- Detect obviously truncated files with too few objects or broken cross-reference hints.
- Optionally warn when the file looks like a landing page saved as PDF.

Why:

- `%PDF-` and `%%EOF` are useful minimum checks, but richer validation would catch more broken exports.

Where to modify:

- `src/background/background-workflow-runner.ts`
  - PDF validation helper
- `test/background-workflow-runner.test.ts`
  - truncated or fake PDF cases

### 6. Artifact provenance summary

Idea:

- Record why an artifact was accepted, skipped, or rejected.
- Persist that summary into workflow artifacts for later inspection.

Why:

- Right now the channel may see a skip message, but postmortem/debug visibility could be better.

Where to modify:

- `src/background/background-workflow-runner.ts`
  - collect per-artifact decision records
- `src/state/workflow-service.ts`
  - add artifact decision artifact path and write support
- `src/commands/work.ts`
  - expose the artifact decision file in `show`

### 7. Policy configuration by environment

Idea:

- Move artifact size limits and allowed types into config.
- Add env-driven allowlist/denylist for specific deployments.

Why:

- Different bots or servers may want different upload policies.

Where to modify:

- `src/config.ts`
- `src/index.ts`
- `src/background/background-workflow-runner.ts`
- `test/config.test.ts`
- `test/background-workflow-runner.test.ts`

### 8. Per-workflow upload policy

Idea:

- Allow workflows to declare `no-upload`, `text-only`, or `images-only`.

Why:

- Some background work should summarize artifacts without ever auto-posting them.

Where to modify:

- `src/workflow-store.ts`
- `src/state/workflow-service.ts`
- `src/commands/work.ts`
- `src/background/background-workflow-runner.ts`

### 9. Output bundling

Idea:

- If many files are produced, bundle them into a zip or summary package instead of sending several attachments.

Why:

- This would reduce Discord noise and avoid partial delivery when many outputs are produced.

Where to modify:

- `src/background/background-workflow-runner.ts`
- `test/background-workflow-runner.test.ts`

### 10. Human review mode

Idea:

- Add a review queue where artifacts are announced but not uploaded until an operator approves.

Why:

- Useful for risky outputs, external links, or large research workflows.

Where to modify:

- `src/workflow-store.ts`
- `src/state/workflow-service.ts`
- `src/commands/work.ts`
- `src/background/background-workflow-runner.ts`
- `src/commands/status.ts`

## Suggested Order

Recommended implementation order:

1. MIME-aware classification
2. Artifact provenance summary
3. Policy configuration by environment
4. PDF and image integrity improvements
5. Office document validation
6. Per-workflow upload policy
7. Human review mode
