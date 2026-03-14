export interface ErrorRecord {
  id: string;
  summary: string;
  detail: string;
  createdAt: string;
}

function getErrorSummary(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || "Unknown error";
  }
  return String(error);
}

function getErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`;
  }
  return String(error);
}

export class ErrorTracker {
  private readonly limit: number;
  private readonly records = new Map<string, ErrorRecord>();
  private sequence = 0;

  constructor(limit = 100) {
    this.limit = limit;
  }

  record(error: unknown, context?: string): ErrorRecord {
    this.sequence += 1;
    const id = `err-${Date.now().toString(36)}-${this.sequence.toString(36)}`;
    const createdAt = new Date().toISOString();
    const summary = getErrorSummary(error);
    const detailLines = [`[${createdAt}] ${summary}`];

    if (context) {
      detailLines.push("");
      detailLines.push(`Context: ${context}`);
    }

    const rawDetail = getErrorDetail(error).trim();
    if (rawDetail) {
      detailLines.push("");
      detailLines.push(rawDetail);
    }

    const record: ErrorRecord = {
      id,
      summary,
      detail: detailLines.join("\n"),
      createdAt,
    };

    this.records.set(id, record);
    this.trim();
    return record;
  }

  get(id: string): ErrorRecord | null {
    return this.records.get(id) ?? null;
  }

  private trim(): void {
    while (this.records.size > this.limit) {
      const oldestKey = this.records.keys().next().value;
      if (!oldestKey) {
        return;
      }
      this.records.delete(oldestKey);
    }
  }
}
