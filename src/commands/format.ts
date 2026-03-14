import type { SandboxMode } from "../config.js";

export function formatNetworkAccess(enabled: boolean): string {
  return enabled ? "on" : "off";
}

export function formatSandboxMode(mode: SandboxMode): string {
  if (mode === "dangerFullAccess") {
    return "full-access";
  }
  if (mode === "readOnly") {
    return "read-only";
  }
  return "workspace-write";
}
