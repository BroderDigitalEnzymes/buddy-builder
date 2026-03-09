import { useSyncExternalStore } from "react";
import type {
  SearchResultItem,
  IndexStatusInfo,
  PermissionMode,
  PolicyPreset,
  ChatEntry,
  ImageData,
} from "../ipc.js";

export type { ChatEntry } from "../ipc.js";

// ─── Window mode detection (same code, parameterized by URL hash) ─

const hashParams = new URLSearchParams(window.location.hash.slice(1));
export const POPOUT_SESSION_ID: string | null = hashParams.get("popout");
export const IS_POPOUT = !!POPOUT_SESSION_ID;
export const INFO_SESSION_ID: string | null = hashParams.get("info");
export const IS_INFO = !!INFO_SESSION_ID;

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

export type ViewMode = "home" | "chat";

export type StoreState = {
  sessions: Map<string, SessionData>;
  activeId: string | null;
  currentView: ViewMode;
  poppedOutIds: Set<string>;
  counter: number;
  version: number;
  searchResults: SearchResultItem[] | null;
  searchQuery: string;
  indexStatus: IndexStatusInfo;
};

export const state: StoreState = {
  sessions: new Map(),
  activeId: null,
  currentView: "home",
  poppedOutIds: new Set(),
  counter: 0,
  version: 0,
  searchResults: null,
  searchQuery: "",
  indexStatus: { totalSessions: 0, indexedSessions: 0, isIndexing: false },
};

// useSyncExternalStore needs getSnapshot to return the same reference
// when nothing changed. We use a version number as the snapshot.
let currentVersion = 0;

const listeners = new Set<() => void>();

export function emit(): void {
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
