import type { SessionRecord, SessionStore } from "../session-store.js";

export class ConversationService {
  private readonly store: Pick<SessionStore, "get" | "set" | "delete">;

  constructor(store: Pick<SessionStore, "get" | "set" | "delete">) {
    this.store = store;
  }

  getSession(conversationKey: string): SessionRecord | null {
    return this.store.get(conversationKey);
  }

  async saveThread(conversationKey: string, threadId: string): Promise<SessionRecord> {
    const session = { threadId };
    await this.store.set(conversationKey, session);
    return session;
  }

  async reset(conversationKey: string): Promise<void> {
    await this.store.delete(conversationKey);
  }
}
