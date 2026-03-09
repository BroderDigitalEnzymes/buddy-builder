import { randomUUID } from "crypto";
import { spawn as spawnChild } from "child_process";
import * as os from "os";
import * as path from "path";
import { readFileSync } from "fs";
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
  type SessionMeta as IpcSessionMeta,
} from "../ipc.js";
import { discoverAllSessions, parseTranscript, claudeProjectDir } from "./transcript.js";
import { loadMeta, updateSessionMeta, deleteSessionMeta, type SessionMeta } from "./session-meta.js";
import { wireSession } from "./session-wiring.js";

// ─── Types ──────────────────────────────────────────────────────

type ManagedSession = {
  readonly id: string;           // internal UUID (or claudeSessionId for discovered sessions)
  name: string;
  projectName: string;
  session: Session | null;       // null when dead
  claudeSessionId: string | null;
  cwd: string | null;            // original working directory (needed for resume)
  transcriptPath: string | null; // path to JSONL transcript
  policy: ToolPolicyConfig;
  permissionMode: PermissionMode;
  entries: ChatEntry[] | null;   // null = not yet loaded (lazy)
  favorite: boolean;
  createdAt: number;
  lastActiveAt: number;
  // Init metadata (populated on ready event)
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
  // Auto-naming
  autoNamed: boolean;
  userNamed: boolean;   // user explicitly set the name (rename or creation option)
  turnCount: number;
};

type EventSink = (event: SessionEvent) => void;

// ─── Auto-naming ────────────────────────────────────────────────
//
// Runs `claude -p "..."` as a simple subprocess to get a title for the
// conversation. No hooks, no streaming — just a one-shot command.

const AUTO_NAME_TURN_THRESHOLD = 3;

/** Extract a compact summary of the conversation for the naming prompt.
 *  Returns null if there aren't enough user turns (< AUTO_NAME_TURN_THRESHOLD). */
function buildNamingContext(managed: ManagedSession): string | null {
  const origSessionId = managed.claudeSessionId;
  const origCwd = managed.cwd;
  if (!origSessionId || !origCwd) return null;

  const origProjectDir = claudeProjectDir(origCwd);
  const filePath = managed.transcriptPath ?? path.join(origProjectDir, `${origSessionId}.jsonl`);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.split("\n").filter(l => l.trim());
  const exchanges: string[] = [];
  let userTurns = 0;
  let totalExchanges = 0;

  for (const line of lines) {
    if (totalExchanges >= 10) break;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "user" && obj.message?.content) {
        const text = Array.isArray(obj.message.content)
          ? obj.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
          : typeof obj.message.content === "string" ? obj.message.content : "";
        if (text && !text.startsWith("[tool_result")) {
          exchanges.push(`User: ${text.slice(0, 200)}`);
          userTurns++;
          totalExchanges++;
        }
      } else if (obj.type === "assistant" && obj.message?.content) {
        const text = Array.isArray(obj.message.content)
          ? obj.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
          : "";
        if (text) {
          exchanges.push(`Assistant: ${text.slice(0, 200)}`);
          totalExchanges++;
        }
      }
    } catch { /* skip */ }
  }

  // Need at least AUTO_NAME_TURN_THRESHOLD user turns
  if (userTurns < AUTO_NAME_TURN_THRESHOLD) return null;

  return exchanges.join("\n");
}

/**
 * Run `claude -p "..."` to get a title. Simple subprocess, no hooks.
 */
async function requestAutoName(
  managed: ManagedSession,
  claudePath: string,
  sink: EventSink,
): Promise<void> {
  const context = buildNamingContext(managed);
  if (!context) return;

  const prompt =
    "Here is a conversation between a user and an AI assistant:\n\n" +
    context + "\n\n" +
    "Reply with ONLY a short 3-6 word title that summarizes this conversation. " +
    "No quotes, no punctuation, no explanation — just the title words.";

  try {
    // Strip CLAUDECODE from env so the subprocess doesn't think it's nested
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const rawTitle = await new Promise<string>((resolve, reject) => {
      const child = spawnChild(
        claudePath,
        ["-p", prompt, "--no-session-persistence", "--max-turns", "1"],
        { stdio: ["ignore", "pipe", "pipe"], env },
      );

      let stdout = "";
      let stderr = "";

      child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Naming timed out"));
      }, 30_000);

      child.on("error", (err) => { clearTimeout(timer); reject(err); });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 200)}`));
        else resolve(stdout);
      });
    });

    const title = rawTitle
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\.+$/, "")
      .trim();

    if (title && title.length < 80) {
      managed.autoNamed = true;
      managed.name = title;
      if (managed.claudeSessionId) {
        updateSessionMeta(managed.claudeSessionId, { name: title });
      }
      sink({ kind: "nameChanged", sessionId: managed.id, name: title });
    }
  } catch (err) {
    console.error("[auto-name] failed:", err);
  }
}

// ─── Build a ToolPolicy function from a config ──────────────────

function buildToolPolicy(config: ToolPolicyConfig, permissionMode: PermissionMode) {
  const blocked = config.preset === "unrestricted" && config.blockedTools.length === 0
    ? []
    : [...(PRESET_BLOCKED_TOOLS[config.preset] ?? []), ...config.blockedTools];

  const blockedSet = new Set(blocked);

  // In "default" mode, restricted tools should prompt the user instead of silently blocking.
  // Explicitly blocked tools (via blockedTools list) are always hard-blocked.
  const explicitlyBlocked = new Set(config.blockedTools);
  const shouldAsk = permissionMode === "default";

  return (toolName: string, _input: Record<string, unknown>) => {
    if (blockedSet.has(toolName)) {
      if (shouldAsk && !explicitlyBlocked.has(toolName)) {
        return { action: "ask" as const };
      }
      return { action: "block" as const, reason: `Blocked by policy (${config.preset})` };
    }
    return { action: "allow" as const };
  };
}

// ─── Session Manager ────────────────────────────────────────────

export type SessionManager = {
  create(options?: CreateSessionOptions): Promise<string>;
  send(id: string, text: string, images?: ImageData[]): void;
  answerQuestion(id: string, toolUseId: string, answer: string): void;
  approvePermission(id: string, toolUseId: string, allow: boolean): void;
  interrupt(id: string): void;
  kill(id: string): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
  resume(id: string): Promise<void>;
  getResumeInfo(id: string): { claudeSessionId: string; cwd: string | null };
  list(): SessionInfo[];
  getEntries(id: string): ChatEntry[];
  getMeta(id: string): IpcSessionMeta;
  setFavorite(id: string, favorite: boolean): void;
  updatePolicy(id: string, policy: ToolPolicyConfig): void;
  getPolicy(id: string): ToolPolicyConfig;
  getIndexableData(): { sessionId: string; transcriptPath: string | null; sessionName?: string }[];
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
      name: m.name ?? stub.slug ?? "New Session",
      projectName: stub.projectName,
      session: null,
      claudeSessionId: stub.claudeSessionId,
      cwd: stub.cwd,
      transcriptPath: stub.transcriptPath,
      policy: { preset: m.policyPreset ?? "unrestricted", blockedTools: [] },
      permissionMode: m.permissionMode ?? "default",
      entries: null, // lazy — loaded on demand
      favorite: m.favorite ?? false,
      createdAt: stub.createdAt,
      lastActiveAt: stub.lastActiveAt,
      model: null,
      claudeCodeVersion: null,
      tools: [],
      mcpServers: [],
      skills: [],
      agents: [],
      slashCommands: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      autoNamed: true,  // don't auto-name until resumed
      userNamed: !!m.name,  // true if user explicitly renamed via metadata
      turnCount: 0,
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

  /** Hook called from wireSession on each top-level assistant text turn. */
  function onAssistantTurn(managed: ManagedSession): void {
    if (managed.autoNamed) return;
    managed.turnCount++;
    if (managed.turnCount >= AUTO_NAME_TURN_THRESHOLD) {
      managed.autoNamed = true;
      requestAutoName(managed, claudePath, sink).catch((err) => console.error("[auto-name] failed:", err));
    }
  }

  return {
    async create(options?: CreateSessionOptions): Promise<string> {
      const id = randomUUID();
      counter++;
      const now = Date.now();

      const permMode = options?.permissionMode ?? "default";
      const cwd = options?.cwd ?? null;
      const config: SessionConfig = {
        claudePath,
        permissionMode: permMode,
        cwd: cwd ?? undefined,
        model: options?.model,
        systemPrompt: options?.systemPrompt,
        maxTurns: options?.maxTurns,
      };

      const session = await createSession(config);
      const initialPreset = PERMISSION_MODE_PRESETS[permMode];
      const policy: ToolPolicyConfig = { preset: initialPreset, blockedTools: [] };
      const managed: ManagedSession = {
        id,
        name: options?.name ?? "New Session",
        projectName: cwd ?? "(new)",
        session,
        claudeSessionId: null,
        cwd,
        transcriptPath: null,
        policy,
        permissionMode: permMode,
        entries: [{ kind: "system", text: `Session created · ${permMode}`, ts: now }],
        favorite: false,
        createdAt: now,
        lastActiveAt: now,
        model: null,
        claudeCodeVersion: null,
        tools: [],
        mcpServers: [],
        skills: [],
        agents: [],
        slashCommands: [],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        autoNamed: !!options?.name,
        userNamed: !!options?.name,
        turnCount: 0,
      };
      sessions.set(id, managed);

      session.setToolPolicy(buildToolPolicy(policy, permMode));
      wireSession(managed, session, sink, () => onAssistantTurn(managed));
      return id;
    },

    send(id: string, text: string, images?: ImageData[]): void {
      const managed = getManaged(id);
      if (!managed.session) throw new Error("Session is dead");
      const entry: ChatEntry = { kind: "user", text, ts: Date.now(), ...(images?.length ? { images } : {}) };
      ensureEntries(managed).push(entry);
      managed.lastActiveAt = Date.now();
      managed.session.send(text, images);
    },

    answerQuestion(id: string, toolUseId: string, answer: string): void {
      const managed = getManaged(id);
      if (!managed.session) throw new Error("Session is dead");
      managed.session.answerQuestion(toolUseId, answer);
    },

    approvePermission(id: string, toolUseId: string, allow: boolean): void {
      const managed = getManaged(id);
      if (!managed.session) throw new Error("Session is dead");
      managed.session.approvePermission(toolUseId, allow);
    },

    interrupt(id: string): void {
      const managed = sessions.get(id);
      if (!managed?.session) return;
      managed.session.interrupt();
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
      managed.userNamed = true;
      managed.autoNamed = true; // stop auto-naming
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
        cwd: managed.cwd ?? undefined,
      };

      // Enable auto-naming on resume if user never explicitly named this session
      if (!managed.userNamed) {
        managed.autoNamed = false;
        managed.turnCount = 0;
        // For discovered sessions that already have conversation history,
        // trigger naming immediately instead of waiting for 3 more turns
        requestAutoName(managed, claudePath, sink).catch(() => {});
      }

      const session = await createSession(config);
      managed.session = session;
      session.setToolPolicy(buildToolPolicy(managed.policy, managed.permissionMode));

      // Ensure entries are loaded before appending
      ensureEntries(managed).push({ kind: "system", text: "Session resumed.", ts: Date.now() });
      managed.lastActiveAt = Date.now();

      wireSession(managed, session, sink, () => onAssistantTurn(managed));

      // Emit stateChange so renderer picks up the alive state
      sink({ kind: "stateChange", sessionId: id, from: "dead", to: session.state });
    },

    getResumeInfo(id: string): { claudeSessionId: string; cwd: string | null } {
      const managed = getManaged(id);
      if (!managed.claudeSessionId) throw new Error("No Claude session ID to resume");
      return { claudeSessionId: managed.claudeSessionId, cwd: managed.cwd };
    },

    list(): SessionInfo[] {
      return [...sessions.values()].map((s) => ({
        id: s.id,
        name: s.name,
        projectName: s.projectName,
        state: s.session ? s.session.state : "dead" as const,
        claudeSessionId: s.claudeSessionId,
        cwd: s.cwd,
        lastActiveAt: s.lastActiveAt,
        favorite: s.favorite,
      }));
    },

    getEntries(id: string): ChatEntry[] {
      return ensureEntries(getManaged(id));
    },

    getMeta(id: string): IpcSessionMeta {
      const s = getManaged(id);
      return {
        name: s.name,
        model: s.model,
        claudeCodeVersion: s.claudeCodeVersion,
        cwd: s.cwd,
        permissionMode: s.permissionMode,
        policyPreset: s.policy.preset,
        tools: s.tools,
        mcpServers: s.mcpServers,
        skills: s.skills,
        agents: s.agents,
        slashCommands: s.slashCommands,
        totalInputTokens: s.totalInputTokens,
        totalOutputTokens: s.totalOutputTokens,
        totalCost: s.totalCost,
      };
    },

    setFavorite(id: string, favorite: boolean): void {
      const managed = getManaged(id);
      managed.favorite = favorite;
      if (managed.claudeSessionId) {
        updateSessionMeta(managed.claudeSessionId, { favorite });
      }
    },

    updatePolicy(id: string, policy: ToolPolicyConfig): void {
      const managed = getManaged(id);
      managed.policy = policy;
      if (managed.session) {
        managed.session.setToolPolicy(buildToolPolicy(policy, managed.permissionMode));
      }
      if (managed.claudeSessionId) {
        updateSessionMeta(managed.claudeSessionId, { policyPreset: policy.preset });
      }
    },

    getPolicy(id: string): ToolPolicyConfig {
      return getManaged(id).policy;
    },

    getIndexableData(): { sessionId: string; transcriptPath: string | null; sessionName?: string }[] {
      return [...sessions.values()].map((s) => ({
        sessionId: s.id,
        transcriptPath: s.transcriptPath,
        sessionName: s.name,
      }));
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
