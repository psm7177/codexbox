import type { SessionRecord, SessionStore } from "../session-store.js";

export class ConversationService {
  private readonly store: Pick<SessionStore, "get" | "set" | "delete" | "entries">;

  constructor(store: Pick<SessionStore, "get" | "set" | "delete" | "entries">) {
    this.store = store;
  }

  getSession(conversationKey: string): SessionRecord | null {
    return this.store.get(conversationKey);
  }

  async saveThread(
    conversationKey: string,
    threadId: string,
    options?: Omit<SessionRecord, "threadId">,
  ): Promise<SessionRecord> {
    const session = { threadId, ...options };
    await this.store.set(conversationKey, session);
    return session;
  }

  listSessions(): Array<{ conversationKey: string; threadId: string }> {
    return this.store.entries().map(([conversationKey, session]) => ({
      conversationKey,
      threadId: session.threadId,
    }));
  }

  async reset(conversationKey: string): Promise<void> {
    await this.store.delete(conversationKey);
  }
}
