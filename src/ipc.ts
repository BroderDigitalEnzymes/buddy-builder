import type {
  SessionConfig,
  SessionState,
} from "./schema.js";

// ─── Image data (shared between main + renderer) ─────────────────

export type ImageData = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
};

// ─── Chat entry types (shared between main + renderer) ────────────

export type ChatEntry =
  | { kind: "user"; text: string; images?: ImageData[]; ts: number }
  | { kind: "text"; text: string; ts: number }
  | { kind: "tool"; toolName: string; toolUseId: string; status: "running" | "done" | "blocked"; detail: string; toolInput: Record<string, unknown>; toolResult?: string; children?: ChatEntry[]; ts: number }
  | { kind: "result"; cost: number; turns: number; durationMs: number; ts: number }
  | { kind: "system"; text: string; ts: number };

// ─── Session Event (main → renderer, validated by zod in schema.ts) ─

export type SessionEvent =
  | { kind: "ready"; sessionId: string; model: string; tools: string[] }
  | { kind: "text"; sessionId: string; text: string; parentToolUseId?: string }
  | { kind: "toolStart"; sessionId: string; toolName: string; toolInput: Record<string, unknown>; toolUseId: string; parentToolUseId?: string }
  | { kind: "toolEnd"; sessionId: string; toolName: string; toolUseId: string; response: unknown }
  | { kind: "toolBlocked"; sessionId: string; toolName: string; reason: string; parentToolUseId?: string }
  | { kind: "result"; sessionId: string; text: string; cost: number; turns: number; durationMs: number }
  | { kind: "stateChange"; sessionId: string; from: string; to: string }
  | { kind: "warn"; sessionId: string; message: string }
  | { kind: "error"; sessionId: string; message: string }
  | { kind: "exit"; sessionId: string; code: number | null }
  | { kind: "nameChanged"; sessionId: string; name: string };

export type SessionInfo = {
  readonly id: string;
  readonly name: string;
  readonly projectName: string;
  readonly state: SessionState;
  readonly claudeSessionId: string | null;
};

export const PermissionModes = ["default", "plan", "acceptEdits", "bypassPermissions"] as const;
export type PermissionMode = (typeof PermissionModes)[number];

export const PolicyPresets = ["unrestricted", "allow-edits", "no-writes", "read-only"] as const;
export type PolicyPreset = (typeof PolicyPresets)[number];

export type ToolPolicyConfig = {
  readonly preset: PolicyPreset;
  readonly blockedTools: readonly string[];
};

export const DEFAULT_POLICY: ToolPolicyConfig = { preset: "unrestricted", blockedTools: [] };

export const PRESET_BLOCKED_TOOLS: Record<PolicyPreset, readonly string[]> = {
  "unrestricted": [],
  "allow-edits": ["Bash"],
  "no-writes": ["Write", "Edit", "Bash"],
  "read-only": ["Write", "Edit", "Bash", "WebFetch", "WebSearch", "NotebookEdit"],
};

export type CreateSessionOptions = {
  readonly permissionMode?: PermissionMode;
};

/** Map a UI permission mode to an initial tool policy preset. */
export const PERMISSION_MODE_PRESETS: Record<PermissionMode, PolicyPreset> = {
  bypassPermissions: "unrestricted",
  acceptEdits: "allow-edits",
  default: "no-writes",
  plan: "read-only",
};

// ─── AskUserQuestion tool input (typed for rich rendering) ───────

export type AskQuestionOption = {
  readonly label: string;
  readonly description: string;
  readonly markdown?: string;
};

export type AskQuestionItem = {
  readonly question: string;
  readonly header: string;
  readonly options: readonly AskQuestionOption[];
  readonly multiSelect: boolean;
};

export type AskUserQuestionInput = {
  readonly questions: readonly AskQuestionItem[];
};

// ═══════════════════════════════════════════════════════════════════
// THE CONTRACT — single source of truth for all IPC
// ═══════════════════════════════════════════════════════════════════

/** App config (persisted to disk). */
export type AppConfig = {
  claudePath: string;
};

/** Invoke channels: renderer calls, main handles. */
export type InvokeContract = {
  createSession:     { in: CreateSessionOptions | undefined; out: string };
  sendMessage:       { in: { sessionId: string; text: string; images?: ImageData[] }; out: void };
  answerQuestion:    { in: { sessionId: string; toolUseId: string; answer: string }; out: void };
  killSession:       { in: { sessionId: string }; out: void };
  listSessions:      { in: undefined; out: SessionInfo[] };
  updatePolicy:      { in: { sessionId: string; policy: ToolPolicyConfig }; out: void };
  getPolicy:         { in: { sessionId: string }; out: ToolPolicyConfig };
  renameSession:     { in: { sessionId: string; name: string }; out: void };
  resumeSession:     { in: { sessionId: string }; out: void };
  deleteSession:     { in: { sessionId: string }; out: void };
  getSessionEntries: { in: { sessionId: string }; out: ChatEntry[] };
  getConfig:         { in: undefined; out: AppConfig };
  setConfig:         { in: AppConfig; out: void };
  takeScreenshot:    { in: { filename?: string } | undefined; out: string };
  winMinimize:       { in: undefined; out: void };
  winMaximize:       { in: undefined; out: void };
  winClose:          { in: undefined; out: void };
};

/** Event channels: main pushes, renderer listens. */
export type EventContract = {
  sessionEvent: SessionEvent;
};

// ═══════════════════════════════════════════════════════════════════
// DERIVED TYPES — no manual duplication
// ═══════════════════════════════════════════════════════════════════

/** Client-side invoke methods (what the renderer calls) */
export type InvokeClient<T> = {
  [K in keyof T]: T[K] extends { in: infer I; out: infer O }
    ? undefined extends I
      ? (input?: I) => Promise<O>
      : (input: I) => Promise<O>
    : never;
};

/** Server-side invoke handlers (what main implements) */
export type InvokeHandlers<T> = {
  [K in keyof T]: T[K] extends { in: infer I; out: infer O }
    ? undefined extends I
      ? (input?: I) => O | Promise<O>
      : (input: I) => O | Promise<O>
    : never;
};

/** Event listeners (renderer subscribes) — "foo" → "onFoo" */
export type EventListeners<T> = {
  [K in keyof T as `on${Capitalize<string & K>}`]: (cb: (data: T[K]) => void) => void;
};

/** Event pushers (main sends) */
export type EventPushers<T> = {
  [K in keyof T]: (data: T[K]) => void;
};

/** The full API the renderer sees on window.claude */
export type ClientApi = InvokeClient<InvokeContract> & EventListeners<EventContract>;

/** The handler map main must provide */
export type Handlers = InvokeHandlers<InvokeContract>;

/** The event push interface for main */
export type Pushers = EventPushers<EventContract>;

// ═══════════════════════════════════════════════════════════════════
// CHANNEL KEYS — runtime arrays derived from the contracts
// ═══════════════════════════════════════════════════════════════════

/** Invoke channel names (must match InvokeContract keys). */
export const INVOKE_CHANNELS = [
  "createSession", "sendMessage", "answerQuestion", "killSession",
  "listSessions", "updatePolicy", "getPolicy",
  "renameSession", "resumeSession", "deleteSession", "getSessionEntries",
  "getConfig", "setConfig", "takeScreenshot",
  "winMinimize", "winMaximize", "winClose",
] as const satisfies readonly (keyof InvokeContract)[];

/** Event channel names (must match EventContract keys). */
export const EVENT_CHANNELS = ["sessionEvent"] as const satisfies readonly (keyof EventContract)[];

// ═══════════════════════════════════════════════════════════════════
// BRIDGE FACTORIES — plain objects for contextBridge compatibility
// ═══════════════════════════════════════════════════════════════════

/**
 * Builds a plain object with invoke methods + on* listeners.
 * Returns a concrete object (not a Proxy) so it survives
 * Electron's contextBridge structured-clone.
 */
export function createClientApi(
  invoke: (channel: string, arg: unknown) => Promise<unknown>,
  on: (channel: string, handler: (...args: unknown[]) => void) => void,
): ClientApi {
  const api: Record<string, unknown> = {};

  for (const ch of INVOKE_CHANNELS) {
    api[ch] = (arg: unknown) => invoke(ch, arg);
  }

  for (const ch of EVENT_CHANNELS) {
    const listenerKey = `on${ch[0].toUpperCase()}${ch.slice(1)}`;
    api[listenerKey] = (cb: (data: unknown) => void) => {
      on(ch, (_event: unknown, data: unknown) => cb(data));
    };
  }

  return api as ClientApi;
}

/**
 * Registers all handler methods as ipcMain.handle calls.
 * Used in main entry.
 */
export function registerHandlers(
  handle: (channel: string, handler: (event: unknown, arg: unknown) => unknown) => void,
  handlers: Handlers,
): void {
  for (const [channel, fn] of Object.entries(handlers)) {
    handle(channel, (_event, arg) => (fn as (a: unknown) => unknown)(arg));
  }
}

/**
 * Creates a Proxy that auto-routes event push calls to webContents.send.
 * Used in main entry.
 */
export function createPushProxy(
  send: (channel: string, data: unknown) => void,
): Pushers {
  return new Proxy({} as Pushers, {
    get(_target, channel: string) {
      return (data: unknown) => send(channel, data);
    },
  });
}
