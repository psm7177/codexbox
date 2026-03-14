import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import type { Config } from "./config.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface RequestMessage {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface NotificationMessage {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface ResultResponseMessage {
  jsonrpc: "2.0";
  id: number;
  result: unknown;
}

interface ErrorResponseMessage {
  jsonrpc: "2.0";
  id: number;
  error: {
    code: number;
    message: string;
  };
}

interface PendingTurn {
  threadId: string;
  text: string;
  deferred: Deferred<TurnResult>;
  onDelta?: (fullText: string, delta: string) => Promise<void> | void;
  onPlan?: (planEvent: PlanEvent) => Promise<void> | void;
  onToolEvent?: (eventName: string, item: ToolItem) => void;
}

export interface ToolItem {
  type?: string;
  command?: string;
  changes?: Array<{ path: string }>;
}

export interface PlanEvent {
  turnId: string;
  plan?: Array<{ status: string; step: string }>;
}

export interface TurnResult {
  status: string;
  text: string;
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

export class CodexAppServerClient extends EventEmitter {
  private readonly config: Config;
  private child: ChildProcessWithoutNullStreams | null;
  private reader: readline.Interface | null;
  private nextId: number;
  private pendingRequests: Map<number, Deferred<unknown>>;
  private readyPromise: Promise<void> | null;
  private activeTurns: Map<string, PendingTurn>;

  constructor(config: Config) {
    super();
    this.config = config;
    this.child = null;
    this.reader = null;
    this.nextId = 1;
    this.pendingRequests = new Map();
    this.readyPromise = null;
    this.activeTurns = new Map();
  }

  async ensureStarted(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    const deferred = createDeferred<void>();
    this.readyPromise = deferred.promise;

    const child = spawn(this.config.appServerCommand.bin, this.config.appServerCommand.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) {
        this.emit("log", message);
      }
    });

    child.on("exit", (code, signal) => {
      const error = new Error(`Codex app-server exited (code=${code}, signal=${signal})`);
      for (const pending of this.pendingRequests.values()) {
        pending.reject(error);
      }
      this.pendingRequests.clear();
      this.readyPromise = null;
      this.child = null;
      this.reader = null;
      this.emit("exit", error);
    });

    this.reader = readline.createInterface({ input: child.stdout });
    this.reader.on("line", (line) => {
      this.handleLine(line);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", () => resolve());
        child.once("error", reject);
      });

      const initId = this.nextId++;
      const initDeferred = createDeferred<unknown>();
      this.pendingRequests.set(initId, initDeferred);
      this.write({
        jsonrpc: "2.0",
        id: initId,
        method: "initialize",
        params: { clientInfo: this.config.clientInfo },
      });
      await initDeferred.promise;
      this.notify("initialized", {});
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
    const id = this.nextId++;
    const deferred = createDeferred<unknown>();
    this.pendingRequests.set(id, deferred);
    this.write({ jsonrpc: "2.0", id, method, params });
    return deferred.promise;
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: RequestMessage | NotificationMessage | ResultResponseMessage | ErrorResponseMessage): void {
    if (!this.child?.stdin.writable) {
      throw new Error("Codex app-server stdin is not writable");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    const message = JSON.parse(line) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { message?: string };
    };

    if (message.id != null && Object.prototype.hasOwnProperty.call(message, "result")) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id != null && Object.prototype.hasOwnProperty.call(message, "error")) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        pending.reject(new Error(message.error?.message ?? "Unknown Codex app-server error"));
      }
      return;
    }

    if (message.id != null && message.method) {
      void this.handleServerRequest(message);
      return;
    }

    if (message.method) {
      this.handleNotification(message.method, message.params ?? {});
    }
  }

  private async handleServerRequest(message: {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
  }): Promise<void> {
    const { id, method, params } = message;

    if (id == null || !method) {
      return;
    }

    if (method === "item/commandExecution/requestApproval") {
      this.write({ jsonrpc: "2.0", id, result: { decision: "decline" } });
      return;
    }

    if (method === "item/fileChange/requestApproval") {
      this.write({ jsonrpc: "2.0", id, result: { decision: "decline" } });
      return;
    }

    if (method === "item/permissions/requestApproval") {
      this.write({ jsonrpc: "2.0", id, result: { permissions: {}, scope: "turn" } });
      return;
    }

    if (method === "item/tool/requestUserInput") {
      const questions = (params?.questions as Array<{ id: string }> | undefined) ?? [];
      const answers = Object.fromEntries(questions.map((question) => [question.id, { answers: [] }]));
      this.write({ jsonrpc: "2.0", id, result: { answers } });
      return;
    }

    this.write({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unsupported server request: ${method}` },
    });
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
      turn?.onToolEvent?.(method, (params.item ?? {}) as ToolItem);
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
