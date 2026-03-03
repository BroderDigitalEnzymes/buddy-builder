import { useSyncExternalStore } from "react";
import {
  PERMISSION_MODE_PRESETS,
  type ClientApi,
  type SessionEvent,
  type ToolPolicyConfig,
  type PolicyPreset,
  type PermissionMode,
  type ChatEntry,
  type ImageData,
} from "../ipc.js";
import { applyEvent } from "../entry-builder.js";

export type { ChatEntry } from "../ipc.js";

export type SessionData = {
  id: string;
  name: string;
  projectName: string;
  state: string;
  claudeSessionId: string | null;
  cwd: string | null;
  permissionMode: PermissionMode;
  policyPreset: PolicyPreset;
  favorite: boolean;
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

export async function switchSession(id: string): Promise<void> {
  state.activeId = id;
  // Lazy-load entries if not yet loaded
  const data = state.sessions.get(id);
  if (data && data.entries.length === 0 && data.state === "dead") {
    try {
      const entries = await api().getSessionEntries({ sessionId: id });
      data.entries = entries;
    } catch { /* empty */ }
  }
  emit();
}

export async function loadPersistedSessions(): Promise<void> {
  try {
    const infos = await api().listSessions();
    for (const info of infos) {
      if (state.sessions.has(info.id)) continue;
      // Don't fetch entries upfront — lazy-load on switchSession
      state.counter++;
      state.sessions.set(info.id, {
        id: info.id,
        name: info.name,
        projectName: info.projectName,
        state: info.state,
        claudeSessionId: info.claudeSessionId,
        cwd: info.cwd,
        permissionMode: "default",
        policyPreset: "no-writes",
        favorite: false,
        entries: [],
      });
    }
    emit();
  } catch (err) {
    console.error("Failed to load persisted sessions:", err);
  }
}

export async function createSession(permissionMode: PermissionMode): Promise<void> {
  try {
    const id = await api().createSession({ permissionMode });
    state.counter++;
    state.sessions.set(id, {
      id,
      name: `Session ${state.counter}`,
      projectName: "(new)",
      state: "idle",
      claudeSessionId: null,
      cwd: null,
      permissionMode,
      policyPreset: PERMISSION_MODE_PRESETS[permissionMode],
      favorite: false,
      entries: [{ kind: "system", text: `Session created · ${permissionMode}`, ts: Date.now() }],
    });
    state.activeId = id;
    emit();
  } catch (err) {
    console.error("Failed to create session:", err);
  }
}

export async function sendMessage(text: string, images?: ImageData[]): Promise<void> {
  if (!state.activeId) return;
  const data = state.sessions.get(state.activeId);
  if (!data || data.state !== "idle") return;

  const entry: ChatEntry = { kind: "user", text, ts: Date.now() };
  if (images?.length) entry.images = images;
  data.entries.push(entry);
  emit();

  try {
    await api().sendMessage({ sessionId: state.activeId, text, images });
  } catch (err) {
    data.entries.push({ kind: "system", text: `Send error: ${err}`, ts: Date.now() });
    emit();
  }
}

export async function answerQuestion(toolUseId: string, answer: string): Promise<void> {
  if (!state.activeId) return;
  try {
    await api().answerQuestion({ sessionId: state.activeId, toolUseId, answer });
  } catch (err) {
    console.error("Failed to answer question:", err);
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
    data.entries.push({ kind: "system", text: `Tool policy → ${preset}`, ts: Date.now() });
    emit();
  } catch (err) {
    console.error("Failed to update policy:", err);
  }
}

export async function killSession(id: string): Promise<void> {
  try {
    await api().killSession({ sessionId: id });
  } catch { /* ignore */ }
  // Don't delete from store — session stays as dead/resumable
  // The exit event will update the state to "dead"
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await api().deleteSession({ sessionId: id });
  } catch { /* ignore */ }
  state.sessions.delete(id);
  if (state.activeId === id) {
    const ids = [...state.sessions.keys()];
    state.activeId = ids.length > 0 ? ids[ids.length - 1] : null;
  }
  emit();
}

export async function renameSession(id: string, name: string): Promise<void> {
  const data = state.sessions.get(id);
  if (!data) return;
  data.name = name;
  emit();
  try {
    await api().renameSession({ sessionId: id, name });
  } catch (err) {
    console.error("Failed to rename session:", err);
  }
}

export function toggleFavorite(id: string): void {
  const data = state.sessions.get(id);
  if (!data) return;
  data.favorite = !data.favorite;
  emit();
}

export async function resumeSession(id: string): Promise<void> {
  const data = state.sessions.get(id);
  if (!data) return;
  try {
    await api().resumeSession({ sessionId: id });
    // State will be updated via stateChange event
  } catch (err) {
    data.entries.push({ kind: "system", text: `Resume failed: ${err}`, ts: Date.now() });
    emit();
  }
}

export async function resumeInTerminal(id: string): Promise<void> {
  try {
    await api().resumeInTerminal({ sessionId: id });
  } catch (err) {
    const data = state.sessions.get(id);
    if (data) {
      data.entries.push({ kind: "system", text: `Open terminal failed: ${err}`, ts: Date.now() });
      emit();
    }
  }
}

// ─── Event handling ──────────────────────────────────────────────

function handleEvent(event: SessionEvent): void {
  const data = state.sessions.get(event.sessionId);
  if (!data) return;

  // Unified entry building (text, tool lifecycle, result, error, exit)
  applyEvent(data.entries, event);

  // Store-specific side effects
  switch (event.kind) {
    case "stateChange":
      data.state = event.to;
      break;
    case "exit":
      data.state = "dead";
      break;
    case "nameChanged":
      data.name = event.name;
      break;
  }

  emit();
}

// Wire up the IPC event listener
api().onSessionEvent(handleEvent);
