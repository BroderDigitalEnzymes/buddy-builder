import { useSyncExternalStore } from "react";
import {
  PERMISSION_MODE_PRESETS,
  type SessionEvent,
  type ToolPolicyConfig,
  type PolicyPreset,
  type PermissionMode,
  type ChatEntry,
  type ImageData,
} from "../ipc.js";
import { api } from "./utils.js";
import { applyEvent } from "../entry-builder.js";

export type { ChatEntry } from "../ipc.js";

// ─── Window mode detection (same code, parameterized by URL hash) ─

const hashParams = new URLSearchParams(window.location.hash.slice(1));
export const POPOUT_SESSION_ID: string | null = hashParams.get("popout");
export const IS_POPOUT = !!POPOUT_SESSION_ID;

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
  lastActiveAt: number;
  entries: ChatEntry[];
  // Phase 2: rate limit + token usage
  rateLimit: { resetsAt: number; status: string } | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  // Phase 3: init metadata
  model: string | null;
  tools: string[];
  mcpServers: { name: string; status: string }[];
  claudeCodeVersion: string | null;
  skills: string[];
  agents: string[];
  slashCommands: string[];
  // Message queue — messages sent while busy, flushed on idle
  messageQueue: { text: string; images?: ImageData[] }[];
};

// ─── Store ───────────────────────────────────────────────────────

type StoreState = {
  sessions: Map<string, SessionData>;
  activeId: string | null;
  poppedOutIds: Set<string>;
  counter: number;
  version: number;
};

const state: StoreState = {
  sessions: new Map(),
  activeId: null,
  poppedOutIds: new Set(),
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

export async function switchSession(id: string): Promise<void> {
  if (IS_POPOUT && id !== POPOUT_SESSION_ID) return; // locked to one session
  state.activeId = id;
  // Lazy-load entries if not yet loaded (dead history OR live popout inheriting conversation)
  const data = state.sessions.get(id);
  if (data && data.entries.length === 0) {
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
        favorite: info.favorite,
        lastActiveAt: info.lastActiveAt,
        entries: [],
        rateLimit: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        model: null,
        tools: [],
        mcpServers: [],
        claudeCodeVersion: null,
        skills: [],
        agents: [],
        slashCommands: [],
        messageQueue: [],
      });
    }
    // In popout mode, auto-switch to the locked session
    if (IS_POPOUT && POPOUT_SESSION_ID) {
      await switchSession(POPOUT_SESSION_ID);
      return; // switchSession calls emit
    }
    emit();
  } catch (err) {
    console.error("Failed to load persisted sessions:", err);
  }
}

export async function createSession(permissionMode: PermissionMode, cwd?: string): Promise<void> {
  try {
    const id = await api().createSession({ permissionMode, cwd });
    state.counter++;
    state.sessions.set(id, {
      id,
      name: `Session ${state.counter}`,
      projectName: cwd ?? "(new)",
      state: "idle",
      claudeSessionId: null,
      cwd: cwd ?? null,
      permissionMode,
      policyPreset: PERMISSION_MODE_PRESETS[permissionMode],
      favorite: false,
      lastActiveAt: Date.now(),
      entries: [{ kind: "system", text: `Session created · ${permissionMode}`, ts: Date.now() }],
      rateLimit: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      model: null,
      tools: [],
      mcpServers: [],
      claudeCodeVersion: null,
      skills: [],
      agents: [],
      slashCommands: [],
      messageQueue: [],
    });
    state.activeId = id;
    emit();
  } catch (err) {
    console.error("Failed to create session:", err);
  }
}

export async function pickFolder(): Promise<string | null> {
  try {
    return await api().pickFolder();
  } catch {
    return null;
  }
}

export async function sendMessage(text: string, images?: ImageData[]): Promise<void> {
  if (!state.activeId) return;
  const data = state.sessions.get(state.activeId);
  if (!data || data.state === "dead") return;

  // Always show the user entry immediately
  const entry: ChatEntry = { kind: "user", text, ts: Date.now(), ...(images?.length ? { images } : {}) };
  data.entries.push(entry);

  if (data.state === "idle") {
    // Send immediately
    state.sessions.set(state.activeId, { ...data });
    emit();
    try {
      await api().sendMessage({ sessionId: state.activeId, text, images });
    } catch (err) {
      data.entries.push({ kind: "system", text: `Send error: ${err}`, ts: Date.now() });
      emit();
    }
  } else {
    // Queue for later — will flush when session becomes idle
    data.messageQueue.push({ text, images });
    state.sessions.set(state.activeId, { ...data });
    emit();
  }
}

/** Flush the next queued message when a session becomes idle. */
async function flushQueue(sessionId: string): Promise<void> {
  const data = state.sessions.get(sessionId);
  if (!data || data.state !== "idle" || data.messageQueue.length === 0) return;

  const next = data.messageQueue.shift()!;
  state.sessions.set(sessionId, { ...data });
  emit();

  try {
    await api().sendMessage({ sessionId, text: next.text, images: next.images });
  } catch (err) {
    data.entries.push({ kind: "system", text: `Send error: ${err}`, ts: Date.now() });
    state.sessions.set(sessionId, { ...data });
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

export async function interruptSession(id: string): Promise<void> {
  try {
    await api().interruptSession({ sessionId: id });
  } catch { /* ignore */ }
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
  const newFav = !data.favorite;
  state.sessions.set(id, { ...data, favorite: newFav });
  emit();
  api().setFavorite({ sessionId: id, favorite: newFav }).catch(() => {});
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

  // Keep lastActiveAt fresh
  if (event.kind !== "popoutChanged") data.lastActiveAt = Date.now();

  // Store-specific side effects (mutate, then replace reference for memo)
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
      break;
    case "stateChange":
      data.state = event.to;
      if (event.to === "idle") flushQueue(event.sessionId);
      break;
    case "exit":
      data.state = "dead";
      break;
    case "nameChanged":
      data.name = event.name;
      break;
    case "popoutChanged":
      if (event.poppedOut) state.poppedOutIds.add(event.sessionId);
      else state.poppedOutIds.delete(event.sessionId);
      break;
  }

  // Replace object reference so memo'd components re-render
  state.sessions.set(event.sessionId, { ...data });

  emit();
}

// ─── Pop-out actions ────────────────────────────────────────────

export async function popOutSession(id: string): Promise<void> {
  await api().popOutSession({ sessionId: id });
}

export async function popInSession(id: string): Promise<void> {
  await api().popInSession({ sessionId: id });
}

export async function focusPopout(id: string): Promise<boolean> {
  return await api().focusPopout({ sessionId: id });
}

// Wire up the IPC event listener
api().onSessionEvent(handleEvent);
