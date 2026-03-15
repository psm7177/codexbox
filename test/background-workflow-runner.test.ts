import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BackgroundWorkflowRunner } from "../src/background/background-workflow-runner.js";
import { ConversationLockManager } from "../src/lifecycle/conversation-lock-manager.js";
import { WorkflowService } from "../src/state/workflow-service.js";
import { WorkflowStore } from "../src/workflow-store.js";

test("background workflow runner executes a queued step and reschedules it", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workflow-runner-"));
  const outputFile = path.join(workspace, "note.txt");
  await fs.writeFile(outputFile, "artifact", "utf8");
  const workflowStore = new WorkflowStore(path.join(workspace, "workflows.json"));
  await workflowStore.load();
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, "artifacts"),
  });
  const workflow = await workflowService.createWorkflow({
    conversationKey: "dm:channel-1",
    workspaceKey: "dm:channel-1",
    conversationKind: "dm",
    channelId: "channel-1",
    guildId: null,
    goal: "keep summarizing incoming papers",
    cwd: workspace,
    model: "gpt-oss:20b",
    modelProvider: "ollama",
    threadId: null,
    threadToolProfile: null,
    threadPolicy: "reuse-conversation-thread",
  });

  const sentMessages: string[] = [];
  const sentPayloads: unknown[] = [];
  const savedThreads: Array<{ conversationKey: string; threadId: string; threadToolProfile?: string | null }> = [];
  const runner = new BackgroundWorkflowRunner({
    discordClient: {
      channels: {
        fetch: async () =>
          ({
            send: async (content: unknown) => {
              sentPayloads.push(content);
              if (typeof content === "string") {
                sentMessages.push(content);
              }
              return undefined;
            },
          }) as { send: (content: unknown) => Promise<undefined> },
      },
    },
    workflowService,
    conversationService: {
      saveThread: async (conversationKey: string, threadId: string, options?: { threadToolProfile?: string | null }) => {
        savedThreads.push({ conversationKey, threadId, threadToolProfile: options?.threadToolProfile ?? null });
        return { threadId, threadToolProfile: options?.threadToolProfile ?? null };
      },
    },
    codexClient: {
      ensureThread: async () => "thread-bg-1",
      startTurn: async () => ({
        status: "completed",
        text:
          `Processed the next batch.\n\n<workflow_plan>\ncurrent_step: Process the next batch\nnext_step: Check for new arrivals\nchecklist:\n- verify newly downloaded items\n- summarize the next paper\n</workflow_plan>\n\n<workflow_state>\nstatus: continue\nnext_delay_seconds: 120\nsummary: Continue with the next batch after checking for new arrivals.\n</workflow_state>\n\n<workflow_outputs>\nsend:\n- ${outputFile}\n</workflow_outputs>`,
        imageArtifacts: [
          {
            source: "imageView",
            value: outputFile.replace(/\.txt$/, ".png"),
          },
        ],
        turn: {
          id: "turn-1",
          status: "completed",
        },
      }),
    },
    conversationLockManager: new ConversationLockManager(),
    intervalMs: 60_000,
  });

  await runner.runDueWorkflowsOnce();

  const updated = workflowService.getWorkflow(workflow.id);
  assert.equal(updated?.status, "waiting");
  assert.equal(updated?.stepCount, 1);
  assert.equal(updated?.threadId, "thread-bg-1");
  assert.equal(updated?.threadToolProfile, "ollama-research-tools-v2");
  assert.match(updated?.handoffSummary ?? "", /Continue with the next batch/);
  assert.equal(updated?.currentStep, "Process the next batch");
  assert.equal(updated?.nextStep, "Check for new arrivals");
  assert.deepEqual(updated?.planChecklist, ["verify newly downloaded items", "summarize the next paper"]);
  assert.equal(savedThreads[0]?.threadId, "thread-bg-1");
  assert.match(sentMessages.join("\n"), /Workflow `wf_/);
  assert.match(sentMessages.join("\n"), /scheduled next step in 120s/);
  assert.ok(sentPayloads.some((payload) => typeof payload === "object" && payload != null && "files" in payload));
  assert.equal(runner.getStats().counters.filesSent, 1);
});

test("background workflow runner injects pending prompts into the next step and clears them after success", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workflow-note-"));
  const workflowStore = new WorkflowStore(path.join(workspace, "workflows.json"));
  await workflowStore.load();
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, "artifacts"),
  });
  const workflow = await workflowService.createWorkflow({
    conversationKey: "dm:channel-note",
    workspaceKey: "dm:channel-note",
    conversationKind: "dm",
    channelId: "channel-note",
    guildId: null,
    goal: "incorporate operator prompts",
    cwd: workspace,
    model: "gpt-oss:20b",
    modelProvider: "ollama",
    threadId: null,
    threadToolProfile: null,
    threadPolicy: "dedicated-workflow-thread",
  });
  await workflowService.appendPendingPrompt(workflow.id, "Prioritize the supplementary methods section.");

  let seenInputText = "";
  const runner = new BackgroundWorkflowRunner({
    discordClient: {
      channels: {
        fetch: async () =>
          ({
            send: async () => undefined,
          }) as { send: (content: unknown) => Promise<undefined> },
      },
    },
    workflowService,
    conversationService: {
      saveThread: async (conversationKey: string, threadId: string, options?: { threadToolProfile?: string | null }) => ({
        threadId,
        threadToolProfile: options?.threadToolProfile ?? null,
      }),
    },
    codexClient: {
      ensureThread: async () => "thread-note-1",
      startTurn: async (input) => {
        seenInputText = input.inputs[0]?.type === "text" ? input.inputs[0].text : "";
        return {
          status: "completed",
          text:
            "Reviewed the supplementary methods.\n\n<workflow_state>\nstatus: continue\nnext_delay_seconds: 60\nsummary: Follow up on the results section.\n</workflow_state>\n\n<workflow_outputs>\nsend:\n</workflow_outputs>",
          imageArtifacts: [],
          turn: {
            id: "turn-note",
            status: "completed",
          },
        };
      },
    },
    conversationLockManager: new ConversationLockManager(),
  });

  await runner.runDueWorkflowsOnce();

  const updated = workflowService.getWorkflow(workflow.id);
  assert.match(seenInputText, /Operator prompts to incorporate this step:/);
  assert.match(seenInputText, /Prioritize the supplementary methods section\./);
  assert.equal(updated?.pendingPrompts, null);
});

test("background workflow runner repairs malformed workflow blocks and keeps dedicated threads isolated", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workflow-repair-"));
  const binaryOutput = path.join(workspace, "unsafe.bin");
  const invalidJson = path.join(workspace, "report.json");
  const unsafeMarkdown = path.join(workspace, "notes.md");
  const invalidCsv = path.join(workspace, "table.csv");
  await fs.writeFile(binaryOutput, "not-allowed", "utf8");
  await fs.writeFile(invalidJson, "{not valid json", "utf8");
  await fs.writeFile(unsafeMarkdown, "[click](javascript:alert(1))", "utf8");
  await fs.writeFile(invalidCsv, "a,b\n1,2,3", "utf8");
  const workflowStore = new WorkflowStore(path.join(workspace, "workflows.json"));
  await workflowStore.load();
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, "artifacts"),
  });
  const workflow = await workflowService.createWorkflow({
    conversationKey: "dm:channel-2",
    workspaceKey: "dm:channel-2",
    conversationKind: "dm",
    channelId: "channel-2",
    guildId: null,
    goal: "keep scanning malformed workflow replies",
    cwd: workspace,
    model: "gpt-oss:20b",
    modelProvider: "ollama",
    threadId: null,
    threadToolProfile: null,
    threadPolicy: "dedicated-workflow-thread",
  });

  const savedThreads: Array<{ conversationKey: string; threadId: string; threadToolProfile?: string | null }> = [];
  const sentMessages: string[] = [];
  const runner = new BackgroundWorkflowRunner({
    discordClient: {
      channels: {
        fetch: async () =>
          ({
            send: async (content: unknown) => {
              if (typeof content === "string") {
                sentMessages.push(content);
              }
              return undefined;
            },
          }) as { send: (content: unknown) => Promise<undefined> },
      },
    },
    workflowService,
    conversationService: {
      saveThread: async (conversationKey: string, threadId: string, options?: { threadToolProfile?: string | null }) => {
        savedThreads.push({ conversationKey, threadId, threadToolProfile: options?.threadToolProfile ?? null });
        return { threadId, threadToolProfile: options?.threadToolProfile ?? null };
      },
    },
    codexClient: {
      ensureThread: async () => "thread-bg-dedicated",
      startTurn: async () => ({
        status: "completed",
        text:
          `Pulled the newest article batch and normalized titles.\n\nNext: Check for another batch after the current one settles.\n- check the delayed arrivals queue\n- summarize the next record\n\n<workflow_state>\nstatus: continue\nnext_delay_seconds: 45\nsummary: Check for another batch after the current one settles.\n\n<workflow_outputs>\nsend:\n- ${binaryOutput}\n- ${invalidJson}\n- ${unsafeMarkdown}\n- ${invalidCsv}\n- http://localhost/internal.pdf`,
        imageArtifacts: [],
        turn: {
          id: "turn-repair",
          status: "completed",
        },
      }),
    },
    conversationLockManager: new ConversationLockManager(),
    intervalMs: 60_000,
  });

  await runner.runDueWorkflowsOnce();

  const updated = workflowService.getWorkflow(workflow.id);
  assert.equal(updated?.status, "waiting");
  assert.equal(updated?.threadId, "thread-bg-dedicated");
  assert.equal(updated?.threadPolicy, "dedicated-workflow-thread");
  assert.equal(updated?.currentStep, "Pulled the newest article batch and normalized titles.");
  assert.equal(updated?.nextStep, "Check for another batch after the current one settles.");
  assert.deepEqual(updated?.planChecklist, ["check the delayed arrivals queue", "summarize the next record"]);
  assert.ok((updated?.planWarnings?.length ?? 0) >= 1);
  assert.deepEqual(savedThreads, []);
  assert.match(sentMessages.join("\n"), /artifact send skipped: extension `\.bin` is not in the workflow auto-upload allowlist/);
  assert.match(sentMessages.join("\n"), /artifact send skipped: JSON workflow artifact could not be parsed/);
  assert.match(sentMessages.join("\n"), /artifact send skipped: Markdown workflow artifact contains javascript: links/);
  assert.match(sentMessages.join("\n"), /artifact send skipped: CSV workflow artifact does not look like a consistent table/);
  assert.match(sentMessages.join("\n"), /artifact send skipped: only https workflow artifact URLs are auto-shared|local or private-network workflow artifact URLs are not auto-shared/);
});

test("background workflow runner validates png, md, pdf, and pptx artifacts more strictly", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workflow-artifacts-"));
  const badPng = path.join(workspace, "fake.png");
  const badPdf = path.join(workspace, "fake.pdf");
  const badPptx = path.join(workspace, "slides.pptx");
  const goodMarkdown = path.join(workspace, "notes.md");
  await fs.writeFile(badPng, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "binary");
  await fs.writeFile(badPdf, "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n", "utf8");
  await fs.writeFile(
    badPptx,
    Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("not-a-real-pptx-without-required-paths", "latin1"),
    ]),
  );
  await fs.writeFile(goodMarkdown, "# Notes\n\n- safe markdown\n", "utf8");

  const workflowStore = new WorkflowStore(path.join(workspace, "workflows.json"));
  await workflowStore.load();
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, "artifacts"),
  });
  const workflow = await workflowService.createWorkflow({
    conversationKey: "dm:channel-3",
    workspaceKey: "dm:channel-3",
    conversationKind: "dm",
    channelId: "channel-3",
    guildId: null,
    goal: "validate rich artifact formats",
    cwd: workspace,
    model: "gpt-oss:20b",
    modelProvider: "ollama",
    threadId: null,
    threadToolProfile: null,
    threadPolicy: "dedicated-workflow-thread",
  });

  const sentMessages: string[] = [];
  const sentPayloads: unknown[] = [];
  const runner = new BackgroundWorkflowRunner({
    discordClient: {
      channels: {
        fetch: async () =>
          ({
            send: async (content: unknown) => {
              sentPayloads.push(content);
              if (typeof content === "string") {
                sentMessages.push(content);
              }
              return undefined;
            },
          }) as { send: (content: unknown) => Promise<undefined> },
      },
    },
    workflowService,
    conversationService: {
      saveThread: async (conversationKey: string, threadId: string, options?: { threadToolProfile?: string | null }) => ({
        threadId,
        threadToolProfile: options?.threadToolProfile ?? null,
      }),
    },
    codexClient: {
      ensureThread: async () => "thread-rich-artifacts",
      startTurn: async () => ({
        status: "completed",
        text:
          `Checked rich artifact validation.\n\n<workflow_state>\nstatus: continue\nnext_delay_seconds: 120\nsummary: Continue after validating attachments.\n</workflow_state>\n\n<workflow_outputs>\nsend:\n- ${badPng}\n- ${badPdf}\n- ${badPptx}\n- ${goodMarkdown}\n</workflow_outputs>`,
        imageArtifacts: [],
        turn: {
          id: "turn-rich-artifacts",
          status: "completed",
        },
      }),
    },
    conversationLockManager: new ConversationLockManager(),
  });

  await runner.runDueWorkflowsOnce();

  assert.match(sentMessages.join("\n"), /PNG workflow artifact is missing an IHDR chunk/);
  assert.match(sentMessages.join("\n"), /PDF workflow artifact is missing an EOF marker/);
  assert.match(sentMessages.join("\n"), /PPTX workflow artifact does not look like a PowerPoint OOXML package/);
  assert.ok(sentPayloads.some((payload) => typeof payload === "object" && payload != null && "files" in payload));
});

test("background workflow runner recovers a persisted waiting workflow after reload", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workflow-recover-"));
  const storePath = path.join(workspace, "workflows.json");
  const workflowStore = new WorkflowStore(storePath);
  await workflowStore.load();
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, "artifacts"),
  });
  const workflow = await workflowService.createWorkflow({
    conversationKey: "dm:channel-1",
    workspaceKey: "dm:channel-1",
    conversationKind: "dm",
    channelId: "channel-1",
    guildId: null,
    goal: "recover waiting workflow on startup",
    cwd: workspace,
    model: "gpt-oss:20b",
    modelProvider: "ollama",
    threadId: "thread-bg-2",
    threadToolProfile: "ollama-research-tools-v2",
    threadPolicy: "reuse-conversation-thread",
  });
  await workflowService.markWaiting(workflow.id, {
    nextRunAt: new Date(Date.now() - 1_000),
    handoffSummary: "Continue after restart",
    plan: {
      currentStep: "Waiting after restart",
      nextStep: "Resume processing",
      checklist: ["resume startup workflow"],
    },
    clearError: true,
  });

  const reloadedStore = new WorkflowStore(storePath);
  await reloadedStore.load();
  const reloadedService = new WorkflowService(reloadedStore, {
    artifactsRoot: path.join(workspace, "artifacts"),
  });
  const runner = new BackgroundWorkflowRunner({
    discordClient: {
      channels: {
        fetch: async () =>
          ({
            send: async () => undefined,
          }) as { send: (content: unknown) => Promise<undefined> },
      },
    },
    workflowService: reloadedService,
    conversationService: {
      saveThread: async (conversationKey: string, threadId: string, options?: { threadToolProfile?: string | null }) => ({
        threadId,
        threadToolProfile: options?.threadToolProfile ?? null,
      }),
    },
    codexClient: {
      ensureThread: async () => "thread-bg-2",
      startTurn: async () => ({
        status: "completed",
        text:
          "Recovered.\n\n<workflow_state>\nstatus: completed\nnext_delay_seconds: 10\nsummary: Recovery finished.\n</workflow_state>\n\n<workflow_outputs>\nsend:\n</workflow_outputs>",
        imageArtifacts: [],
        turn: {
          id: "turn-2",
          status: "completed",
        },
      }),
    },
    conversationLockManager: new ConversationLockManager(),
  });

  await runner.runDueWorkflowsOnce();

  const updated = reloadedService.getWorkflow(workflow.id);
  assert.equal(updated?.status, "completed");
});
