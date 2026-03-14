import { EventEmitter } from "node:events";
import {
  JsonRpcChildProcessTransport,
  JsonRpcRequestError,
  type JsonRpcServerRequest,
} from "./codex/jsonrpc-transport.js";
import type { Config } from "./config.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface PendingTurn {
  threadId: string;
  text: string;
  deferred: Deferred<TurnResult>;
  imageArtifacts: ImageArtifact[];
  onDelta?: (fullText: string, delta: string) => Promise<void> | void;
  onPlan?: (planEvent: PlanEvent) => Promise<void> | void;
  onToolEvent?: (eventName: string, item: ToolItem) => void;
}

export interface ToolItem {
  id?: string;
  type?: string;
  command?: string;
  changes?: Array<{ path: string }>;
  path?: string;
  result?: string;
  status?: string;
  revisedPrompt?: string | null;
}

export interface ImageArtifact {
  id?: string;
  source: "imageView" | "imageGeneration";
  value: string;
}

export interface PlanEvent {
  turnId: string;
  plan?: Array<{ status: string; step: string }>;
}

export interface TurnResult {
  status: string;
  text: string;
  imageArtifacts: ImageArtifact[];
  turn: {
    id: string;
    status: string;
    error?: { message?: string };
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function collectImageArtifact(item: ToolItem, artifacts: ImageArtifact[]): void {
  if (item.type === "imageView" && typeof item.path === "string" && item.path.trim()) {
    artifacts.push({
      id: item.id,
      source: "imageView",
      value: item.path.trim(),
    });
    return;
  }

  if (item.type === "imageGeneration" && typeof item.result === "string" && item.result.trim()) {
    artifacts.push({
      id: item.id,
      source: "imageGeneration",
      value: item.result.trim(),
    });
  }
}

export class CodexAppServerClient extends EventEmitter {
  private readonly config: Config;
  private readonly transport: JsonRpcChildProcessTransport;
  private readyPromise: Promise<void> | null;
  private activeTurns: Map<string, PendingTurn>;

  constructor(config: Config) {
    super();
    this.config = config;
    this.transport = new JsonRpcChildProcessTransport({
      command: this.config.appServerCommand,
      cwd: process.cwd(),
      env: process.env,
      onLog: (line) => this.emit("log", line),
      onExit: (error) => {
        this.readyPromise = null;
        this.emit("exit", error);
      },
      onNotification: (method, params) => {
        this.handleNotification(method, params);
      },
      onRequest: async (request) => this.handleServerRequest(request),
    });
    this.readyPromise = null;
    this.activeTurns = new Map();
  }

  async ensureStarted(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    const deferred = createDeferred<void>();
    this.readyPromise = deferred.promise;

    try {
      await this.transport.start();
      await this.transport.request("initialize", { clientInfo: this.config.clientInfo });
      await this.transport.notify("initialized", {});
      deferred.resolve();
    } catch (error) {
      deferred.reject(error);
      this.readyPromise = null;
      throw error;
    }

    return this.readyPromise;
  }

  async ensureThread(metadata?: { threadId?: string; name?: string; cwd?: string }): Promise<string> {
    await this.ensureStarted();
    const cwd = metadata?.cwd ?? this.config.threadDefaults.cwd;
    if (metadata?.threadId) {
      try {
        await this.request("thread/resume", {
          threadId: metadata.threadId,
          cwd,
          approvalPolicy: this.config.threadDefaults.approvalPolicy,
          personality: this.config.threadDefaults.personality,
        });
        return metadata.threadId;
      } catch (error) {
        this.emit("log", `thread/resume failed for ${metadata.threadId}: ${getErrorMessage(error)}`);
      }
    }

    const response = (await this.request("thread/start", {
      cwd,
      model: this.config.threadDefaults.model,
      modelProvider: this.config.threadDefaults.modelProvider,
      approvalPolicy: this.config.threadDefaults.approvalPolicy,
      personality: this.config.threadDefaults.personality,
      serviceName: this.config.threadDefaults.serviceName,
    })) as { thread: { id: string } };

    const threadId = response.thread.id;
    if (metadata?.name) {
      await this.request("thread/name/set", {
        threadId,
        name: metadata.name,
      });
    }
    return threadId;
  }

  async startTurn({
    threadId,
    text,
    cwd,
    sandboxPolicy,
    onDelta,
    onPlan,
    onToolEvent,
  }: {
    threadId: string;
    text: string;
    cwd?: string;
    sandboxPolicy?: Config["turnDefaults"]["sandboxPolicy"];
    onDelta?: PendingTurn["onDelta"];
    onPlan?: PendingTurn["onPlan"];
    onToolEvent?: PendingTurn["onToolEvent"];
  }): Promise<TurnResult> {
    await this.ensureStarted();
    const resolvedCwd = cwd ?? this.config.turnDefaults.cwd;
    const resolvedSandboxPolicy = sandboxPolicy ?? this.config.turnDefaults.sandboxPolicy;

    const response = (await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text }],
      cwd: resolvedCwd,
      model: this.config.turnDefaults.model,
      approvalPolicy: this.config.turnDefaults.approvalPolicy,
      personality: this.config.turnDefaults.personality,
      summary: this.config.turnDefaults.summary,
      sandboxPolicy: resolvedSandboxPolicy,
    })) as { turn: { id: string } };

    const turnId = response.turn.id;
    const deferred = createDeferred<TurnResult>();
    this.activeTurns.set(turnId, {
      threadId,
      imageArtifacts: [],
      onDelta,
      onPlan,
      onToolEvent,
      deferred,
      text: "",
    });
    return deferred.promise;
  }

  async request(method: string, params: unknown): Promise<unknown> {
    await this.ensureStarted();
    return this.transport.request(method, params);
  }

  notify(method: string, params: unknown): void {
    void this.transport.notify(method, params);
  }

  private async handleServerRequest({ method, params }: JsonRpcServerRequest): Promise<unknown> {
    if (method === "item/commandExecution/requestApproval") {
      return { decision: "decline" };
    }

    if (method === "item/fileChange/requestApproval") {
      return { decision: "decline" };
    }

    if (method === "item/permissions/requestApproval") {
      return { permissions: {}, scope: "turn" };
    }

    if (method === "item/tool/requestUserInput") {
      const questions = (params?.questions as Array<{ id: string }> | undefined) ?? [];
      const answers = Object.fromEntries(questions.map((question) => [question.id, { answers: [] }]));
      return { answers };
    }

    throw new JsonRpcRequestError(-32601, `Unsupported server request: ${method}`);
  }

  private handleNotification(method: string, params: Record<string, unknown>): void {
    if (method === "item/agentMessage/delta") {
      const turn = this.activeTurns.get(String(params.turnId));
      if (turn) {
        const delta = typeof params.delta === "string" ? params.delta : "";
        turn.text += delta;
        void turn.onDelta?.(turn.text, delta);
      }
      return;
    }

    if (method === "turn/plan/updated") {
      const turn = this.activeTurns.get(String(params.turnId));
      void turn?.onPlan?.(params as unknown as PlanEvent);
      return;
    }

    if (method === "item/started" || method === "item/completed") {
      const turn = this.activeTurns.get(String(params.turnId));
      const item = (params.item ?? {}) as ToolItem;
      if (turn && method === "item/completed") {
        collectImageArtifact(item, turn.imageArtifacts);
      }
      turn?.onToolEvent?.(method, item);
      return;
    }

    if (method === "turn/completed") {
      const completedTurn = params.turn as TurnResult["turn"] | undefined;
      if (!completedTurn) {
        return;
      }

      const turn = this.activeTurns.get(completedTurn.id);
      if (!turn) {
        return;
      }

      this.activeTurns.delete(completedTurn.id);
      if (completedTurn.status === "failed") {
        turn.deferred.reject(new Error(completedTurn.error?.message ?? "Codex turn failed"));
        return;
      }

      turn.deferred.resolve({
        status: completedTurn.status,
        text: turn.text.trim(),
        imageArtifacts: turn.imageArtifacts,
        turn: completedTurn,
      });
      return;
    }

    if (method === "error") {
      const error = params.error as { message?: string } | undefined;
      this.emit("log", `Codex app-server error: ${error?.message ?? "unknown error"}`);
    }
  }
}
