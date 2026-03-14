export interface RestartRequestResult {
  alreadyPending: boolean;
  activeTurns: number;
}

export class RestartCoordinator {
  private pending = false;
  private activeTurns = 0;
  private exitScheduled = false;
  private readonly exitCode: number;
  private readonly exitProcess: (code: number) => void;

  constructor(options?: { exitCode?: number; exitProcess?: (code: number) => void }) {
    this.exitCode = options?.exitCode ?? 75;
    this.exitProcess = options?.exitProcess ?? ((code) => process.exit(code));
  }

  isRestartPending(): boolean {
    return this.pending;
  }

  requestRestart(): RestartRequestResult {
    if (this.pending) {
      return {
        alreadyPending: true,
        activeTurns: this.activeTurns,
      };
    }

    this.pending = true;
    return {
      alreadyPending: false,
      activeTurns: this.activeTurns,
    };
  }

  beginTurn(): boolean {
    if (this.pending) {
      return false;
    }

    this.activeTurns += 1;
    return true;
  }

  endTurn(): void {
    if (this.activeTurns > 0) {
      this.activeTurns -= 1;
    }

    this.maybeExit();
  }

  maybeExit(): void {
    if (!this.pending || this.activeTurns > 0 || this.exitScheduled) {
      return;
    }

    this.exitScheduled = true;
    setTimeout(() => {
      this.exitProcess(this.exitCode);
    }, 0);
  }
}
