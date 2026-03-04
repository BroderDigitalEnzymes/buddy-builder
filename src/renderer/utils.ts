import type { ClientApi, ChatEntry } from "../ipc.js";

/** Typed accessor for the preload-bridged Claude API. */
export const api = (): ClientApi => (window as any).claude;

/** Map an entry kind to its logical sender. */
export type Sender = "user" | "claude" | "system";

export function getSender(kind: ChatEntry["kind"]): Sender {
  switch (kind) {
    case "user": return "user";
    case "text":
    case "tool": return "claude";
    case "system":
    case "compact":
    case "result": return "system";
  }
}

/** Extract the filename from a path (normalizes backslashes). */
export function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}
