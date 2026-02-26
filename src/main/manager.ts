import { randomUUID } from "crypto";
import { createSession, type Session, type SessionConfig } from "../index.js";
import {
  DEFAULT_POLICY,
  PRESET_BLOCKED_TOOLS,
  type SessionEvent,
  type SessionInfo,
  type ToolPolicyConfig,
  type CreateSessionOptions,
} from "../ipc.js";

// ─── Types ──────────────────────────────────────────────────────

type ManagedSession = {
  readonly id: string;
  name: string;
  session: Session;
  policy: ToolPolicyConfig;
};

type EventSink = (event: SessionEvent) => void;

// ─── Build a ToolPolicy function from a config ──────────────────

function buildToolPolicy(config: ToolPolicyConfig) {
  const blocked = config.preset === "unrestricted" && config.blockedTools.length === 0
    ? []
    : [...(PRESET_BLOCKED_TOOLS[config.preset] ?? []), ...config.blockedTools];

  const blockedSet = new Set(blocked);

  return (toolName: string, _input: Record<string, unknown>) => {
    if (blockedSet.has(toolName)) {
      return { action: "block" as const, reason: `Blocked by policy (${config.preset})` };
    }
    return { action: "allow" as const };
  };
}

// ─── Wire a session's events to the sink ────────────────────────

function wireSession(id: string, session: Session, sink: EventSink): void {
  session.on("ready", (init) =>
    sink({ kind: "ready", sessionId: id, model: init.model, tools: init.tools }));

  session.on("text", (text) =>
    sink({ kind: "text", sessionId: id, text }));

  session.on("toolStart", (ev) =>
    sink({ kind: "toolStart", sessionId: id, toolName: ev.toolName, toolInput: ev.toolInput, toolUseId: ev.toolUseId }));

  session.on("toolEnd", (ev) =>
    sink({ kind: "toolEnd", sessionId: id, toolName: ev.toolName, toolUseId: ev.toolUseId }));

  session.on("toolBlocked", (ev) =>
    sink({ kind: "toolBlocked", sessionId: id, toolName: ev.toolName, reason: ev.reason }));

  session.on("result", (r) =>
    sink({ kind: "result", sessionId: id, text: r.result, cost: r.total_cost_usd, turns: r.num_turns, durationMs: r.duration_ms }));

  session.on("stateChange", (ev) =>
    sink({ kind: "stateChange", sessionId: id, from: ev.from, to: ev.to }));

  session.on("warn", (msg) =>
    sink({ kind: "warn", sessionId: id, message: msg }));

  session.on("error", (err) =>
    sink({ kind: "error", sessionId: id, message: err.message }));

  session.on("exit", (ev) =>
    sink({ kind: "exit", sessionId: id, code: ev.code }));
}

// ─── Session Manager ────────────────────────────────────────────

export type SessionManager = {
  create(options?: CreateSessionOptions): Promise<string>;
  send(id: string, text: string): void;
  kill(id: string): void;
  list(): SessionInfo[];
  updatePolicy(id: string, policy: ToolPolicyConfig): void;
  getPolicy(id: string): ToolPolicyConfig;
  dispose(): Promise<void>;
};

export function createSessionManager(sink: EventSink): SessionManager {
  const sessions = new Map<string, ManagedSession>();
  let counter = 0;

  function getSession(id: string): ManagedSession {
    const s = sessions.get(id);
    if (!s) throw new Error(`No session: ${id}`);
    return s;
  }

  return {
    async create(options?: CreateSessionOptions): Promise<string> {
      const id = randomUUID();
      counter++;

      const config: SessionConfig = {
        claudePath: String.raw`C:\Users\eran\.local\bin\claude.exe`,
        permissionMode: options?.permissionMode ?? "default",
      };

      const session = await createSession(config);
      const policy = { ...DEFAULT_POLICY };
      const managed: ManagedSession = { id, name: `Session ${counter}`, session, policy };
      sessions.set(id, managed);

      session.setToolPolicy(buildToolPolicy(policy));
      wireSession(id, session, sink);
      return id;
    },

    send(id: string, text: string): void {
      getSession(id).session.send(text);
    },

    kill(id: string): void {
      const managed = sessions.get(id);
      if (!managed) return;
      managed.session.kill();
      sessions.delete(id);
    },

    list(): SessionInfo[] {
      return [...sessions.values()].map((s) => ({
        id: s.id,
        name: s.name,
        state: s.session.state,
        cost: s.session.totalCost,
      }));
    },

    updatePolicy(id: string, policy: ToolPolicyConfig): void {
      const managed = getSession(id);
      managed.policy = policy;
      managed.session.setToolPolicy(buildToolPolicy(policy));
    },

    getPolicy(id: string): ToolPolicyConfig {
      return getSession(id).policy;
    },

    async dispose(): Promise<void> {
      const promises = [...sessions.values()].map((s) => s.session.dispose());
      sessions.clear();
      await Promise.allSettled(promises);
    },
  };
}
