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

/** Format a token count as a human-readable string (e.g. 1.2k, 3.4M). */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Extract the filename from a path (normalizes backslashes). */
export function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

// ─── CLI command builder ─────────────────────────────────────────

export type CliCommandOptions = {
  claudeSessionId?: string | null;
  cwd?: string | null;
  permissionMode?: string;
  model?: string | null;
  systemPrompt?: string | null;
  maxTurns?: number | null;
};

/** Build the equivalent `claude` CLI command for a session. */
export function buildCliCommand(opts: CliCommandOptions): string {
  const parts = ["claude"];

  if (opts.claudeSessionId) {
    parts.push("--resume", opts.claudeSessionId);
  }

  if (opts.permissionMode === "bypassPermissions") {
    parts.push("--dangerously-skip-permissions");
  }
  // Other modes map to claude's built-in permission system (default behavior)

  if (opts.model) parts.push("--model", opts.model);
  if (opts.maxTurns) parts.push("--max-turns", String(opts.maxTurns));
  if (opts.systemPrompt) {
    parts.push("--system-prompt", JSON.stringify(opts.systemPrompt));
  }

  let cmd = parts.join(" ");
  if (opts.cwd) {
    cmd = `cd ${opts.cwd} && ${cmd}`;
  }

  return cmd;
}
