import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

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

export interface JsonRpcServerRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcTransportOptions {
  command: {
    bin: string;
    args: string[];
  };
  cwd: string;
  env: NodeJS.ProcessEnv;
  onLog?: (line: string) => void;
  onExit?: (error: Error) => void;
  onNotification?: (method: string, params: Record<string, unknown>) => void;
  onRequest?: (request: JsonRpcServerRequest) => Promise<unknown> | unknown;
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

export class JsonRpcRequestError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export class JsonRpcChildProcessTransport {
  private readonly options: JsonRpcTransportOptions;
  private child: ChildProcessWithoutNullStreams | null;
  private reader: readline.Interface | null;
  private nextId: number;
  private pendingRequests: Map<number, Deferred<unknown>>;
  private readyPromise: Promise<void> | null;

  constructor(options: JsonRpcTransportOptions) {
    this.options = options;
    this.child = null;
    this.reader = null;
    this.nextId = 1;
    this.pendingRequests = new Map();
    this.readyPromise = null;
  }

  async start(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    const deferred = createDeferred<void>();
    this.readyPromise = deferred.promise;

    const child = spawn(this.options.command.bin, this.options.command.args, {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) {
        this.options.onLog?.(message);
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
      this.options.onExit?.(error);
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
      deferred.resolve();
    } catch (error) {
      deferred.reject(error);
      this.readyPromise = null;
      throw error;
    }

    return this.readyPromise;
  }

  async request(method: string, params: unknown): Promise<unknown> {
    await this.start();
    const id = this.nextId++;
    const deferred = createDeferred<unknown>();
    this.pendingRequests.set(id, deferred);
    this.write({ jsonrpc: "2.0", id, method, params });
    return deferred.promise;
  }

  async notify(method: string, params: unknown): Promise<void> {
    await this.start();
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
      void this.handleServerRequest({
        id: message.id,
        method: message.method,
        params: message.params,
      });
      return;
    }

    if (message.method) {
      this.options.onNotification?.(message.method, message.params ?? {});
    }
  }

  private async handleServerRequest(request: JsonRpcServerRequest): Promise<void> {
    try {
      const result =
        (await this.options.onRequest?.(request)) ??
        (() => {
          throw new JsonRpcRequestError(-32601, `Unsupported server request: ${request.method}`);
        })();
      this.write({ jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      const rpcError =
        error instanceof JsonRpcRequestError ? error : new JsonRpcRequestError(-32603, getErrorMessage(error));
      this.write({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: rpcError.code, message: rpcError.message },
      });
    }
  }
}
