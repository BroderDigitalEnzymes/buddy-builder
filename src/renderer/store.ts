import { useSyncExternalStore } from "react";
import type {
  ClientApi,
  SessionEvent,
  ToolPolicyConfig,
  PolicyPreset,
  PermissionMode,
} from "../ipc.js";

// ─── Chat entry types ────────────────────────────────────────────

export type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; toolName: string; toolUseId: string; status: "running" | "done" | "blocked"; detail: string; toolInput: Record<string, unknown> }
  | { kind: "result"; cost: number; turns: number; durationMs: number }
  | { kind: "system"; text: string };

export type SessionData = {
  id: string;
  name: string;
  state: string;
  cost: number;
  permissionMode: PermissionMode;
  policyPreset: PolicyPreset;
  entries: ChatEntry[];
};

// ─── Store ───────────────────────────────────────────────────────

type StoreState = {
  sessions: Map<string, SessionData>;
  activeId: string | null;
  counter: number;
  version: number;
};

const state: StoreState = {
  sessions: new Map(),
  activeId: null,
  counter: 0,
  version: 0,
};

// useSyncExternalStore needs getSnapshot to return the same reference
// when nothing changed. We use a version number as the snapshot.
let currentVersion = 0;

const listeners = new Set<() => void>();

function emit(): void {
  state.version = ++currentVersion;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot(): number {
  return currentVersion;
}

/** Subscribe to store changes. Returns the version (triggers re-render on change). */
export function useStoreVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Read current state (call after useStoreVersion to ensure freshness). */
export function getState(): StoreState {
  return state;
}

// ─── Actions ─────────────────────────────────────────────────────

const api = (): ClientApi => (window as any).claude;

export function switchSession(id: string): void {
  state.activeId = id;
  emit();
}

export async function createSession(permissionMode: PermissionMode): Promise<void> {
  try {
    const id = await api().createSession({ permissionMode });
    state.counter++;
    state.sessions.set(id, {
      id,
      name: `Session ${state.counter}`,
      state: "idle",
      cost: 0,
      permissionMode,
      policyPreset: "unrestricted",
      entries: [{ kind: "system", text: `Session created · ${permissionMode}` }],
    });
    state.activeId = id;
    emit();
  } catch (err) {
    console.error("Failed to create session:", err);
  }
}

export async function sendMessage(text: string): Promise<void> {
  if (!state.activeId) return;
  const data = state.sessions.get(state.activeId);
  if (!data || data.state !== "idle") return;

  data.entries.push({ kind: "user", text });
  emit();

  try {
    await api().sendMessage({ sessionId: state.activeId, text });
  } catch (err) {
    data.entries.push({ kind: "system", text: `Send error: ${err}` });
    emit();
  }
}

export async function setPreset(preset: PolicyPreset): Promise<void> {
  if (!state.activeId) return;
  const data = state.sessions.get(state.activeId);
  if (!data) return;

  const policy: ToolPolicyConfig = { preset, blockedTools: [] };
  try {
    await api().updatePolicy({ sessionId: state.activeId, policy });
    data.policyPreset = preset;
    data.entries.push({ kind: "system", text: `Tool policy → ${preset}` });
    emit();
  } catch (err) {
    console.error("Failed to update policy:", err);
  }
}

export async function killSession(id: string): Promise<void> {
  try {
    await api().killSession({ sessionId: id });
  } catch { /* ignore */ }
  state.sessions.delete(id);
  if (state.activeId === id) {
    const ids = [...state.sessions.keys()];
    state.activeId = ids.length > 0 ? ids[ids.length - 1] : null;
  }
  emit();
}

// ─── Event handling ──────────────────────────────────────────────

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

function handleEvent(event: SessionEvent): void {
  const data = state.sessions.get(event.sessionId);
  if (!data) return;

  switch (event.kind) {
    case "ready":
      data.entries.push({ kind: "system", text: `Connected · ${event.model}` });
      break;

    case "text": {
      const last = data.entries[data.entries.length - 1];
      if (last?.kind === "text") {
        last.text += event.text;
      } else {
        data.entries.push({ kind: "text", text: event.text });
      }
      break;
    }

    case "toolStart":
      data.entries.push({
        kind: "tool",
        toolName: event.toolName,
        toolUseId: event.toolUseId,
        status: "running",
        detail: summarizeInput(event.toolInput),
        toolInput: event.toolInput,
      });
      break;

    case "toolEnd":
      for (let i = data.entries.length - 1; i >= 0; i--) {
        const e = data.entries[i];
        if (e.kind === "tool" && e.toolUseId === event.toolUseId) {
          e.status = "done";
          break;
        }
      }
      break;

    case "toolBlocked":
      data.entries.push({
        kind: "tool",
        toolName: event.toolName,
        toolUseId: "",
        status: "blocked",
        detail: event.reason,
        toolInput: {},
      });
      break;

    case "result":
      data.cost = event.cost;
      data.entries.push({
        kind: "result",
        cost: event.cost,
        turns: event.turns,
        durationMs: event.durationMs,
      });
      break;

    case "stateChange":
      data.state = event.to;
      break;

    case "warn":
      break;

    case "error":
      data.entries.push({ kind: "system", text: `Error: ${event.message}` });
      break;

    case "exit":
      data.state = "dead";
      data.entries.push({ kind: "system", text: "Session ended." });
      break;
  }

  emit();
}

// Wire up the IPC event listener
api().onSessionEvent(handleEvent);
