import type { ChatEntry, SessionEvent } from "./ipc.js";

// ─── Helpers (previously duplicated in manager.ts + store.ts) ────

export function summarizeInput(toolInput: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(toolInput)) {
    if (typeof v === "string") {
      const short = v.replace(/\\/g, "/").split("/").slice(-2).join("/");
      parts.push(`${k}=${short}`);
    }
  }
  return parts.join(" ") || "";
}

export function truncateResult(response: unknown): string | undefined {
  if (response == null) return undefined;
  const raw = typeof response === "string" ? response : JSON.stringify(response, null, 2);
  return raw.length > 4000 ? raw.slice(0, 4000) + "\n…(truncated)" : raw;
}

/** Recursively find a tool entry by toolUseId (searches children too). */
export function findToolEntry(
  entries: ChatEntry[],
  toolUseId: string,
): (ChatEntry & { kind: "tool" }) | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "tool") {
      if (e.toolUseId === toolUseId) return e;
      if (e.children) {
        const found = findToolEntry(e.children, toolUseId);
        if (found) return found;
      }
    }
  }
  return undefined;
}

/**
 * Returns the entries array that a new event should be appended to.
 * If parentToolUseId is set, finds the parent tool and returns its children[].
 * Otherwise returns the top-level entries.
 */
function resolveTargetEntries(
  entries: ChatEntry[],
  parentToolUseId?: string,
): ChatEntry[] {
  if (!parentToolUseId) return entries;
  const parent = findToolEntry(entries, parentToolUseId);
  if (!parent) return entries; // fallback to top-level if parent not found
  if (!parent.children) parent.children = [];
  return parent.children;
}

// ─── Unified entry builder ────────────────────────────────────────

/**
 * Applies a SessionEvent to an entries array (mutates in place).
 * Handles text accumulation, tool lifecycle, result, error, exit.
 * Sub-agent events are routed via parentToolUseId → parent's children[].
 *
 * Returns true if entries were modified.
 */
export function applyEvent(entries: ChatEntry[], event: SessionEvent): boolean {
  const now = Date.now();

  switch (event.kind) {
    case "ready":
      return false;

    case "textDelta": {
      const target = resolveTargetEntries(entries, event.parentToolUseId);
      const last = target[target.length - 1];
      if (last?.kind === "text" && last.streaming) {
        last.text += event.text;
      } else {
        target.push({ kind: "text", text: event.text, streaming: true, ts: now });
      }
      return true;
    }

    case "text": {
      const target = resolveTargetEntries(entries, event.parentToolUseId);
      const last = target[target.length - 1];
      if (last?.kind === "text" && last.streaming) {
        last.text = event.text;   // replace with final complete text
        delete last.streaming;     // finalize
      } else if (last?.kind === "text") {
        last.text += event.text;
      } else {
        target.push({ kind: "text", text: event.text, ts: now });
      }
      return true;
    }

    case "toolStart": {
      const target = resolveTargetEntries(entries, event.parentToolUseId);
      target.push({
        kind: "tool",
        toolName: event.toolName,
        toolUseId: event.toolUseId,
        status: "running",
        detail: summarizeInput(event.toolInput),
        toolInput: event.toolInput,
        ts: now,
      });
      return true;
    }

    case "toolEnd": {
      const entry = findToolEntry(entries, event.toolUseId);
      if (entry) {
        entry.status = "done";
        entry.toolResult = truncateResult(event.response);
      }
      return true;
    }

    case "toolPermission": {
      // Update the existing running tool entry to "permission" status
      const entry = findToolEntry(entries, event.toolUseId);
      if (entry) {
        entry.status = "permission";
      }
      return true;
    }

    case "toolBlocked": {
      // Check if there's an existing tool entry (from toolStart → toolPermission → denied)
      if (event.toolUseId) {
        const existing = findToolEntry(entries, event.toolUseId);
        if (existing) {
          existing.status = "blocked";
          existing.detail = event.reason;
          return true;
        }
      }
      const target = resolveTargetEntries(entries, event.parentToolUseId);
      target.push({
        kind: "tool",
        toolName: event.toolName,
        toolUseId: "",
        status: "blocked",
        detail: event.reason,
        toolInput: {},
        ts: now,
      });
      return true;
    }

    case "result":
      entries.push({
        kind: "result",
        cost: event.cost,
        turns: event.turns,
        durationMs: event.durationMs,
        ts: now,
      });
      return true;

    case "error":
      entries.push({ kind: "system", text: `Error: ${event.message}`, ts: now });
      return true;

    case "exit":
      entries.push({ kind: "system", text: "Session ended.", ts: now });
      return true;

    case "stop":
      // Only show a message when a stop hook is actively processing; normal turn ends are silent.
      if (event.stopHookActive) {
        entries.push({ kind: "system", text: "Claude stopped (hooks processing\u2026)", ts: now });
        return true;
      }
      return false;

    case "systemMessage":
      entries.push({ kind: "system", text: event.text, ts: now });
      return true;

    case "notification":
      entries.push({ kind: "system", text: event.title ? `${event.title}: ${event.body}` : event.body, ts: now });
      return true;

    case "compact":
      entries.push({
        kind: "compact",
        trigger: event.trigger,
        preTokens: event.preTokens,
        ts: now,
      });
      return true;

    case "rateLimit":
    case "usage":
    case "stateChange":
    case "warn":
    case "nameChanged":
    case "effortChanged":
    case "popoutChanged":
      return false;
  }
}
