export class ConversationLockManager {
  private readonly conversationLocks = new Map<string, Promise<unknown>>();

  async serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.conversationLocks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    void current
      .finally(() => {
        if (this.conversationLocks.get(key) === current) {
          this.conversationLocks.delete(key);
        }
      })
      .catch(() => {});
    this.conversationLocks.set(key, current);
    return current;
  }
}
