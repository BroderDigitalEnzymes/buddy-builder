import type { SessionEvent } from "../ipc.js";
import { applyEvent } from "../entry-builder.js";
import type { SessionData } from "./store.js";

export type EventSideEffects = {
  flushQueue?: string;
  addPoppedOut?: string;
  removePoppedOut?: string;
};

/**
 * Apply a session event to a SessionData object, mutating it in place.
 * Returns side-effect descriptors — caller is responsible for executing them.
 * No store imports, no emit(), no api().
 */
export function applySessionEvent(data: SessionData, event: SessionEvent): EventSideEffects {
  const effects: EventSideEffects = {};

  // Unified entry building (text, tool lifecycle, result, error, exit)
  applyEvent(data.entries, event);

  // Keep lastActiveAt fresh
  if (event.kind !== "popoutChanged") data.lastActiveAt = Date.now();

  // Store-specific side effects
  switch (event.kind) {
    case "ready":
      data.model = event.model;
      data.tools = event.tools;
      data.mcpServers = event.mcpServers ?? [];
      data.claudeCodeVersion = event.claudeCodeVersion ?? null;
      data.skills = event.skills ?? [];
      data.agents = event.agents ?? [];
      data.slashCommands = event.slashCommands ?? [];
      if (event.cwd && !data.cwd) data.cwd = event.cwd;
      break;
    case "result":
      data.totalCost = event.cost;
      break;
    case "rateLimit":
      data.rateLimit = { resetsAt: event.resetsAt, status: event.status };
      break;
    case "usage":
      data.totalInputTokens += event.inputTokens;
      data.totalOutputTokens += event.outputTokens;
      data.contextTokens = event.inputTokens;
      break;
    case "stateChange":
      data.state = event.to;
      if (event.to === "idle") effects.flushQueue = event.sessionId;
      break;
    case "exit":
      data.state = "dead";
      break;
    case "nameChanged":
      data.name = event.name;
      break;
    case "effortChanged":
      data.effort = event.effort;
      break;
    case "popoutChanged":
      if (event.poppedOut) effects.addPoppedOut = event.sessionId;
      else effects.removePoppedOut = event.sessionId;
      break;
  }

  return effects;
}
