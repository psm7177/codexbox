export interface ActiveTurnState {
  conversationKey: string;
  threadId: string;
  turnId?: string;
  stopRequested: boolean;
}

export interface StopRequestResult {
  found: boolean;
  alreadyRequested: boolean;
  state?: ActiveTurnState;
}

export class ActiveTurnRegistry {
  private readonly activeTurns = new Map<string, ActiveTurnState>();

  begin(conversationKey: string, threadId: string): void {
    this.activeTurns.set(conversationKey, {
      conversationKey,
      threadId,
      stopRequested: false,
    });
  }

  attachTurnId(conversationKey: string, turnId: string): ActiveTurnState | undefined {
    const state = this.activeTurns.get(conversationKey);
    if (!state) {
      return undefined;
    }

    state.turnId = turnId;
    return state;
  }

  get(conversationKey: string): ActiveTurnState | undefined {
    return this.activeTurns.get(conversationKey);
  }

  requestStop(conversationKey: string): StopRequestResult {
    const state = this.activeTurns.get(conversationKey);
    if (!state) {
      return { found: false, alreadyRequested: false };
    }

    const alreadyRequested = state.stopRequested;
    state.stopRequested = true;
    return {
      found: true,
      alreadyRequested,
      state: { ...state },
    };
  }

  clear(conversationKey: string): void {
    this.activeTurns.delete(conversationKey);
  }
}
