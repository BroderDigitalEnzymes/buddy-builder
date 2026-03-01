import { randomUUID } from "crypto";
import { createSession, type Session, type SessionConfig } from "../index.js";
import {
  DEFAULT_POLICY,
  PRESET_BLOCKED_TOOLS,
  PERMISSION_MODE_PRESETS,
  type SessionEvent,
  type SessionInfo,
  type ToolPolicyConfig,
  type CreateSessionOptions,
  type ChatEntry,
  type PermissionMode,
  type PolicyPreset,
} from "../ipc.js";
import { saveSession, loadAllSessions, deleteSessionFile } from "./persistence.js";

// ─── Types ──────────────────────────────────────────────────────

type ManagedSession = {
  readonly id: string;
  name: string;
  session: Session | null;           // null when dead
  claudeSessionId: string | null;    // from init message
  policy: ToolPolicyConfig;
  permissionMode: PermissionMode;
  cost: number;
  entries: ChatEntry[];
  createdAt: number;
  lastActiveAt: number;
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

// ─── Summarize tool input for entries ────────────────────────────

function summarizeInput(toolInput: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(toolInput)) {
    if (typeof v === "string") {
      const short = v.replace(/\\/g, "/").split("/").slice(-2).join("/");
      parts.push(`${k}=${short}`);
    }
  }
  return parts.join(" ") || "";
}

// ─── Persist helper (debounced for text events) ──────────────────

function persistManaged(managed: ManagedSession): void {
  saveSession({
    id: managed.id,
    claudeSessionId: managed.claudeSessionId,
    name: managed.name,
    permissionMode: managed.permissionMode,
    policyPreset: managed.policy.preset,
    cost: managed.cost,
    entries: managed.entries,
    createdAt: managed.createdAt,
    lastActiveAt: managed.lastActiveAt,
  });
}

// ─── Wire a session's events and build entries ───────────────────

function wireSession(managed: ManagedSession, session: Session, sink: EventSink): void {
  const id = managed.id;

  session.on("ready", (init) => {
    managed.claudeSessionId = init.session_id;
    managed.lastActiveAt = Date.now();
    persistManaged(managed);
    sink({ kind: "ready", sessionId: id, model: init.model, tools: init.tools });
  });

  let textDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  session.on("text", (text) => {
    // Build entry in manager
    const last = managed.entries[managed.entries.length - 1];
    if (last?.kind === "text") {
      last.text += text;
    } else {
      managed.entries.push({ kind: "text", text, ts: Date.now() });
    }
    managed.lastActiveAt = Date.now();

    // Debounce persistence for text (every 2s)
    if (textDebounceTimer) clearTimeout(textDebounceTimer);
    textDebounceTimer = setTimeout(() => persistManaged(managed), 2000);

    sink({ kind: "text", sessionId: id, text });
  });

  session.on("toolStart", (ev) => {
    managed.entries.push({
      kind: "tool",
      toolName: ev.toolName,
      toolUseId: ev.toolUseId,
      status: "running",
      detail: summarizeInput(ev.toolInput),
      toolInput: ev.toolInput,
      ts: Date.now(),
    });
    managed.lastActiveAt = Date.now();
    sink({ kind: "toolStart", sessionId: id, toolName: ev.toolName, toolInput: ev.toolInput, toolUseId: ev.toolUseId });
  });

  session.on("toolEnd", (ev) => {
    for (let i = managed.entries.length - 1; i >= 0; i--) {
      const e = managed.entries[i];
      if (e.kind === "tool" && e.toolUseId === ev.toolUseId) {
        e.status = "done";
        if (ev.response != null) {
          const raw = typeof ev.response === "string" ? ev.response : JSON.stringify(ev.response, null, 2);
          e.toolResult = raw.length > 4000 ? raw.slice(0, 4000) + "\n…(truncated)" : raw;
        }
        break;
      }
    }
    managed.lastActiveAt = Date.now();
    sink({ kind: "toolEnd", sessionId: id, toolName: ev.toolName, toolUseId: ev.toolUseId, response: ev.response });
  });

  session.on("toolBlocked", (ev) => {
    managed.entries.push({
      kind: "tool",
      toolName: ev.toolName,
      toolUseId: "",
      status: "blocked",
      detail: ev.reason,
      toolInput: {},
      ts: Date.now(),
    });
    managed.lastActiveAt = Date.now();
    sink({ kind: "toolBlocked", sessionId: id, toolName: ev.toolName, reason: ev.reason });
  });

  session.on("result", (r) => {
    managed.cost = r.total_cost_usd;
    managed.entries.push({
      kind: "result",
      cost: r.total_cost_usd,
      turns: r.num_turns,
      durationMs: r.duration_ms,
      ts: Date.now(),
    });
    managed.lastActiveAt = Date.now();
    // Flush any pending text debounce
    if (textDebounceTimer) { clearTimeout(textDebounceTimer); textDebounceTimer = null; }
    persistManaged(managed);
    sink({ kind: "result", sessionId: id, text: r.result, cost: r.total_cost_usd, turns: r.num_turns, durationMs: r.duration_ms });
  });

  session.on("stateChange", (ev) => {
    sink({ kind: "stateChange", sessionId: id, from: ev.from, to: ev.to });
  });

  session.on("warn", (msg) => {
    sink({ kind: "warn", sessionId: id, message: msg });
  });

  session.on("error", (err) => {
    managed.entries.push({ kind: "system", text: `Error: ${err.message}`, ts: Date.now() });
    managed.lastActiveAt = Date.now();
    sink({ kind: "error", sessionId: id, message: err.message });
  });

  session.on("exit", (ev) => {
    managed.session = null;
    managed.entries.push({ kind: "system", text: "Session ended.", ts: Date.now() });
    managed.lastActiveAt = Date.now();
    // Flush any pending text debounce
    if (textDebounceTimer) { clearTimeout(textDebounceTimer); textDebounceTimer = null; }
    persistManaged(managed);
    sink({ kind: "exit", sessionId: id, code: ev.code });
  });
}

// ─── Session Manager ────────────────────────────────────────────

export type SessionManager = {
  create(options?: CreateSessionOptions): Promise<string>;
  send(id: string, text: string): void;
  answerQuestion(id: string, toolUseId: string, answer: string): void;
  kill(id: string): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
  resume(id: string): Promise<void>;
  list(): SessionInfo[];
  getEntries(id: string): ChatEntry[];
  updatePolicy(id: string, policy: ToolPolicyConfig): void;
  getPolicy(id: string): ToolPolicyConfig;
  dispose(): Promise<void>;
};

export function createSessionManager(sink: EventSink, claudePath: string): SessionManager {
  const sessions = new Map<string, ManagedSession>();
  let counter = 0;

  // Load persisted sessions from disk (as dead sessions)
  for (const persisted of loadAllSessions()) {
    counter++;
    const managed: ManagedSession = {
      id: persisted.id,
      name: persisted.name,
      session: null,
      claudeSessionId: persisted.claudeSessionId,
      policy: { preset: persisted.policyPreset, blockedTools: [] },
      permissionMode: persisted.permissionMode,
      cost: persisted.cost,
      entries: persisted.entries,
      createdAt: persisted.createdAt,
      lastActiveAt: persisted.lastActiveAt,
    };
    sessions.set(persisted.id, managed);
  }

  function getManaged(id: string): ManagedSession {
    const s = sessions.get(id);
    if (!s) throw new Error(`No session: ${id}`);
    return s;
  }

  return {
    async create(options?: CreateSessionOptions): Promise<string> {
      const id = randomUUID();
      counter++;
      const now = Date.now();

      const permMode = options?.permissionMode ?? "default";
      const config: SessionConfig = {
        claudePath,
        permissionMode: permMode,
      };

      const session = await createSession(config);
      const initialPreset = PERMISSION_MODE_PRESETS[permMode];
      const policy: ToolPolicyConfig = { preset: initialPreset, blockedTools: [] };
      const managed: ManagedSession = {
        id,
        name: `Session ${counter}`,
        session,
        claudeSessionId: null,
        policy,
        permissionMode: permMode,
        cost: 0,
        entries: [{ kind: "system", text: `Session created · ${permMode}`, ts: now }],
        createdAt: now,
        lastActiveAt: now,
      };
      sessions.set(id, managed);

      session.setToolPolicy(buildToolPolicy(policy));
      wireSession(managed, session, sink);
      persistManaged(managed);
      return id;
    },

    send(id: string, text: string): void {
      const managed = getManaged(id);
      if (!managed.session) throw new Error("Session is dead");
      // Add user entry in manager
      managed.entries.push({ kind: "user", text, ts: Date.now() });
      managed.lastActiveAt = Date.now();
      managed.session.send(text);
    },

    answerQuestion(id: string, toolUseId: string, answer: string): void {
      const managed = getManaged(id);
      if (!managed.session) throw new Error("Session is dead");
      managed.session.answerQuestion(toolUseId, answer);
    },

    kill(id: string): void {
      const managed = sessions.get(id);
      if (!managed) return;
      if (managed.session) {
        managed.session.kill();
        // session will be set to null via exit event handler
      }
      // Session stays in map as dead + resumable
    },

    remove(id: string): void {
      const managed = sessions.get(id);
      if (!managed) return;
      if (managed.session) {
        managed.session.kill();
      }
      sessions.delete(id);
      deleteSessionFile(id);
    },

    rename(id: string, name: string): void {
      const managed = getManaged(id);
      managed.name = name;
      managed.lastActiveAt = Date.now();
      persistManaged(managed);
      sink({ kind: "nameChanged", sessionId: id, name });
    },

    async resume(id: string): Promise<void> {
      const managed = getManaged(id);
      if (managed.session) throw new Error("Session is already alive");
      if (!managed.claudeSessionId) throw new Error("No Claude session ID to resume");

      const config: SessionConfig = {
        claudePath,
        permissionMode: managed.permissionMode,
        resumeSessionId: managed.claudeSessionId,
      };

      const session = await createSession(config);
      managed.session = session;
      session.setToolPolicy(buildToolPolicy(managed.policy));
      wireSession(managed, session, sink);

      managed.entries.push({ kind: "system", text: "Session resumed.", ts: Date.now() });
      managed.lastActiveAt = Date.now();
      persistManaged(managed);

      // Emit stateChange so renderer picks up the alive state
      sink({ kind: "stateChange", sessionId: id, from: "dead", to: session.state });
    },

    list(): SessionInfo[] {
      return [...sessions.values()].map((s) => ({
        id: s.id,
        name: s.name,
        state: s.session ? s.session.state : "dead" as const,
        cost: s.cost,
        claudeSessionId: s.claudeSessionId,
      }));
    },

    getEntries(id: string): ChatEntry[] {
      return getManaged(id).entries;
    },

    updatePolicy(id: string, policy: ToolPolicyConfig): void {
      const managed = getManaged(id);
      managed.policy = policy;
      if (managed.session) {
        managed.session.setToolPolicy(buildToolPolicy(policy));
      }
      persistManaged(managed);
    },

    getPolicy(id: string): ToolPolicyConfig {
      return getManaged(id).policy;
    },

    async dispose(): Promise<void> {
      const promises = [...sessions.values()]
        .filter((s) => s.session)
        .map((s) => s.session!.dispose());
      sessions.clear();
      await Promise.allSettled(promises);
    },
  };
}
