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
  type ImageData,
  type PermissionMode,
  type PolicyPreset,
} from "../ipc.js";
import { applyEvent } from "../entry-builder.js";
import { discoverAllSessions, parseTranscript } from "./transcript.js";
import { loadMeta, updateSessionMeta, deleteSessionMeta, type SessionMeta } from "./session-meta.js";

// ─── Types ──────────────────────────────────────────────────────

type ManagedSession = {
  readonly id: string;           // internal UUID (or claudeSessionId for discovered sessions)
  name: string;
  projectName: string;
  session: Session | null;       // null when dead
  claudeSessionId: string | null;
  transcriptPath: string | null; // path to JSONL transcript
  policy: ToolPolicyConfig;
  permissionMode: PermissionMode;
  entries: ChatEntry[] | null;   // null = not yet loaded (lazy)
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

// ─── Wire a session's events and build entries ───────────────────

function wireSession(managed: ManagedSession, session: Session, sink: EventSink): void {
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
    forward({ kind: "ready", sessionId: id, model: init.model, tools: init.tools });
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
    forward({ kind: "toolBlocked", sessionId: id, toolName: ev.toolName, reason: ev.reason, parentToolUseId: ev.parentToolUseId });
  });

  session.on("result", (r) => {
    forward({ kind: "result", sessionId: id, text: r.result, cost: r.total_cost_usd, turns: r.num_turns, durationMs: r.duration_ms });
  });

  session.on("stateChange", (ev) => {
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

// ─── Session Manager ────────────────────────────────────────────

export type SessionManager = {
  create(options?: CreateSessionOptions): Promise<string>;
  send(id: string, text: string, images?: ImageData[]): void;
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

  // ── Discover sessions from ALL Claude JSONL transcripts ──
  const meta = loadMeta();

  for (const stub of discoverAllSessions()) {
    counter++;
    const m: SessionMeta = meta[stub.claudeSessionId] ?? {};

    // Use claudeSessionId as our internal ID for discovered sessions
    const id = stub.claudeSessionId;
    const managed: ManagedSession = {
      id,
      name: m.name ?? stub.slug ?? (stub.firstPrompt.slice(0, 50) || `Session ${counter}`),
      projectName: stub.projectName,
      session: null,
      claudeSessionId: stub.claudeSessionId,
      transcriptPath: stub.transcriptPath,
      policy: { preset: (m.policyPreset as PolicyPreset) ?? "unrestricted", blockedTools: [] },
      permissionMode: (m.permissionMode as PermissionMode) ?? "default",
      entries: null, // lazy — loaded on demand
      createdAt: stub.createdAt,
      lastActiveAt: stub.lastActiveAt,
    };
    sessions.set(id, managed);
  }

  function getManaged(id: string): ManagedSession {
    const s = sessions.get(id);
    if (!s) throw new Error(`No session: ${id}`);
    return s;
  }

  /** Lazily load entries from JSONL transcript. */
  function ensureEntries(managed: ManagedSession): ChatEntry[] {
    if (managed.entries === null) {
      managed.entries = managed.transcriptPath
        ? parseTranscript(managed.transcriptPath)
        : [];
    }
    return managed.entries;
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
        projectName: "(new)",
        session,
        claudeSessionId: null,
        transcriptPath: null,
        policy,
        permissionMode: permMode,
        entries: [{ kind: "system", text: `Session created · ${permMode}`, ts: now }],
        createdAt: now,
        lastActiveAt: now,
      };
      sessions.set(id, managed);

      session.setToolPolicy(buildToolPolicy(policy));
      wireSession(managed, session, sink);
      return id;
    },

    send(id: string, text: string, images?: ImageData[]): void {
      const managed = getManaged(id);
      if (!managed.session) throw new Error("Session is dead");
      const entry: ChatEntry = { kind: "user", text, ts: Date.now() };
      if (images?.length) entry.images = images;
      ensureEntries(managed).push(entry);
      managed.lastActiveAt = Date.now();
      managed.session.send(text, images);
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
      }
    },

    remove(id: string): void {
      const managed = sessions.get(id);
      if (!managed) return;
      if (managed.session) {
        managed.session.kill();
      }
      sessions.delete(id);
      // Remove metadata sidecar only — leave Claude's JSONL intact
      if (managed.claudeSessionId) {
        deleteSessionMeta(managed.claudeSessionId);
      }
    },

    rename(id: string, name: string): void {
      const managed = getManaged(id);
      managed.name = name;
      managed.lastActiveAt = Date.now();
      if (managed.claudeSessionId) {
        updateSessionMeta(managed.claudeSessionId, { name });
      }
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

      // Ensure entries are loaded before appending
      ensureEntries(managed).push({ kind: "system", text: "Session resumed.", ts: Date.now() });
      managed.lastActiveAt = Date.now();

      wireSession(managed, session, sink);

      // Emit stateChange so renderer picks up the alive state
      sink({ kind: "stateChange", sessionId: id, from: "dead", to: session.state });
    },

    list(): SessionInfo[] {
      return [...sessions.values()].map((s) => ({
        id: s.id,
        name: s.name,
        projectName: s.projectName,
        state: s.session ? s.session.state : "dead" as const,
        claudeSessionId: s.claudeSessionId,
      }));
    },

    getEntries(id: string): ChatEntry[] {
      return ensureEntries(getManaged(id));
    },

    updatePolicy(id: string, policy: ToolPolicyConfig): void {
      const managed = getManaged(id);
      managed.policy = policy;
      if (managed.session) {
        managed.session.setToolPolicy(buildToolPolicy(policy));
      }
      if (managed.claudeSessionId) {
        updateSessionMeta(managed.claudeSessionId, { policyPreset: policy.preset });
      }
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
