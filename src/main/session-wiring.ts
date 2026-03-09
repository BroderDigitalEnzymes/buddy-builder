import type { Session } from "../index.js";
import type { SessionEvent, ChatEntry } from "../ipc.js";
import { applyEvent } from "../entry-builder.js";

// ─── Types ──────────────────────────────────────────────────────

/** Subset of ManagedSession fields that wireSession reads/writes. */
export type WirableManagedSession = {
  readonly id: string;
  name: string;
  claudeSessionId: string | null;
  cwd: string | null;
  entries: ChatEntry[] | null;
  lastActiveAt: number;
  model: string | null;
  claudeCodeVersion: string | null;
  tools: string[];
  mcpServers: { name: string; status: string }[];
  skills: string[];
  agents: string[];
  slashCommands: string[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  userNamed: boolean;
  session: Session | null;
};

type EventSink = (event: SessionEvent) => void;

// ─── Wire session events ────────────────────────────────────────

export function wireSession(managed: WirableManagedSession, session: Session, sink: EventSink): void {
  const id = managed.id;

  // Ensure entries array exists for live sessions
  if (!managed.entries) managed.entries = [];

  // Helper: build a SessionEvent from a session-layer event, apply to entries, and forward to renderer.
  function forward(event: SessionEvent): void {
    applyEvent(managed.entries!, event);
    managed.lastActiveAt = Date.now();
    sink(event);
  }

  session.on("ready", (init) => {
    managed.claudeSessionId = init.session_id;
    managed.cwd = managed.cwd ?? init.cwd;
    managed.model = init.model;
    managed.claudeCodeVersion = init.claude_code_version ?? null;
    managed.tools = init.tools;
    managed.mcpServers = (init.mcp_servers as { name: string; status: string }[] | undefined) ?? [];
    managed.skills = init.skills ?? [];
    managed.agents = init.agents ?? [];
    managed.slashCommands = init.slash_commands ?? [];
    forward({
      kind: "ready", sessionId: id, model: init.model, tools: init.tools,
      mcpServers: init.mcp_servers as { name: string; status: string }[] | undefined,
      claudeCodeVersion: init.claude_code_version,
      cwd: init.cwd,
      skills: init.skills,
      agents: init.agents,
      slashCommands: init.slash_commands,
    });
  });

  session.on("textDelta", (ev) => {
    forward({ kind: "textDelta", sessionId: id, text: ev.text, parentToolUseId: ev.parentToolUseId });
  });

  session.on("text", (ev) => {
    forward({ kind: "text", sessionId: id, text: ev.text, parentToolUseId: ev.parentToolUseId });
  });

  session.on("toolStart", (ev) => {
    forward({ kind: "toolStart", sessionId: id, toolName: ev.toolName, toolInput: ev.toolInput, toolUseId: ev.toolUseId, parentToolUseId: ev.parentToolUseId });
  });

  session.on("toolEnd", (ev) => {
    forward({ kind: "toolEnd", sessionId: id, toolName: ev.toolName, toolUseId: ev.toolUseId, response: ev.response });
  });

  session.on("toolBlocked", (ev) => {
    forward({ kind: "toolBlocked", sessionId: id, toolName: ev.toolName, toolUseId: ev.toolUseId, reason: ev.reason, parentToolUseId: ev.parentToolUseId });
  });

  session.on("toolPermission", (ev) => {
    forward({ kind: "toolPermission", sessionId: id, toolName: ev.toolName, toolInput: ev.toolInput, toolUseId: ev.toolUseId, parentToolUseId: ev.parentToolUseId });
  });

  session.on("result", (r) => {
    managed.totalCost = r.total_cost_usd;
    forward({ kind: "result", sessionId: id, text: r.result ?? "", cost: r.total_cost_usd, turns: r.num_turns, durationMs: r.duration_ms, durationApiMs: r.duration_api_ms, isError: r.is_error });
  });

  session.on("rateLimit", (ev) => {
    forward({ kind: "rateLimit", sessionId: id, resetsAt: ev.rate_limit_info.resetsAt, status: ev.rate_limit_info.status });
  });

  session.on("message", (msg) => {
    if (msg.message.usage) {
      managed.totalInputTokens += msg.message.usage.input_tokens;
      managed.totalOutputTokens += msg.message.usage.output_tokens;
      sink({ kind: "usage", sessionId: id, inputTokens: msg.message.usage.input_tokens, outputTokens: msg.message.usage.output_tokens });
    }
  });

  session.on("stop", (ev) => {
    forward({ kind: "stop", sessionId: id, stopHookActive: ev.stopHookActive });
  });

  session.on("systemMessage", (text) => {
    forward({ kind: "systemMessage", sessionId: id, text });
  });

  session.on("notification", (ev) => {
    forward({ kind: "notification", sessionId: id, title: ev.title, body: ev.body });
  });

  session.on("compact", (ev: { trigger: string; preTokens: number | null }) => {
    forward({ kind: "compact", sessionId: id, trigger: ev.trigger, preTokens: ev.preTokens });
  });

  session.on("stateChange", (ev) => {
    console.log(`[stateChange] ${id.slice(0, 8)} ${ev.from} → ${ev.to}`);
    sink({ kind: "stateChange", sessionId: id, from: ev.from, to: ev.to });
  });

  session.on("warn", (msg) => {
    sink({ kind: "warn", sessionId: id, message: msg });
  });

  session.on("error", (err) => {
    forward({ kind: "error", sessionId: id, message: err.message });
  });

  session.on("exit", (ev) => {
    managed.session = null;
    forward({ kind: "exit", sessionId: id, code: ev.code });
  });
}
